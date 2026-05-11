import type { IndexedWorld } from "../world/indexer";
import type { PlayerIntent } from "../dialogue/playerIntent";
import type { StoreState } from "../state/store";
import {
  adjacentSummary,
  intentHintLine,
} from "../dialogue/narratorPromptHelpers";
import { getTile, type Tile } from "../grid/tilePrimitives";
import {
  describeLock,
  isPlayerLocked,
  sortedGroupsForView,
} from "../scene/engagement";

/**
 * Mechanics-side system prompt fragments. Stylistic voice belongs in the
 * world's `aiInstructions` / `narratorStyle`, composed via `promptBuilder`.
 */
export const ENGINE_PROMPTS = {
  storyTraversal(
    state: StoreState,
    intent: PlayerIntent,
    world: IndexedWorld,
  ): string {
    const region = state.currentRegionId
      ? world.regionsById[state.currentRegionId]
      : undefined;
    const location = state.currentLocationId
      ? world.locations[state.currentLocationId]
      : undefined;
    const lines: string[] = [];

    lines.push(
      "You are the world narrator for a 2D fantasy adventure game.",
      "Every player intent passes through you. For each intent you MUST:",
      "  1. Emit the canonical mechanical tool call (e.g. move_region for region.move, travel_region for region.travelTo). State changes ONLY happen via tool calls.",
      "  2. Emit a single `narrate` call with 3-5 sentences of present-tense prose describing what the player sees, hears, smells, or feels. Treat each step as a beat worth painting — a ground texture, a sound carrying on the wind, a glance ahead — but stay compact. Never pad with summary or musing.",
      "  3. Optionally chain *additional* tool calls when the journey warrants it — a `spawn_party` / `spawn_group` for a procedural encounter (1 stranger, OR 2–3 NPCs as a band, OR empty npcIds for an anonymous crowd), `give_item` for something the player notices and picks up, `offer_quest` if an NPC hails them. Use sparingly; most ordinary steps need only narration. Authored characters already stand alone on location tiles — do not duplicate them as parties.",
      "If the intent is mechanically impossible (impassable, edge of map), DO NOT emit the mechanical tool — narrate the refusal instead.",
      "",
      `Mode: ${state.mode}`,
      `Region: ${region?.name ?? state.currentRegionId} — ${region?.basicInfo?.slice(0, 280) ?? ""}`,
    );
    if (location) {
      lines.push(
        `Location: ${location.name ?? state.currentLocationId} — ${location.basicInfo?.slice(0, 280) ?? ""}`,
      );
    }
    lines.push(
      `Player at: region (${state.regionPos[0]},${state.regionPos[1]}), location (${state.locationPos[0]},${state.locationPos[1]}).`,
      `Coordinate convention: +x = east, +y = NORTH.`,
    );

    const grid = state.mode === "region" ? state.regionGrid : state.locationGrid;
    if (grid) {
      const here = getTile(
        grid,
        state.mode === "region" ? state.regionPos[0] : state.locationPos[0],
        state.mode === "region" ? state.regionPos[1] : state.locationPos[1],
      );
      if (here) {
        lines.push(
          `Current tile: kind="${here.kind}", label="${here.label ?? ""}", passable=${here.passable}.`,
        );
      }
      const adj = adjacentSummary(
        grid,
        state.mode === "region" ? state.regionPos : state.locationPos,
      );
      if (adj) lines.push(`Adjacent tiles: ${adj}`);
    }

    lines.push("", intentHintLine(intent, state));

    if (state.activeQuestIds.length > 0) {
      const quests = state.activeQuestIds
        .map((qid) => {
          const q = world.world.quests[qid];
          if (!q) return null;
          return `  - ${qid}: ${q.questStatement}`;
        })
        .filter(Boolean);
      if (quests.length > 0) {
        lines.push("", "Active quests:", ...(quests as string[]));
      }
    }

    if (state.playerPartyNpcIds.length > 0) {
      lines.push(
        "",
        "Player's traveling party (rows under their portrait in the UI):",
        ...state.playerPartyNpcIds.map((id) => {
          const n = world.world.npcs[id];
          return `  - ${id}${n?.name ? ` — ${n.name}` : ""}`;
        }),
        "Use `add_to_player_party` / `remove_from_player_party` when someone joins or leaves the hero's journey (separate from one-off `spawn_party` encounters on a tile).",
      );
    }

    return lines.join("\n");
  },

  storyScene(state: StoreState, world: IndexedWorld): string {
    const region = state.currentRegionId
      ? world.regionsById[state.currentRegionId]
      : undefined;
    const location = state.currentLocationId
      ? world.locations[state.currentLocationId]
      : undefined;
    const tile = state.currentSceneTile;
    const tileObj: Tile | undefined = (() => {
      if (!tile || !state.locationGrid) return undefined;
      const t =
        state.locationGrid.tiles[
          tile.y * (state.locationGrid.width ?? 0) + tile.x
        ];
      return t ?? undefined;
    })();

    const groups = sortedGroupsForView(state.engagement);
    const lockNote = isPlayerLocked(state.engagement)
      ? `LOCKED: ${describeLock(state.engagement) ?? ""}`
      : "Not locked.";

    const lines: string[] = [];
    lines.push(
      "You are the scene narrator and AI dungeon master for a 2D fantasy adventure game.",
      "You speak the world into being and you also drive its mechanics. You do BOTH things by:",
      "  1. Producing prose narration in your reply text (this becomes the visible narration log).",
      "  2. Emitting one or more tool calls to mutate game state when something mechanical happens.",
      "Mechanical changes (movement, engagement, combat, items, currency, quests) MUST be expressed via tool calls — narration alone has no effect.",
      "If the player attempts something that the engagement / lock state forbids, narrate the failure and DO NOT emit the tool call.",
      "",
      `Region: ${region?.name ?? state.currentRegionId} :: ${region?.basicInfo?.slice(0, 280) ?? ""}`,
      `Location: ${location?.name ?? state.currentLocationId ?? "(none)"} :: ${location?.basicInfo?.slice(0, 280) ?? ""}`,
      `Tile (${tile?.x ?? "?"},${tile?.y ?? "?"}) — kind: ${tile?.kind ?? "?"}, label: ${tile?.label ?? "—"}`,
      tileObj?.questMarker
        ? `Quest overlay on this tile: ${JSON.stringify(tileObj.questMarker)}`
        : "No quest overlay on this tile.",
      "",
      `Engagement state: ${lockNote}`,
    );
    if (groups.length > 0) {
      lines.push(
        "**Characters** (kind=character, ids `world-npc-*`) are authored and always standalone — one NPC per entry. Do not `spawn_party` duplicates for the same npcIds.",
        "**Parties** (kind=party) are procedural: either one stranger, 2–3 NPCs together (merchants, thieves, enemies), or anonymous (empty npcIds) with a descriptive name. If persuasion or story should move an NPC between parties, `dismiss_party` the old group and `spawn_party` with the updated npcIds.",
      );
      for (const g of groups) {
        const role = g.kind === "character" ? "character" : "party";
        const npcs = g.npcIds.length > 0 ? ` (npcs: ${g.npcIds.join(", ")})` : "";
        lines.push(
          `  - [${role}] id=${g.id} name="${g.name}" state=${g.state}${npcs} :: ${g.summary ?? ""}`,
        );
      }
    } else {
      lines.push(
        "No procedural parties on this tile yet. Authored characters may still appear once the tile loads. For extra strangers or bands, use `spawn_party` (1–3 npcIds or anonymous) then `engage` if needed.",
      );
    }

    if (state.activeQuestIds.length > 0) {
      lines.push("", "Active quests:");
      for (const qid of state.activeQuestIds) {
        const quest = world.world.quests[qid];
        if (!quest) continue;
        const progress = state.questProgress[qid] ?? {};
        lines.push(
          `  - ${qid}: ${quest.questStatement}; objective ${quest.mainObjective}; progress ${JSON.stringify(progress)}`,
        );
      }
    }

    if (Object.keys(state.inventory.items).length > 0) {
      lines.push(
        "",
        `Inventory: ${Object.entries(state.inventory.items)
          .map(([id, n]) => `${n}× ${id}`)
          .join(", ")}`,
      );
    }
    const c = state.inventory.currency;
    lines.push(`Coin: ${c.gold}g ${c.silver}s ${c.copper}c`);

    if (state.playerPartyNpcIds.length > 0) {
      lines.push(
        "",
        `Traveling companions (persistent party under the hero portrait): ${state.playerPartyNpcIds.join(", ")}.`,
        "Update with `add_to_player_party` / `remove_from_player_party` when the story recruits or drops someone who travels with the player. Tile encounters (`spawn_party`) are separate.",
      );
    }

    lines.push(
      "",
      "Reply MUST be valid for the tool catalogue. Use `narrate` for ambient prose, `say` for in-character NPC speech, and the mechanical tools for state changes.",
      "Companion strip: `add_to_player_party` / `remove_from_player_party` maintain who travels with the hero (engine-capped); not the same as scene `spawn_party` bands.",
    );

    return lines.join("\n");
  },

  tileRegion(): string {
    return [
      "You are the regional cartographer for a 2D fantasy adventure game.",
      "Given prose describing a region and a list of named locations within it, you will design the BACKGROUND TERRAIN for a top-down tile grid representing that region.",
      "",
      "The engine has already chosen which cells the named locations occupy and will stamp those cells itself; you do NOT need to set `locationId`. Your job is to fill the BETWEEN-LOCATION terrain so that the geography is internally consistent and matches the prose.",
      "",
      "Output strict JSON matching:",
      "{",
      '  "biome": string,',
      '  "palette": string[],',
      '  "cells": Array<{',
      '    "x": int, "y": int,',
      '    "kind": string,',
      '    "label": string,',
      '    "passable": boolean,',
      '    "dangerous": boolean',
      "  }>",
      "}",
      "",
      "Rules:",
      " 1. Cover EVERY cell of the grid — exactly width * height cells, no duplicates, no gaps. The engine will overwrite the cells it has reserved for named locations, so you may emit any plausible terrain at those coordinates.",
      " 2. `kind` must be a TERRAIN TYPE in kebab-case, NEVER a proper noun. Good kinds: 'reed-marsh', 'orchard', 'open-fields', 'wheat-field', 'pine-foothills', 'tidal-flats', 'sea-shallows', 'old-ruin', 'broken-causeway', 'pebble-strand'. FORBIDDEN kinds: any region name, any settlement / city / village / outpost name, any river name, any character or faction name. If the region is called 'Avenor', the kind 'avenor' is forbidden. If a river is called 'Orteliol', the kind 'orteliol-river' is forbidden — use generic terrain like 'broad-river', 'river-flats', 'river-bend' instead.",
      " 3. Same rule for `label`: describe what the place IS (terrain or feature), not what it's named. 'Reed marsh', 'Open wheat field', 'Coastal scrub' are fine. 'Avenor', 'Orteliol River', 'Northern Mountains' are NOT — those are place names that belong to anchor tiles or the region itself.",
      " 4. Reuse a small palette: choose ~6-10 distinct kinds across the whole grid, recombined to vary the geography. The image cache keys on (kind, biome), so a tight palette dramatically improves cache hit rate.",
      " 5. The PROSE is the AUTHORITATIVE source of cardinal-direction geography — NOT the anchor positions. When the prose names a direction (e.g. 'mountains to the north', 'sea to the south', 'desert in the east'), that direction MUST be honoured. Place those large terrain bands accordingly, even if the named locations happen to cluster in the opposite half of the map. Anchor locations sit wherever they sit; the BACKGROUND terrain has to reflect the prose's compass calls, not contradict them.",
      " 6. Coordinate convention: +x = EAST, +y = NORTH. Concretely:",
      "    - Cells with the highest y (e.g. y = height - 1) are the NORTHERNMOST row.",
      "    - Cells with y = 0 are the SOUTHERNMOST row.",
      "    - Cells with x = 0 are the WESTERNMOST column.",
      "    - Cells with the highest x (e.g. x = width - 1) are the EASTERNMOST column.",
      "    So 'mountains to the north' means MOUNTAIN-style kinds should fill the high-y rows (top of the map). 'Sea to the south' means SEA/SHORELINE kinds should fill the low-y rows. 'Coast to the east' means COAST/TIDAL kinds should fill the high-x columns. Mirror the prose's compass references in BAND placement.",
      " 7. The geography should also reflect non-direction prose hints. If the region has a river, the river cells should form a continuous line or bend across the grid. If there is sea/coast, it should sit on ONE edge consistent with the prose. If there are mountains, they should cluster, not scatter.",
      " 8. `passable=false` for impassable terrain (deep water, cliffs, dense crag). Otherwise true.",
      " 9. `dangerous=true` only when crossing the cell would credibly trigger a hazard or hostile encounter.",
      " 10. Reply with JSON ONLY. No prose, no markdown, no commentary.",
    ].join("\n");
  },

  tileLocation(): string {
    return [
      "You are the urban / interior cartographer for a 2D fantasy adventure game.",
      "Given prose describing a single named location and its sub-areas, you will design a top-down rectangular tile grid representing the layout of that location. The user message states the exact width and height — follow it precisely.",
      "",
      "Output strict JSON matching:",
      "{",
      '  "biome": string,           // architectural/spatial label, e.g. \'old-quarter\', \'farmstead\', \'cellar\'',
      '  "palette": string[],',
      '  "cells": Array<{',
      '    "x": int, "y": int,',
      '    "kind": string,',
      '    "label": string,',
      '    "passable": boolean,',
      '    "dangerous": boolean',
      "  }>",
      "}",
      "",
      "Rules:",
      " 1. Cover EVERY cell — exactly width × height cells as given in the user message, no duplicates, no gaps.",
      " 2. Reuse a small palette of ~5-8 kinds across the grid.",
      " 3. `kind` must be a FUNCTIONAL/ARCHITECTURAL TYPE in kebab-case, NEVER a proper noun. Good kinds: 'common-room', 'stable-yard', 'cellar-stair', 'kitchen', 'garden-patch', 'inn-courtyard', 'smithy', 'market-stall', 'cottage'. FORBIDDEN kinds: any sub-area's proper-noun ID, e.g. if a sub-area is called 'The Farmer's Rest' the kind 'the-farmer-s-rest' is forbidden — use 'inn-hall' or 'common-room' instead. Same for 'Inn Garden' → use 'garden-patch' or 'inn-courtyard'.",
      " 4. Same rule for `label`: describe what the cell IS, not what it's named. 'Common room', 'Stable yard', 'Kitchen' are fine. 'The Farmer's Rest', 'Inn Garden', 'Heraldo's Workshop' are NOT — those are proper-noun names that belong only in the engine's data model, never in `kind` or `label`.",
      " 5. If the prose references named sub-areas (rooms, halls, yards), surface each as one cell with a generic functional kind that matches the area's PURPOSE (e.g. 'The Farmer's Rest' (an inn) → kind 'inn-hall' or 'common-room'; 'Inn Garden' → 'garden-patch').",
      " 6. The remaining cells fill in plausible connectors (alleys, gardens, walls) that make the layout coherent.",
      " 7. `passable=false` for solid walls or sealed rooms. Otherwise true.",
      " 8. `dangerous=true` only when the cell is itself a hazard (e.g. a vermin nest, a collapsing floor).",
      " 9. NO `locationId` on location-grid cells; that field is only used at region scope.",
      " 10. Reply with JSON ONLY. No prose, no markdown, no commentary.",
    ].join("\n");
  },

  /**
   * Region grid when tile art uses one mosaic image per map (sliced into cells).
   * No tight terrain palette — each cell may be visually distinct. The image
   * model reads `mosaicDescribe` per cell; `kind` stays a compact slug for gameplay.
   */
  tileRegionMosaic(): string {
    return [
      "You are the regional cartographer for a 2D fantasy adventure game.",
      "The player sees this region as ONE continuous top-down map that is later cut into an exact grid. Your output will drive that single image: every cell needs its own terse location description.",
      "",
      "The engine has already chosen which cells the named locations occupy and will stamp those cells itself; you do NOT set `locationId`. Fill BETWEEN-location terrain so the geography matches the prose.",
      "",
      "Output strict JSON matching:",
      "{",
      '  "biome": string,',
      '  "palette": string[],   // optional diagnostic list of terrain tags you used (not limited in count)',
      '  "cells": Array<{',
      '    "x": int, "y": int,',
      '    "kind": string,      // short kebab-case slug for engine/pathing (unique per cell is fine)',
      '    "label": string,     // short UI / narration phrase',
      '    "mosaicDescribe": string,',
      '    "passable": boolean,',
      '    "dangerous": boolean',
      "  }>",
      "}",
      "",
      "Rules:",
      " 1. Cover EVERY cell — exactly width × height cells, no duplicates, no gaps. Reserved location cells may hold any plausible terrain; the engine overwrites anchors.",
      " 2. EVERY cell MUST include `mosaicDescribe`: 1 terse, concrete description telling an image model exactly what to paint in that square, top-down cell. Be specific: materials (mud, slate, sand), vegetation, water depth/color, building types, atmosphere. Simple instruction to the painter, NOT visible lettering on the map — do not say 'write' or 'label'.",
      " 3. `label` stays short and name-free: terrain read, e.g. 'Foggy sheep pasture', 'Shingle beach at low tide'.",
      " 4. The PROSE is authoritative for compass geography. Honour north/south/east/west bands from the region text; anchor positions do not override prose.",
      " 5. Coordinate convention: +x = EAST, +y = NORTH; highest y is north; (0,0) is south-west.",
      " 6. Rivers, roads, and coastlines should read as continuous features across adjacent cells; say so in `mosaicDescribe` where relevant.",
      " 7.`dangerous=true` only for real hazards.",
      " 8. Reply with JSON ONLY. No markdown, no commentary.",
    ].join("\n");
  },

  /**
   * Location (site) grid when tile art uses one mosaic image per map.
   */
  tileLocationMosaic(): string {
    return [
      "You are the location cartographer for a 2D fantasy adventure game.",
      "The player sees this site as ONE continuous top-down painting sliced into different sections. Each part must carry a rich `mosaicDescribe` for the image model. The user message gives exact width × height.",
      "",
      "Output strict JSON matching:",
      "{",
      '  "biome": string,',
      '  "palette": string[],',
      '  "cells": Array<{',
      '    "x": int, "y": int,',
      '    "kind": string,',
      '    "label": string,',
      '    "mosaicDescribe": string,',
      '    "passable": boolean,',
      '    "dangerous": boolean',
      "  }>",
      "}",
      "",
      "Rules:",
      " 1. Cover EVERY cell — width × height, no gaps.",
      " 2. EVERY cell MUST include `mosaicDescribe`: 1–3 sentences, top-down art direction for that cell only — rooflines, courtyards, stairs, stalls, water, stonework, lighting. Instructions to the painter only; no request for visible text or signage.",
      " 3. `label` is a short functional read for UI (e.g. 'Covered market aisle') — avoid echoing long proper-noun sub-area titles in `kind`.",
      " 4. Respect ENGINE-RESERVED sub-area coordinates from the user message; still output a full `mosaicDescribe` there (what the painter should show on that footprint).",
      " 5. `passable` / `dangerous` as usual.",
      " 6. NO `locationId` on cells.",
      " 7. Reply with JSON ONLY.",
    ].join("\n");
  },

  skillCheck(): string {
    return "Resolve the skill check and return strict JSON {outcome, narration, side_effects}.";
  },

  questVerify(): string {
    return "Validate whether the evidence satisfies the completion condition. Return strict JSON {complete, reason}.";
  },

  deathRecovery(): string {
    return [
      "You narrate the aftermath of the player's defeat and their recovery in the fiction.",
      "Respond with plain prose suitable for the story log; the engine applies mechanical recovery separately.",
    ].join("\n");
  },
};
