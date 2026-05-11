import type { LlmAdapter } from "../llm/adapter";
import type { Narrator } from "./narrator";
import type { IndexedWorld } from "../world/indexer";
import { useStore, type StoreState } from "../state/store";
import { DIALOGUE_TOOLS } from "./tools";
import { getTile, type Tile } from "../grid/tilePrimitives";
import {
  describeLock,
  isPlayerLocked,
  sortedGroupsForView,
} from "../scene/engagement";
import { diag } from "../diag/log";

/**
 * `WorldNarrator` is the SINGLE entry-point for every player action — map
 * clicks, exit clicks, free-text scene input, group buttons. Whatever the
 * surface gesture is, it gets translated into a structured `PlayerIntent`,
 * pushed into the visible story log, and run through the LLM with the full
 * tool catalogue available. The LLM is expected to:
 *
 *   1. Emit the canonical mechanical tool call (e.g. `move_region`).
 *   2. Emit `narrate` prose describing what happened.
 *   3. Optionally emit *additional* tool calls that flesh out the world
 *      (spawn an encounter, drop loot, hand out a quest hook).
 *
 * If the LLM is unavailable (rate limit, network, schema error), we fall
 * back to a deterministic dispatch so the game doesn't soft-lock — the
 * player still moves, but the narration line is a brief stand-in.
 *
 * This class also tracks an in-flight pending-narrations counter so the
 * narration panel can show a "Narrator responding…" pill while a player
 * intent's LLM round-trip is still resolving.
 */

export type Direction = "north" | "south" | "east" | "west";

export type SceneVerb = "talk" | "attack" | "trade" | "leave" | "engage";

export type PlayerIntent =
  | { kind: "region.move"; dx: number; dy: number }
  | { kind: "region.enterLocation"; locationId: string }
  | { kind: "location.move"; dx: number; dy: number }
  | { kind: "location.enterTile"; x: number; y: number }
  | { kind: "location.leave"; direction?: Direction }
  | { kind: "scene.leaveTile" }
  /**
   * Generic free-text action. Mode-agnostic: the player can type anything
   * from any screen ("inspect the well", "yell for help", "rummage in my
   * pack"). Routed to the scene system prompt when we're in a scene
   * (because it can produce dialogue / engagement changes), and to the
   * traversal system prompt when we're on the region or location map
   * (because it can produce arbitrary narration plus optional tool calls
   * like spawn_group or give_item).
   */
  | { kind: "freetext"; text: string }
  | { kind: "scene.button"; verb: SceneVerb; groupId: string };

const DIR_NAMES: Record<string, string> = {
  "1,0": "east",
  "-1,0": "west",
  "0,1": "north",
  "0,-1": "south",
};

function dirName(dx: number, dy: number): string {
  return DIR_NAMES[`${dx},${dy}`] ?? "onward";
}

/**
 * Look at the tile the player is standing on AND the tile they're
 * trying to step onto, so both the intent text in the story log and
 * the system-prompt hint to the LLM can name the spots involved.
 * Without this, every step reads as "you walk east" regardless of
 * whether the player is leaving an inn for a market square or
 * shouldering up against a stone wall — both massive UX problems
 * once the same generic line appears five times in a row.
 */
type MoveContext = {
  direction: string;
  fromLabel?: string;
  toLabel?: string;
  toPassable: boolean | undefined;
};

function movementContext(
  intent:
    | { kind: "region.move"; dx: number; dy: number }
    | { kind: "location.move"; dx: number; dy: number },
  state: StoreState,
): MoveContext {
  const direction = dirName(intent.dx, intent.dy);
  const grid =
    intent.kind === "region.move" ? state.regionGrid : state.locationGrid;
  const pos =
    intent.kind === "region.move" ? state.regionPos : state.locationPos;
  if (!grid) {
    return { direction, toPassable: undefined };
  }
  const here = getTile(grid, pos[0], pos[1]);
  const target = getTile(grid, pos[0] + intent.dx, pos[1] + intent.dy);
  return {
    direction,
    fromLabel: tileLabel(here),
    toLabel: tileLabel(target),
    toPassable: target?.passable,
  };
}

