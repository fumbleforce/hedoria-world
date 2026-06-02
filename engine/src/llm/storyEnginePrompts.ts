import type { IndexedWorld } from "../world/indexer";
import type { PlayerIntent } from "../dialogue/playerIntent";
import type { StoreState, StoryFact } from "../state/store";
import {
  adjacentSummary,
  intentHintLine,
  namedAreasSummary,
  nearbyLocationsSummary,
} from "../dialogue/narratorPromptHelpers";
import { getTile, type Tile } from "../grid/tilePrimitives";
import {
  describeLock,
  isPlayerLocked,
  sortedGroupsForView,
} from "../scene/engagement";

/**
 * Pick story facts the evaluator should consider for the current turn.
 * Globals are always included; scoped facts are filtered to the current
 * region/location/scene/active engagement/active quests. Capped to 30
 * lines so the prompt does not balloon.
 */
export function relevantFactsForTurn(state: StoreState): StoryFact[] {
  const out: StoryFact[] = [];
  const engagedNpcIds = new Set<string>();
  for (const g of Object.values(state.engagement.groups)) {
    if (g.state === "engaged" || g.state === "locked") {
      for (const id of g.npcIds) engagedNpcIds.add(id);
    }
  }
  const activeQuestIds = new Set(state.activeQuestIds);
  const tile = state.currentSceneTile;
  for (const fact of Object.values(state.storyFacts)) {
    const s = fact.scope;
    let keep = false;
    if (s.kind === "global") keep = true;
    else if (s.kind === "region") keep = s.regionId === state.currentRegionId;
    else if (s.kind === "location")
      keep = s.locationId === state.currentLocationId;
    else if (s.kind === "scene")
      keep =
        s.locationId === state.currentLocationId &&
        !!tile &&
        s.x === tile.x &&
        s.y === tile.y;
    else if (s.kind === "npc") keep = engagedNpcIds.has(s.npcId);
    else if (s.kind === "quest") keep = activeQuestIds.has(s.questId);
    if (keep) out.push(fact);
  }
  // Most-recently-touched first, capped.
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out.slice(0, 30);
}

/**
 * Narration / scene-DM system headers. Combined with pack `aiInstructions` and
 * `narratorStyle` via `buildSystemPrompt`. For tile JSON cartography use
 * `TILE_CARTOGRAPHY_PROMPTS` instead.
 */
