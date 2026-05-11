import type { LlmAdapter } from "../llm/adapter";
import type { Narrator } from "./narrator";
import type { IndexedWorld } from "../world/indexer";
import { useStore, type StoreState } from "../state/store";
import { DIALOGUE_TOOLS } from "./tools";
import { findRegionWalkPath } from "../grid/pathing";
import { getTile } from "../grid/tilePrimitives";
import { diag } from "../diag/log";
import { buildSystemPrompt } from "../llm/promptBuilder";
import { ENGINE_PROMPTS } from "../llm/systemPrompts";
import { movementContext } from "./narratorPromptHelpers";
import type { PlayerIntent } from "./playerIntent";
import { tileLabel } from "./narratorPromptHelpers";

export type { Direction, SceneVerb, PlayerIntent } from "./playerIntent";

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
      diag.info("narrator", `intent submitted: ${intent.kind}`, {
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
      diag.info("narrator", `narrator response received`, {
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
      diag.error("narrator", "intent dispatch failed", {
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
    return buildSystemPrompt({
      world: this.world.world,
      operation: "story.traversal",
      engineHeader: ENGINE_PROMPTS.storyTraversal(state, intent, this.world),
    });
  }

  private composeScenePrompt(state: StoreState): string {
    return buildSystemPrompt({
      world: this.world.world,
      operation: "story.scene",
      engineHeader: ENGINE_PROMPTS.storyScene(state, this.world),
    });
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

    if (intent.kind === "region.travelTo") {
      const st = useStore.getState();
      const g = st.regionGrid;
      const pos = st.regionPos;
      if (!g) return;
      const path = findRegionWalkPath(
        g,
        { x: pos[0], y: pos[1] },
        { x: intent.x, y: intent.y },
      );
      if (!path || path.length < 2) return;
    }

    diag.warn("narrator", "LLM omitted canonical tool — running fallback", {
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
    case "region.travelTo": {
      const tile = state.regionGrid
        ? getTile(state.regionGrid, intent.x, intent.y)
        : undefined;
      const label =
        (tile?.locationId && world.locations[tile.locationId]?.name) ||
        tileLabel(tile) ||
        `tile (${intent.x},${intent.y})`;
      return `You travel to ${label}.`;
    }
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

/**
 * The set of mechanical tool names that satisfy a given intent. If none
 * of these names appears in the LLM's tool calls, the fallback runner
 * synthesises the call locally so the player's click still has effect.
 */
function canonicalToolFor(intent: PlayerIntent): string[] {
  switch (intent.kind) {
    case "region.move":
      return ["move_region"];
    case "region.travelTo":
      return ["travel_region"];
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
    case "region.travelTo":
      return { name: "travel_region", arguments: { x: intent.x, y: intent.y } };
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