function tileLabel(tile: Tile | undefined): string | undefined {
  if (!tile) return undefined;
  // Prefer the human label (e.g. "Inn Garden") but fall back to the
  // kebab-case kind ("wall" -> "wall") so we always have *something*
  // for the narration to anchor on.
  return (tile.label ?? tile.kind)?.replace(/\s+/g, " ").trim() || undefined;
}

export class WorldNarrator {
  private readonly llm: LlmAdapter;
  private readonly narrator: Narrator;
  private readonly world: IndexedWorld;

  constructor(opts: { llm: LlmAdapter; narrator: Narrator; world: IndexedWorld }) {
    this.llm = opts.llm;
    this.narrator = opts.narrator;
    this.world = opts.world;
  }

  /**
   * Submit a structured player intent. Always logs the intent to the
   * story log, then runs it through the LLM. Resolves once the response
   * (or fallback) has been applied. Throws are caught and surfaced as
   * an "error" story entry so the panel never gets stuck waiting.
   */
  async submitPlayerIntent(intent: PlayerIntent): Promise<void> {
    const state = useStore.getState();
    const intentText = describeIntent(intent, state, this.world);
    if (!intentText) return;

    state.appendStory({ kind: "player", text: intentText });
    state.setPendingNarrations(+1);
    try {
      const system = this.composeSystemPrompt(intent);
      const userMessage = composeUserMessage(intent, intentText, state);
      diag.info("world-narrator", `intent submitted: ${intent.kind}`, {
        intent,
        intentText,
      });
      const response = await this.llm.complete(
        {
          system,
          messages: [{ role: "user", content: userMessage }],
          tools: DIALOGUE_TOOLS,
        },
        { kind: "chat" },
      );
      diag.info("world-narrator", `narrator response received`, {
        intent: intent.kind,
        toolCalls: (response.toolCalls ?? []).map((tc) => tc.name),
        responseLength: response.text?.length ?? 0,
      });
      const results = await this.narrator.applyResponse(response);

      // Safety net: if the LLM forgot to emit the canonical mechanical
      // tool (e.g. it narrated a walk but didn't call `move_region`),
      // we run the deterministic fallback so the world state catches up
      // with the player's intent. Otherwise the player would see prose
      // but the map wouldn't change, which is the worst possible UX.
      await this.runFallbackIfNeeded(intent, response.toolCalls ?? [], results);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      diag.error("world-narrator", "intent dispatch failed", {
        intent: intent.kind,
        error: err instanceof Error ? err : msg,
      });
      state.appendStory({
        kind: "error",
        text: `(Narrator paused: ${msg}. The world reacts mechanically.)`,
      });
      // Even on LLM failure, we still want the player to MOVE — otherwise
      // a single 429 would soft-lock traversal. Run the deterministic
      // dispatch directly so the click has effect.
      await this.runFallback(intent);
    } finally {
      state.setPendingNarrations(-1);
    }
  }

  /**
   * Compose the system prompt for an intent. Region / location prompts
   * are deliberately leaner than the scene-mode prompt: traversal turns
   * are frequent and the LLM doesn't need a full engagement/inventory
   * dump for "you walk west". The scene-mode prompt retains the full
   * detail because the model has to make tactical engagement decisions.
   */
  private composeSystemPrompt(intent: PlayerIntent): string {
    const state = useStore.getState();
    // Scene-flavoured intents always use the rich scene prompt. Generic
    // free-text routes by current mode: in a scene, we want the
    // engagement / dialogue context; on the map, we want the leaner
    // traversal prompt so the model can narrate ambient action without
    // pretending the player is in a fight.
    const isSceneIntent =
      intent.kind === "scene.leaveTile" ||
      intent.kind === "scene.button" ||
      (intent.kind === "freetext" && state.mode === "scene");
    if (isSceneIntent) {
      return this.composeScenePrompt(state);
    }
    return this.composeTraversalPrompt(state, intent);
  }

