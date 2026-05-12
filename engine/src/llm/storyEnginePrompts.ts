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
 * Narration / scene-DM system headers. Combined with pack `aiInstructions` and
 * `narratorStyle` via `buildSystemPrompt`. For tile JSON cartography use
 * `TILE_CARTOGRAPHY_PROMPTS` instead.
 */
export const STORY_ENGINE_PROMPTS = {
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

  deathRecovery(): string {
    return [
      "You narrate the aftermath of the player's defeat and their recovery in the fiction.",
      "Respond with plain prose suitable for the story log; the engine applies mechanical recovery separately.",
    ].join("\n");
  },
};