export const STORY_ENGINE_PROMPTS = {
  actionEvaluator(state: StoreState, intentText: string): string {
    const mode = state.mode;
    const pos = mode === "region" ? state.regionPos : state.locationPos;
    const facts = relevantFactsForTurn(state);
    const hereFacts = facts
      .map((f) => `- [${f.importance}] ${f.id}: ${f.text}`)
      .join("\n");
    const conditions = state.playerConditions
      .map(
        (c) =>
          `- ${c.id} ${c.label} (${c.severity}): ${c.effects.join("; ")}${c.notes ? ` — ${c.notes}` : ""}`,
      )
      .join("\n");
    const recent = state.storyLog
      .slice(-3)
      .map((line) => `${line.kind.toUpperCase()}: ${line.text}`)
      .join("\n");
    const grid = mode === "region" ? state.regionGrid : state.locationGrid;
    const placesNearby = grid
      ? mode === "region"
        ? nearbyLocationsSummary(grid, pos)
        : namedAreasSummary(grid, pos)
      : "";
    return [
      "You are an action evaluator for a story-heavy RPG.",
      "Interpret what the player is trying to do, decide if it succeeds, and output strict JSON ONLY.",
      "Do not narrate prose. Do not emit tool calls. Do not wrap in markdown.",
      "Use semantic interpretation, never keyword parsing. Preserve player intent fidelity.",
      "",
      "OUTPUT EXACT JSON SHAPE (every field is required; copy the structure):",
      "{",
      '  "interpretation": {',
      '    "summary": "<one-sentence restatement of what the player is trying to do>",',
      '    "confidence": "low" | "medium" | "high"',
      "  },",
      '  "verdict": "trivial_success" | "success" | "partial" | "failure" | "refused",',
      '  "reason": "<one paragraph: why this verdict; what allowed or blocked the action>",',
      '  "blockingConditionIds": [],',
      '  "appliesConditions": [],',
      '  "interrupt": { "kind": "none", "timing": "after_action", "requiresDialogue": false }',
      "}",
      "",
      "Verdict guidance:",
      '- "trivial_success": ordinary action with no obstacles (a short move, looking around, entering a place the player is right next to).',
      '- "success": worked despite some difficulty.',
      '- "partial": worked but at a cost or with a complication; populate appliesConditions if appropriate.',
      '- "failure": did not work for in-fiction reasons.',
      '- "refused": player conditions or facts make it impossible (e.g. no legs → cannot walk).',
      "",
      "Intent semantics (these are valid actions, never no-ops — the setting is whatever the pack says, do not assume genre):",
      '- "region.enterLocation": the player crosses from outside a named place INTO it. Being on the region tile that REPRESENTS a place is being OUTSIDE it, not inside. NEVER write "they are already inside".',
      '- "location.enterTile": the player moves within the place to a specific spot inside it.',
      '- "location.leave": the player crosses back out of the place to the wider region.',
      '- "scene.leaveTile": the player steps back from the specific spot to the wider interior.',
      "",
      `Where the player is: ${
        mode === "region"
          ? "in the wider region, NOT inside any named place. They may be on the region tile that represents a place from outside, but they have not entered it."
          : mode === "location"
            ? "inside a named place, somewhere within its interior."
            : "at a specific spot within a named place."
      }`,
      `Grid position: (${pos[0]},${pos[1]}) (+x=east, +y=NORTH)`,
      "Named places nearby (the ONLY landmarks you may name — do not invent others):",
      placesNearby || "  - none",
      "Player conditions:",
      conditions || "- none",
      "Relevant story facts:",
      hereFacts || "- none",
      "Recent log:",
      recent || "- none",
      "",
      `Player action: ${intentText}`,
    ].join("\n");
  },

  storyNarratorWithOutcome(
    state: StoreState,
    world: IndexedWorld,
    outcomeSummary: string,
  ): string {
    return [
      STORY_ENGINE_PROMPTS.storyScene(state, world),
      "",
      "Evaluator outcome to honor:",
      outcomeSummary,
      "Narrate consistently with the evaluator outcome.",
      "If verdict is refused/failure, do not emit mechanical success tools for the blocked action.",
    ].join("\n");
  },

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

    // Natural-language framing of where the player is. Avoid game-dev
    // jargon (overworld, interior, zoom) in the prompt so the LLM doesn't
    // parrot it back as narration. Just describe the situation as a
    // person would.
    const regionName = region?.name ?? state.currentRegionId;
    const destLoc =
      intent.kind === "region.enterLocation"
        ? world.locations[intent.locationId]
        : undefined;
    const destName = destLoc?.name ?? (intent.kind === "region.enterLocation" ? intent.locationId : undefined);
    let situation: string;
    if (state.mode === "region") {
      situation = destName
        ? `The player is in the wider region of ${regionName}, currently outside ${destName} — about to step inside.`
        : `The player is in the wider region of ${regionName}. They are NOT inside any named place; the region's overall character is whatever the region description and tile data below describe.`;
    } else if (state.mode === "location") {
      const where = location?.name ?? state.currentLocationId ?? "a place";
      situation = `The player is inside ${where}, somewhere within its interior. The interior's character is whatever the location description and tile data below describe.`;
    } else {
      const where = location?.name ?? state.currentLocationId ?? "a place";
      situation = `The player is at a specific spot within ${where}. Anyone present here is a person to interact with directly.`;
    }

    lines.push(
      "You are the world narrator. Write the next beat of the story.",
      "",
      "Always write prose as your reply text — the reply text IS what the player reads.",
      "Emit a tool call for any mechanical change (movement, picking something up, an NPC hailing the player, etc.); state only changes via tools.",
      "Do not call `narrate` — your reply text is the narration.",
      "Do not write tool names, function arguments, or stage directions in your prose.",
      "Tool calls go through the function-calling channel, NEVER as text. Never type `say(...)`, `engage(...)`, `move_region(...)`, etc. inside the reply text — those must be structured tool calls. If you find yourself typing a function name with parentheses in your prose, stop and emit it as a real tool call instead.",
      "If the action is impossible, describe the refusal in prose and skip the tool call.",
      "When the player enters or leaves a place, write the crossing itself — what changes around them — not the state after. They are moving from one place to another; do not write \"you are already there\".",
      "",
      situation,
      region?.basicInfo ? region.basicInfo.slice(0, 280) : "",
    );

    // Only show the location's authored description when the player is
    // ACTUALLY inside it. In region mode the engine still remembers the
    // last visited location id, but advertising that as the current
    // location while the player is technically outside it confuses the
    // model into narrating "you're already there". For
    // `region.enterLocation` we already named the destination in the
    // situation line above; we also include its description here so the
    // narrator has flavor to draw on for the crossing.
    if (state.mode !== "region" && location) {
      lines.push(
        `  About ${location.name ?? state.currentLocationId}: ${location.basicInfo?.slice(0, 280) ?? ""}`,
      );
    } else if (destLoc) {
      lines.push(
        `  About ${destLoc.name ?? destName}: ${destLoc.basicInfo?.slice(0, 280) ?? ""}`,
      );
    }

    const grid = state.mode === "region" ? state.regionGrid : state.locationGrid;
    const pos =
      state.mode === "region" ? state.regionPos : state.locationPos;
    if (grid) {
      const here = getTile(grid, pos[0], pos[1]);
      if (here) {
        lines.push(
          `Current tile: kind="${here.kind}", label="${here.label ?? ""}".`,
        );
      }
      const adj = adjacentSummary(grid, pos);
      if (adj) lines.push(`Adjacent tiles: ${adj}`);

      const places =
        state.mode === "region"
          ? nearbyLocationsSummary(grid, pos)
          : namedAreasSummary(grid, pos);
      if (places) {
        lines.push(
          "",
          "Named places nearby (the ONLY landmarks you may reference by name —",
          "do NOT invent other place names, mountain ranges, rivers or settlements;",
          "if you need to describe distance or direction, use these and the player's",
          "offset to them):",
          places,
        );
      } else {
        lines.push(
          "",
          "Named places nearby: none on this grid. Do NOT invent proper-noun",
          "landmarks — paint the terrain only.",
        );
      }
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

    const tileBit = tile?.label
      ? `, at ${tile.label}`
      : tile?.kind
        ? `, on a ${tile.kind}`
        : "";
    const placeBlurb =
      location?.basicInfo?.slice(0, 280) ?? region?.basicInfo?.slice(0, 280) ?? "";

    const lines: string[] = [];
    lines.push(
      "You are the scene narrator. The player is up close — close enough to interact directly with whoever and whatever is here.",
      "",
      "Every turn has TWO outputs: prose (your reply text) AND any tool calls. The reply text is the narrator's beat for this moment; it is never optional, even during dialogue. NPC speech goes through `say` — never put quoted speech in your prose.",
      "Write a short narrative paragraph (1-4 sentences) in the reply text — what the player sees, hears, smells, what the NPC's body does as they speak, the texture of the moment. Then emit the NPC's actual line via `say`. Dialogue without surrounding narration is forbidden; the player must always get something to picture.",
      "For NPC speech, call `say({npcId, text})`. When the player addresses someone present, that person answers via `say`, not in your prose. The npcId must be one of the ids listed for people present — never invent names or ids.",
      "For other mechanical changes (engage, disengage, start_combat, end_combat, give_item, offer_quest, etc.), call the matching tool. Pass ids exactly as listed below — pass the `id=...` value, not the `name=...`.",
      "Do not call `narrate` — your reply text is the narration.",
      "Do not write tool names, function arguments, or stage directions in your prose.",
      "Tool calls go through the function-calling channel, NEVER as text. Never type `say(...)`, `engage(...)`, `disengage(...)`, etc. inside the reply text — those must be structured tool calls. If you find yourself typing a function name with parentheses in your prose, stop and emit it as a real tool call instead.",
      "When the player addresses someone, that person answers — use `say` for the answer. Don't have bystanders chime in unprompted. Don't write \"no one reacts\"; if a person chooses silence, write their body language and still emit a `say` with what they actually mutter.",
      "If the player asks for something the situation forbids, write the refusal in prose and skip the tool call.",
      "If the player signals they want to leave the engaged group (clicks Leave, says \"I walk away\", \"I'm done here\", etc.), call `disengage({groupId: <engaged group id>})` and write one short prose beat describing the parting. Do NOT narrate the player as unable to leave on their own initiative.",
      "Stay grounded: NPC speech and your narration must reference only places, factions, NPCs, and items that appear in the context below. Do not invent named taverns, inns, shops, towns, rivers, or other landmarks. If an NPC suggests a place, it must come from the listed nearby landmarks; otherwise describe it abstractly (\"a quieter spot down the road\") without naming it.",
      "",
      `The player is in ${location?.name ?? state.currentLocationId ?? "this place"}, in the region of ${region?.name ?? state.currentRegionId}${tileBit}.`,
      placeBlurb,
      tileObj?.questMarker
        ? `Quest marker at this spot: ${JSON.stringify(tileObj.questMarker)}`
        : "",
      "",
      lockNote,
    );

    // Inject named places the player can see from this scene. At scene
    // level we also surface the region-grid anchors so "look around"
    // can mention distant landmarks the player would plausibly see on
    // the horizon, but only ones that actually exist in the world.
    if (state.regionGrid) {
      const places = nearbyLocationsSummary(
        state.regionGrid,
        state.regionPos,
      );
      if (places) {
        lines.push(
          "",
          "Named places in this region (the ONLY landmarks you may name —",
          "do NOT invent ranges, rivers, or settlements):",
          places,
        );
      }
    }
    if (state.locationGrid) {
      const areas = namedAreasSummary(state.locationGrid, [
        tile?.x ?? 0,
        tile?.y ?? 0,
      ]);
      if (areas) {
        lines.push("", "Named sub-areas in this location:", areas);
      }
    }
    if (groups.length > 0) {
      lines.push(
        "**Characters** (kind=character, ids `world-npc-*`) are authored and always standalone — one NPC per entry. Do not `spawn_party` duplicates for the same npcIds.",
        "**Parties** (kind=party) are procedural: either one stranger, 2–3 NPCs together (merchants, thieves, enemies), or anonymous (empty npcIds) with a descriptive name. If persuasion or story should move an NPC between parties, `dismiss_party` the old group and `spawn_party` with the updated npcIds.",
        "",
        "Groups present in this scene (use these npcIds for `say` calls — NEVER invent new NPC names or ids; if you need a new face, `spawn_party` first):",
      );
      const engagedGroups = groups.filter(
        (g) => g.state === "engaged" || g.state === "locked",
      );
      const engagedNpcIds: string[] = [];
      for (const g of groups) {
        const role = g.kind === "character" ? "character" : "party";
        const engagedTag =
          g.state === "engaged" || g.state === "locked" ? " ★ENGAGED" : "";
        const groupHeader = `  - [${role}] id=${g.id} name="${g.name}" state=${g.state}${engagedTag}${g.summary ? ` :: ${g.summary}` : ""}`;
        lines.push(groupHeader);
        for (const npcId of g.npcIds) {
          if (g.state === "engaged" || g.state === "locked") {
            engagedNpcIds.push(npcId);
          }
          const npc = world.world.npcs[npcId];
          if (!npc) {
            lines.push(`      • npcId=${npcId} (no authored profile)`);
            continue;
          }
          const npcType = npc.type ? world.world.npcTypes[npc.type] : undefined;
          const traits: string[] = [];
          if (npc.gender) traits.push(npc.gender);
          if (npcType?.name) traits.push(npcType.name);
          else if (npc.type) traits.push(npc.type);
          if (npc.faction) traits.push(`faction:${npc.faction}`);
          const traitLine = traits.length > 0 ? ` — ${traits.join(", ")}` : "";
          const personalityLine =
            npc.personality && npc.personality.length > 0
              ? `; personality: ${npc.personality.join(", ")}`
              : "";
          const desc = npcType?.description
            ? ` :: ${npcType.description.slice(0, 200).replace(/\s+/g, " ").trim()}`
            : "";
          lines.push(
            `      • npcId=${npcId} name="${npc.name ?? npcId}"${traitLine}${personalityLine}${desc}`,
          );
        }
      }

      // Focal-character emphasis. When exactly one group is engaged and
      // it has exactly one NPC, name that NPC as THE focal character so
      // the LLM directs all dialogue to them and ignores any bystanders
      // in the rest of the scene.
      if (engagedGroups.length === 1 && engagedGroups[0].npcIds.length === 1) {
        const focalId = engagedGroups[0].npcIds[0];
        const focalNpc = world.world.npcs[focalId];
        const focalName = focalNpc?.name ?? engagedGroups[0].name;
        lines.push(
          "",
          `FOCAL CHARACTER: ${focalName} (npcId=${focalId}).`,
          `The player is currently in conversation with ${focalName}. ALL dialogue this turn flows to/from them — other NPCs on the tile are bystanders and should NOT speak unless the player explicitly addresses them. When the player speaks, ${focalName} responds via \`say({"npcId": "${focalId}", "text": "..."})\`. Do NOT have other NPCs chime in unprompted.`,
        );
      } else if (engagedNpcIds.length > 0) {
        lines.push(
          "",
          `Engaged NPC(s) this turn: ${engagedNpcIds.join(", ")}. When the player addresses dialogue at any of them, use \`say({"npcId": "<one of the above>", "text": "..."})\` — never with a name or id that isn't in the list above.`,
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
      "Reply format: prose in the assistant content channel (streams as narration); tool calls for every mechanical change. `say` is reserved for NPC speech that should appear as a separate dialogue line. Do not call `narrate`.",
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