  private composeTraversalPrompt(state: StoreState, intent: PlayerIntent): string {
    const region = state.currentRegionId
      ? this.world.regionsById[state.currentRegionId]
      : undefined;
    const location = state.currentLocationId
      ? this.world.locations[state.currentLocationId]
      : undefined;
    const lines: string[] = [];

    lines.push(
      "You are the world narrator for a 2D fantasy adventure game.",
      "Every player intent passes through you. For each intent you MUST:",
      "  1. Emit the canonical mechanical tool call (e.g. move_region for region.move). State changes ONLY happen via tool calls.",
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
      const adj = adjacentSummary(grid, state.mode === "region" ? state.regionPos : state.locationPos);
      if (adj) lines.push(`Adjacent tiles: ${adj}`);
    }

    lines.push("", intentHintLine(intent, state));

    if (state.activeQuestIds.length > 0) {
      const quests = state.activeQuestIds
        .map((qid) => {
          const q = this.world.world.quests[qid];
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
          const n = this.world.world.npcs[id];
          return `  - ${id}${n?.name ? ` — ${n.name}` : ""}`;
        }),
        "Use `add_to_player_party` / `remove_from_player_party` when someone joins or leaves the hero's journey (separate from one-off `spawn_party` encounters on a tile).",
      );
    }

    lines.push(
      "",
      "Style: present-tense, sensory, 3-5 sentences per `narrate` call. Vary sentence length. NEVER say 'as an AI'.",
    );
    return lines.join("\n");
  }

  private composeScenePrompt(state: StoreState): string {
    const region = state.currentRegionId
      ? this.world.regionsById[state.currentRegionId]
      : undefined;
    const location = state.currentLocationId
      ? this.world.locations[state.currentLocationId]
      : undefined;
    const tile = state.currentSceneTile;
    const tileObj: Tile | undefined = tile && state.locationGrid?.tiles[
      tile.y * (state.locationGrid?.width ?? 0) + tile.x
    ];

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
        const quest = this.world.world.quests[qid];
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
      "Style: present-tense, sensory, 3-5 sentences per `narrate` call (vary length; never pad). NEVER acknowledge being an AI.",
      "Reply MUST be valid for the tool catalogue. Use `narrate` for ambient prose, `say` for in-character NPC speech, and the mechanical tools for state changes.",
      "Companion strip: `add_to_player_party` / `remove_from_player_party` maintain who travels with the hero (engine-capped); not the same as scene `spawn_party` bands.",
    );

    return lines.join("\n");
  }

  /**
   * If the LLM forgot to emit the canonical mechanical tool for the
   * intent (it can happen — Gemini sometimes only narrates), run the
   * deterministic dispatch as a safety net so the world state catches
   * up with the player's expectation.
   */
  private async runFallbackIfNeeded(
    intent: PlayerIntent,
    toolCalls: Array<{ name: string }>,
    _results: Array<{ ok: boolean }>,
  ): Promise<void> {
    const sawCanonical = toolCalls.some((c) =>
      canonicalToolFor(intent).includes(c.name),
    );
    if (sawCanonical) return;

    // If the intent is a movement attempt against a tile we already
    // know is impassable, the deterministic dispatcher would just
    // reject the call — there's no point firing it as a "safety net".
    // The LLM was told (via the system prompt) NOT to emit the
    // mechanical tool in that case; omitting it is the correct
    // outcome, not a forgotten one.
    if (
      (intent.kind === "region.move" || intent.kind === "location.move") &&
      movementContext(intent, useStore.getState()).toPassable === false
    ) {
      return;
    }

    diag.warn("world-narrator", "LLM omitted canonical tool — running fallback", {
      intent: intent.kind,
      toolCalls: toolCalls.map((c) => c.name),
    });
    await this.runFallback(intent);
  }

  private async runFallback(intent: PlayerIntent): Promise<void> {
    const call = canonicalCallFor(intent);
    if (!call) return;
    await this.narrator.dispatch(call);
  }
}

// ---------------- helpers

function describeIntent(
  intent: PlayerIntent,
  state: StoreState,
  world: IndexedWorld,
): string {
  switch (intent.kind) {
    case "region.move": {
      const ctx = movementContext(intent, state);
      if (ctx.toLabel && ctx.toPassable === false) {
        // The player aimed at something they can't enter (a cliff, a
        // sealed gate, the edge of a deep river). Phrase the intent as
        // an attempt, not an accomplishment, so the log doesn't read as
        // if they walked through the obstacle.
        return `You try to head ${ctx.direction}, toward ${ctx.toLabel}.`;
      }
      if (ctx.toLabel) {
        return `You set off ${ctx.direction} toward ${ctx.toLabel}.`;
      }
      return `You set off ${ctx.direction}.`;
    }
    case "region.enterLocation": {
      const name =
        world.locations[intent.locationId]?.name ?? intent.locationId;
      return `You step into ${name}.`;
    }
    case "location.move": {
      const ctx = movementContext(intent, state);
      if (ctx.toLabel && ctx.toPassable === false) {
        return `You try to walk ${ctx.direction}, toward the ${ctx.toLabel}.`;
      }
      if (ctx.toLabel && ctx.fromLabel) {
        return `You walk ${ctx.direction}, leaving ${ctx.fromLabel} for ${ctx.toLabel}.`;
      }
      if (ctx.toLabel) {
        return `You walk ${ctx.direction} toward ${ctx.toLabel}.`;
      }
      return `You walk ${ctx.direction}.`;
    }
    case "location.enterTile": {
      const tile = state.locationGrid
        ? getTile(state.locationGrid, intent.x, intent.y)
        : undefined;
      const label = tile?.label ?? tile?.kind ?? "this spot";
      return `You step into ${label}.`;
    }
    case "location.leave":
      return intent.direction
        ? `You head out of the location, ${intent.direction}.`
        : `You step back out onto the road.`;
    case "scene.leaveTile":
      return `You leave the scene.`;
    case "freetext":
      return intent.text;
    case "scene.button": {
      const group = state.engagement.groups[intent.groupId];
      const groupName = group?.name ?? intent.groupId;
      switch (intent.verb) {
        case "talk":
          return `You speak to ${groupName}.`;
        case "attack":
          return `You attack ${groupName}.`;
        case "trade":
          return `You signal that you want to trade with ${groupName}.`;
        case "leave":
          return `You make to leave ${groupName} and the area.`;
        case "engage":
          return `You approach ${groupName}.`;
      }
    }
  }
}

function composeUserMessage(
  intent: PlayerIntent,
  intentText: string,
  state: StoreState,
): string {
  if (intent.kind === "freetext") {
    // In a scene, recent NPC / player back-and-forth gives the model
    // crucial context for tone and continuity. On the map there's no
    // equivalent — each step is its own beat — so we send just the raw
    // action and let the system prompt's tile / region context carry
    // the load.
    if (state.mode === "scene") {
      const recent = state.dialogue.slice(-6);
      const transcript = recent
        .map((m) => `${m.role === "player" ? "Player" : "NPC"}: ${m.text}`)
        .join("\n");
      if (transcript) {
        return `Recent dialogue:\n${transcript}\n\nPlayer action: ${intent.text}`;
      }
    }
    return `Player action: ${intent.text}`;
  }
  return `Player intent: ${intentText}`;
}

function intentHintLine(intent: PlayerIntent, state: StoreState): string {
  switch (intent.kind) {
    case "region.move": {
      const ctx = movementContext(intent, state);
      return movementHint("move_region", ctx, "region");
    }
    case "region.enterLocation":
      return `Player intent: enter the named location. Emit enter_location({locationId:"${intent.locationId}"}) and a narrate call describing the threshold.`;
    case "location.move": {
      const ctx = movementContext(intent, state);
      return movementHint("move_location", ctx, "location");
    }
    case "location.enterTile":
      return `Player intent: enter the location tile at (${intent.x},${intent.y}) — transitions to scene mode. Emit enter_tile({x:${intent.x},y:${intent.y}}) and a narrate call setting the scene.`;
    case "location.leave":
      return intent.direction
        ? `Player intent: leave the location to the ${intent.direction}. Emit leave_location({direction:"${intent.direction}"}) and a narrate call.`
        : `Player intent: leave the location. Emit leave_location({}) and a narrate call.`;
    case "freetext":
      return `Player intent: a free-form action — "${intent.text}". Decide what (if anything) it changes in the world. Always emit a narrate call describing what the player perceives. If the action implies a mechanical change (item picked up, NPC summoned to greet them, quest taken, position changed), also emit the matching tool call. If the action is impossible or has no in-world effect, just narrate the attempt or its failure.`;
    default:
      return "";
  }
}

/**
 * Compose the per-step hint that nudges the LLM to (a) ground its
 * narration in the actual origin and destination tiles, and (b) treat
 * impassable targets as a hard stop — narrate the obstacle, do NOT
 * emit the movement tool. Without (a), every step reads as "you walk
 * east" with no anchoring. Without (b), the LLM cheerfully narrates a
 * walk that the deterministic dispatcher then refuses, and the player
 * sees prose about moving when the map clearly hasn't.
 */
function movementHint(
  toolName: "move_region" | "move_location",
  ctx: MoveContext,
  gridKind: "region" | "location",
): string {
  const from = ctx.fromLabel ? `"${ctx.fromLabel}"` : "the current tile";
  const to = ctx.toLabel ? `"${ctx.toLabel}"` : "the adjacent tile";

  if (ctx.toPassable === false) {
    return [
      `Player intent: attempt to walk ${ctx.direction} on the ${gridKind} grid,`,
      `from ${from} toward ${to}.`,
      `The destination tile is IMPASSABLE — DO NOT emit ${toolName};`,
      `the player does not move. In your single \`narrate\` call,`,
      `make it unmistakable that ${to} stops them: describe approaching it,`,
      `running into it, and turning back. Reference both ${from} (where they`,
      `still stand) and ${to} (the obstacle) by name so the line reads as a`,
      `failed step, not a successful one.`,
    ].join(" ");
  }

  return [
    `Player intent: walk one cell ${ctx.direction} on the ${gridKind} grid,`,
    `from ${from} toward ${to}.`,
    `Emit ${toolName}({direction:"${ctx.direction}"}) and a single \`narrate\` call.`,
    `Name BOTH ${from} (where the step began) and ${to} (where the step ends)`,
    `in the prose so the journey reads as transit — leaving one tile,`,
    `arriving at the next — rather than a generic "you walk ${ctx.direction}".`,
  ].join(" ");
}

function adjacentSummary(
  grid: { width: number; height: number; tiles: Tile[] },
  pos: readonly [number, number],
): string {
  const dirs: Array<[string, number, number]> = [
    ["N", 0, 1],
    ["S", 0, -1],
    ["E", 1, 0],
    ["W", -1, 0],
  ];
  const parts: string[] = [];
  for (const [name, dx, dy] of dirs) {
    const x = pos[0] + dx;
    const y = pos[1] + dy;
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
      parts.push(`${name}=edge`);
      continue;
    }
    const t = getTile(
      grid as unknown as { width: number; height: number; tiles: Tile[] },
      x,
      y,
    );
    if (!t) continue;
    const label = (t.label ?? t.kind).replace(/\s+/g, " ");
    parts.push(`${name}=${label}${t.passable ? "" : "(blocked)"}`);
  }
  return parts.join(", ");
}

/**
 * The set of mechanical tool names that satisfy a given intent. If none
 * of these names appears in the LLM's tool calls, the fallback runner
 * synthesises the call locally so the player's click still has effect.
 */
function canonicalToolFor(intent: PlayerIntent): string[] {
  switch (intent.kind) {
    case "region.move":
      return ["move_region"];
    case "region.enterLocation":
      return ["enter_location"];
    case "location.move":
      return ["move_location"];
    case "location.enterTile":
      return ["enter_tile"];
    case "location.leave":
      return ["leave_location"];
    case "scene.leaveTile":
      return ["leave_tile"];
    case "freetext":
    case "scene.button":
      // Free-text and scene buttons don't have a single canonical tool
      // (the LLM picks among say/engage/disengage/start_combat/etc.,
      // or just narrates with no mechanical change). We trust the
      // model and don't fall back.
      return [];
  }
}

function canonicalCallFor(
  intent: PlayerIntent,
): { name: string; arguments: Record<string, unknown> } | null {
  switch (intent.kind) {
    case "region.move":
      return { name: "move_region", arguments: { dx: intent.dx, dy: intent.dy } };
    case "region.enterLocation":
      return {
        name: "enter_location",
        arguments: { locationId: intent.locationId },
      };
    case "location.move":
      return {
        name: "move_location",
        arguments: { dx: intent.dx, dy: intent.dy },
      };
    case "location.enterTile":
      return { name: "enter_tile", arguments: { x: intent.x, y: intent.y } };
    case "location.leave":
      return {
        name: "leave_location",
        arguments: intent.direction ? { direction: intent.direction } : {},
      };
    case "scene.leaveTile":
      return { name: "leave_tile", arguments: {} };
    case "freetext":
    case "scene.button":
      return null;
  }
}
