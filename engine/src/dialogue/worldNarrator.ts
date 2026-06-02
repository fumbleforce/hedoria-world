import type { LlmAdapter } from "../llm/adapter";
import type { Narrator } from "./narrator";
import type { IndexedWorld } from "../world/indexer";
import { useStore, type StoreState } from "../state/store";
import { DIALOGUE_TOOLS, isMovementTool, toolsForTurn } from "./tools";
import { extractInlineToolCalls } from "./inlineToolExtractor";
import { findRegionWalkPath } from "../grid/pathing";
import { getTile } from "../grid/tilePrimitives";
import { diag } from "../diag/log";
import { buildSystemPrompt } from "../llm/promptBuilder";
import { STORY_ENGINE_PROMPTS } from "../llm/storyEnginePrompts";
import { dirName, movementContext, tileLabel } from "./narratorPromptHelpers";
import type { PlayerIntent } from "./playerIntent";
import {
  defaultOutcome,
  parseOutcome,
  type ActionOutcome,
} from "../schema/actionOutcome";
import type { LlmResponse } from "../llm/types";

export type { Direction, SceneVerb, PlayerIntent } from "./playerIntent";

/**
 * `WorldNarrator` is the SINGLE entry-point for every player action — map
 * clicks, exit clicks, free-text scene input, group buttons. Whatever the
 * surface gesture is, it gets translated into a structured `PlayerIntent`,
 * pushed into the visible story log, and run through a two-phase LLM
 * pipeline:
 *
 *   1. Evaluator call (`kind: "action-eval"`, JSON-mode, no tools):
 *      decides verdict + interrupt + condition deltas from the current
 *      story state. A failure here yields a sane default outcome so
 *      gameplay continues.
 *   2. Narrator call (`kind: "chat"`, streaming, scoped tool catalogue):
 *      writes prose in the assistant content channel (streams to the
 *      narration panel in real time) and emits mechanical tool calls
 *      atomically after the stream completes.
 *
 * Streamed prose is committed as a narration entry on stream-end. If
 * the LLM is unavailable (rate limit, network, schema error), we fall
 * back to a deterministic dispatch so the game doesn't soft-lock — the
 * player still moves, but the narration line is a brief stand-in.
 *
 * Every turn produces a `TurnResolution` record (audit trail) and ticks
 * expired player conditions up front so the evaluator reads a current
 * status sheet.
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
    const startedAt = Date.now();
    // Reap expired conditions BEFORE the evaluator runs so the
    // evaluator's "what is currently impossible?" reading isn't lying.
    useStore.getState().tickConditions(startedAt);
    const state = useStore.getState();
    const intentText = describeIntent(intent, state, this.world);
    if (!intentText) return;
    const turnId = crypto.randomUUID();
    const preStoryLogLength = state.storyLog.length;

    state.appendStory({ kind: "player", text: intentText });
    state.setPendingNarrations(+1);
    try {
      // The action evaluator only runs for free-form prose intent —
      // that's where the engine has to interpret "can the player do
      // this?". UI clicks (movement, enter/leave, scene buttons) are
      // unambiguous mechanical intent; running the evaluator on them
      // just burns a model call and risks the evaluator refusing the
      // click because the LLM read its own narration as if it were
      // world state ("you can't leave, the road is empty"). Skip it.
      const evaluated =
        intent.kind === "freetext"
          ? await this.evaluateAction(intent, intentText, turnId)
          : this.fillCanonical(intent, defaultOutcome(intentText));
      const system = this.composeSystemPrompt(intent, evaluated);
      const userMessage = composeUserMessage(
        intent,
        intentText,
        state,
        this.world,
        evaluated,
      );
      const scopedTools = toolsForTurn(intent, evaluated, useStore.getState().mode);
      diag.info("narrator", `intent submitted: ${intent.kind}`, {
        intent,
        intentText,
        turnId,
        outcome: evaluated.verdict,
        interrupt: evaluated.interrupt.kind,
        interruptTiming: evaluated.interrupt.timing,
      });
      // Evaluator-prescribed conditions apply up front so they show
      // in the UI (and downstream tool dispatch) regardless of whether
      // the narrator remembers to mirror them via `apply_condition`.
      await this.applyEvaluatorConditions(evaluated);
      state.beginPendingNarration(turnId);
      const response = await this.llm.complete(
        {
          system,
          messages: [{ role: "user", content: userMessage }],
          tools: scopedTools.length > 0 ? scopedTools : DIALOGUE_TOOLS,
        },
        {
          kind: "chat",
          turnId,
          stream: true,
          onDelta: (delta) => {
            if (delta.kind === "text") {
              useStore.getState().appendPendingNarration(delta.text);
            }
          },
        },
      );
      let allCalls = response.toolCalls ?? [];

      // Some smaller models emit tool calls as TEXT inside the prose
      // ("Goran watches her gesture. say({\"npcId\": \"...\", ...})")
      // instead of through the structured tool channel. Pull any such
      // patterns out of the streamed narration before commit: the
      // calls join `allCalls` so they actually take effect (NPC dialogue
      // lands, engagement state shifts, etc.) and the cleaned prose
      // becomes the narration entry — the player never sees the raw
      // function syntax.
      const rawStreamed = useStore.getState().pendingNarrationText;
      if (rawStreamed) {
        const knownToolNames = DIALOGUE_TOOLS.map((t) => t.name);
        const extracted = extractInlineToolCalls(rawStreamed, knownToolNames);
        if (extracted.calls.length > 0) {
          diag.warn("narrator", "extracted inline tool calls from prose", {
            turnId,
            calls: extracted.calls.map((c) => c.name),
            beforeLength: rawStreamed.length,
            afterLength: extracted.cleaned.length,
          });
          useStore.getState().replacePendingNarration(extracted.cleaned);
          for (const c of extracted.calls) {
            const args =
              c.arguments && typeof c.arguments === "object"
                ? (c.arguments as Record<string, unknown>)
                : {};
            allCalls = [...allCalls, { name: c.name, arguments: args }];
          }
        }
      }
      const streamedText = useStore.getState().pendingNarrationText.trim();
      // Prompt directs prose to the text channel, but some models still
      // emit `narrate` tool calls. Resolve the duplicate as follows:
      // - if streamed text exists, commit it and drop any redundant
      //   `narrate` calls (their text would double).
      // - if nothing streamed, dispatch tool calls as-is (the `narrate`
      //   handler will append the line).
      // `say` is always passed through — it's NPC dialogue, not narration.
      let dispatchCalls = allCalls;
      if (streamedText) {
        state.commitPendingNarration();
        dispatchCalls = allCalls.filter((c) => c.name !== "narrate");
      } else {
        state.clearPendingNarration();
        // Some smaller LLMs (e.g. glm-4-32b) emit ONLY a tool call and
        // skip the content channel entirely, leaving the player with a
        // blank narration after their click. If we have a tool call but
        // no prose, synthesize a one-line beat from authored world data
        // so the panel isn't dead. The prompt asks for prose every turn
        // — this is the safety net for when the model ignores that.
        if (allCalls.length > 0) {
          const synthesized = this.synthesizeNarrationFallback(intent);
          if (synthesized) {
            diag.warn("narrator", "LLM emitted tool calls with no prose — using synthesized narration", {
              intent: intent.kind,
              toolCalls: allCalls.map((c) => c.name),
              synthesizedLength: synthesized.length,
              turnId,
            });
            useStore.getState().appendNarration(synthesized);
          }
        }
      }
      diag.info("narrator", `narrator response received`, {
        intent: intent.kind,
        toolCalls: allCalls.map((tc) => tc.name),
        droppedNarrate: allCalls.length - dispatchCalls.length,
        streamedTextLength: streamedText.length,
        responseLength: response.text?.length ?? 0,
        turnId,
      });
      const results = await this.applyResponseWithNamedResults({
        ...response,
        toolCalls: dispatchCalls,
      });

      // Safety net: if the LLM forgot to emit the canonical mechanical
      // tool (e.g. it narrated a walk but didn't call `move_region`),
      // we run the deterministic fallback so the world state catches up
      // with the player's intent. Otherwise the player would see prose
      // but the map wouldn't change, which is the worst possible UX.
      await this.runFallbackIfNeeded(
        intent,
        response.toolCalls ?? [],
        results.map((r) => ({ ok: r.ok })),
        evaluated,
      );

      const postState = useStore.getState();
      const committed = postState.storyLog
        .slice(preStoryLogLength)
        .map((entry) => entry.id);
      postState.addTurnResolution({
        turnId,
        startedAt,
        completedAt: Date.now(),
        rawIntentKind: intent.kind,
        rawIntentText: intentText,
        interpretation: evaluated.interpretation,
        outcome: evaluated,
        narrativeText: response.text ?? "",
        toolCalls: response.toolCalls ?? [],
        toolResults: results.map((r) => ({
          name: r.name,
          ok: r.ok,
          message: r.message,
        })),
        committedStoryEntryIds: committed,
      });
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
      state.commitPendingNarration({
        asError: true,
        suffix: " (narrator cut off)",
      });
      // Even on LLM failure, we still want the player to MOVE — otherwise
      // a single 429 would soft-lock traversal. Run the deterministic
      // dispatch directly so the click has effect.
      await this.runFallback(intent);
      // Capture the failed turn so the audit trail isn't blind to crashes.
      const postState = useStore.getState();
      const committed = postState.storyLog
        .slice(preStoryLogLength)
        .map((entry) => entry.id);
      const fallbackOutcome = defaultOutcome(intentText);
      postState.addTurnResolution({
        turnId,
        startedAt,
        completedAt: Date.now(),
        rawIntentKind: intent.kind,
        rawIntentText: intentText,
        interpretation: fallbackOutcome.interpretation,
        outcome: fallbackOutcome,
        narrativeText: "",
        toolCalls: [],
        toolResults: [{ name: "(error)", ok: false, message: msg }],
        committedStoryEntryIds: committed,
      });
    } finally {
      state.setPendingNarrations(-1);
    }
  }

  /**
   * Apply conditions the evaluator prescribed on this turn. Each patch
   * gets a stable id minted here if the evaluator omitted one; the
   * narrator may still issue `clear_condition`/`apply_condition` to
   * adjust them in its response.
   */
  private async applyEvaluatorConditions(outcome: ActionOutcome): Promise<void> {
    if (outcome.appliesConditions.length === 0) return;
    const now = Date.now();
    const store = useStore.getState();
    for (const patch of outcome.appliesConditions) {
      const id =
        patch.id && patch.id.trim()
          ? patch.id.trim()
          : `cond-${Math.random().toString(36).slice(2, 10)}`;
      store.applyCondition({
        id,
        label: patch.label,
        severity: patch.severity ?? "normal",
        effects: patch.effects ?? [],
        notes: patch.notes,
        appliedAt: now,
        expiresAt: patch.expiresAt,
      });
    }
  }

  /**
   * Compose the system prompt for an intent. Region / location prompts
   * are deliberately leaner than the scene-mode prompt: traversal turns
   * are frequent and the LLM doesn't need a full engagement/inventory
   * dump for "you walk west". The scene-mode prompt retains the full
   * detail because the model has to make tactical engagement decisions.
   */
  private composeSystemPrompt(intent: PlayerIntent, outcome: ActionOutcome): string {
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
      return this.composeScenePrompt(state, outcome);
    }
    return this.composeTraversalPrompt(state, intent, outcome);
  }

  private composeTraversalPrompt(
    state: StoreState,
    intent: PlayerIntent,
    outcome: ActionOutcome,
  ): string {
    return buildSystemPrompt({
      world: this.world.world,
      operation: "story.traversal",
      engineHeader: [
        STORY_ENGINE_PROMPTS.storyTraversal(state, intent, this.world),
        "",
        `Evaluator verdict: ${outcome.verdict}`,
        `Evaluator reason: ${outcome.reason}`,
        `Interpretation: ${outcome.interpretation.summary}`,
      ].join("\n"),
    });
  }

  private composeScenePrompt(state: StoreState, outcome: ActionOutcome): string {
    return buildSystemPrompt({
      world: this.world.world,
      operation: "story.scene",
      engineHeader: STORY_ENGINE_PROMPTS.storyNarratorWithOutcome(
        state,
        this.world,
        `verdict=${outcome.verdict}; reason=${outcome.reason}; interpretation=${outcome.interpretation.summary}`,
      ),
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
    outcome: ActionOutcome,
  ): Promise<void> {
    // Deterministic UI clicks (everything that's not freetext) are the
    // player's unambiguous intent — the evaluator may not refuse them.
    // The evaluator's verdict only gates open-ended freetext attempts,
    // where the player is asking "can I?" and the engine has to judge.
    // A click on the Leave button means the player wants to leave; we
    // don't get to argue. Same for movement clicks, enter clicks, etc.
    const isUiClick = intent.kind !== "freetext";
    if (
      !isUiClick &&
      (outcome.verdict === "refused" || outcome.verdict === "failure")
    ) {
      return;
    }
    // Interrupt timing gates the fallback: a `before_action` ambush
    // should stop the player; a `replaces_action` event replaces the
    // attempt entirely. Only `after_action` (or no interrupt) lets the
    // canonical mechanical tool fire. UI clicks bypass this too — the
    // player's click is sacrosanct.
    if (
      !isUiClick &&
      outcome.interrupt.kind !== "none" &&
      outcome.interrupt.timing !== "after_action"
    ) {
      diag.info("narrator", "fallback suppressed by interrupt timing", {
        intent: intent.kind,
        interrupt: outcome.interrupt,
      });
      return;
    }
    const canonicalNames = canonicalToolFor(intent);
    // Some intents (freetext, scene.button) have NO canonical mechanical
    // tool — the LLM is free to just narrate or pick among say / engage
    // / etc. The narrator's reply text already streamed to the panel, so
    // there is nothing to fall back to. Skip silently rather than
    // logging a misleading "LLM omitted canonical tool" warning.
    if (canonicalNames.length === 0) return;
    const sawCanonical = toolCalls.some((c) => canonicalNames.includes(c.name));
    if (sawCanonical) return;
    // The LLM may have chosen the WRONG movement tool (e.g.
    // `leave_location` when the click was `scene.leaveTile`). Running
    // the canonical fallback on top would compound two transitions and
    // leave the player in a phantom mode with no location grid loaded.
    // If any movement-family tool fired we trust the model and skip the
    // fallback; a wrong transition is recoverable, double transitions
    // are not.
    if (toolCalls.some((c) => isMovementTool(c.name))) {
      diag.warn("narrator", "fallback skipped — LLM emitted a different movement tool", {
        intent: intent.kind,
        toolCalls: toolCalls.map((c) => c.name),
      });
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

    const canonicalCall = canonicalCallFor(intent);
    if (!canonicalCall) return;
    diag.warn("narrator", "LLM omitted canonical tool — running fallback", {
      intent: intent.kind,
      verb: intent.kind === "scene.button" ? intent.verb : undefined,
      expected: canonicalNames,
      seen: toolCalls.map((c) => c.name),
      fallback: canonicalCall.name,
    });
    await this.narrator.dispatch(canonicalCall);
  }

  private async runFallback(intent: PlayerIntent): Promise<void> {
    const call = canonicalCallFor(intent);
    if (!call) return;
    await this.narrator.dispatch(call);
  }

  /**
   * Synthesize a single narration line from authored world content when
   * the LLM emitted tool calls but no prose. This is a graceful-degrade
   * fallback so the player never sees a dead narration panel; the
   * canonical text we produce here is intentionally short and factual,
   * not a replacement for proper LLM prose.
   *
   * Returns `undefined` when there's nothing meaningful to synthesize
   * (the intent-text echo already covers the beat).
   */
  private synthesizeNarrationFallback(intent: PlayerIntent): string | undefined {
    const state = useStore.getState();
    switch (intent.kind) {
      case "region.enterLocation": {
        const loc = this.world.locations[intent.locationId];
        if (!loc) return undefined;
        const blurb = (loc.basicInfo ?? "").replace(/\s+/g, " ").trim();
        if (!blurb) return `You arrive in ${loc.name ?? intent.locationId}.`;
        const lead = blurb.length > 240 ? `${blurb.slice(0, 240)}…` : blurb;
        return `You arrive in ${loc.name ?? intent.locationId}. ${lead}`;
      }
      case "location.enterTile": {
        const grid = state.locationGrid;
        if (!grid) return undefined;
        const tile = getTile(grid, intent.x, intent.y);
        const label = tile?.label?.trim() || tile?.kind || "a new spot";
        const detail = tile?.desc?.trim() || "";
        const locName = state.currentLocationId
          ? this.world.locations[state.currentLocationId]?.name
          : undefined;
        if (detail) {
          const lead = detail.length > 220 ? `${detail.slice(0, 220)}…` : detail;
          return `You move to ${label}${locName ? ` in ${locName}` : ""}. ${lead}`;
        }
        return `You move to ${label}${locName ? ` in ${locName}` : ""}. ${tile?.kind ? `The ${tile.kind} stretches around you.` : ""}`.trim();
      }
      case "region.move":
      case "location.move": {
        const dir = dirName(intent.dx, intent.dy);
        return `You head ${dir}.`;
      }
      case "region.travelTo":
        return undefined;
      case "location.leave":
        return `You step back outside.`;
      case "scene.leaveTile":
        return `You leave the spot behind.`;
      case "scene.button": {
        const group = state.engagement.groups[intent.groupId];
        const name = group?.name ?? intent.groupId;
        switch (intent.verb) {
          case "talk":
          case "engage":
            return `You turn your attention to ${name}.`;
          case "trade":
            return `You signal you'd like to trade with ${name}.`;
          case "attack":
            return `You make ready against ${name}.`;
          case "leave":
            return `You step away from ${name}.`;
        }
        return undefined;
      }
      case "freetext":
        return undefined;
    }
  }

  private async evaluateAction(
    intent: PlayerIntent,
    intentText: string,
    turnId: string,
  ): Promise<ActionOutcome> {
    const state = useStore.getState();
    const system = STORY_ENGINE_PROMPTS.actionEvaluator(state, intentText);
    let outcome: ActionOutcome;
    try {
      const response = await this.llm.complete(
        {
          system,
          messages: [
            {
              role: "user",
              content: `Intent kind: ${intent.kind}\n${intentText}`,
            },
          ],
          jsonMode: true,
        },
        { kind: "action-eval", turnId },
      );
      let raw: unknown;
      try {
        raw = parseJsonObject(response.text);
      } catch (err) {
        diag.warn("narrator", "evaluator returned non-JSON; using default outcome", {
          turnId,
          intent: intent.kind,
          textPreview: response.text?.slice(0, 200),
          error: err instanceof Error ? err.message : String(err),
        });
        return this.fillCanonical(intent, defaultOutcome(intentText));
      }
      try {
        outcome = parseOutcome(raw);
      } catch (err) {
        diag.warn("narrator", "evaluator JSON did not match schema; using default outcome", {
          turnId,
          intent: intent.kind,
          raw,
          error: err instanceof Error ? err.message : String(err),
        });
        return this.fillCanonical(intent, defaultOutcome(intentText));
      }
    } catch (err) {
      diag.warn("narrator", "evaluator call failed; using default outcome", {
        turnId,
        intent: intent.kind,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.fillCanonical(intent, defaultOutcome(intentText));
    }
    return this.fillCanonical(intent, outcome);
  }

  /**
   * For structured (non-freetext) intents we always know the canonical
   * tool; the evaluator's `canonicalIntent` is only useful when the
   * player wrote prose. Patch the outcome so downstream tool-scoping
   * has a high-confidence canonical handle to work with.
   */
  private fillCanonical(intent: PlayerIntent, outcome: ActionOutcome): ActionOutcome {
    if (
      intent.kind !== "freetext" &&
      (!outcome.interpretation.canonicalIntent ||
        outcome.interpretation.confidence === "low")
    ) {
      outcome.interpretation.canonicalIntent = canonicalCandidateFor(intent);
      outcome.interpretation.confidence = "high";
    }
    return outcome;
  }

  private async applyResponseWithNamedResults(
    response: LlmResponse,
  ): Promise<Array<{ name: string; ok: boolean; message?: string }>> {
    const calls = response.toolCalls ?? [];
    const out: Array<{ name: string; ok: boolean; message?: string }> = [];
    for (const call of calls) {
      const result = await this.narrator.dispatch(call);
      out.push({ name: call.name, ok: result.ok, message: result.message });
    }
    return out;
  }
}

function parseJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/```\s*$/u, "");
  return JSON.parse(trimmed);
}

function canonicalCandidateFor(intent: PlayerIntent): ActionOutcome["interpretation"]["canonicalIntent"] {
  switch (intent.kind) {
    case "region.move":
      return { kind: "region.move", dx: intent.dx, dy: intent.dy };
    case "region.travelTo":
      return { kind: "region.travelTo", x: intent.x, y: intent.y };
    case "region.enterLocation":
      return { kind: "region.enterLocation", locationId: intent.locationId };
    case "location.move":
      return { kind: "location.move", dx: intent.dx, dy: intent.dy };
    case "location.enterTile":
      return { kind: "location.enterTile", x: intent.x, y: intent.y };
    case "location.leave":
      return { kind: "location.leave", direction: intent.direction };
    case "scene.leaveTile":
      return { kind: "scene.leaveTile" };
    case "scene.button":
      return { kind: "scene.button", verb: intent.verb, groupId: intent.groupId };
    case "freetext":
      return undefined;
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
  world: IndexedWorld,
  outcome?: ActionOutcome,
): string {
  const interp = outcome
    ? `\nEvaluator interpretation: ${outcome.interpretation.summary}\nEvaluator verdict: ${outcome.verdict}\nEvaluator reason: ${outcome.reason}`
    : "";
  const playerLabel = state.character?.name?.trim() || "Player";

  // Build a friendly transcript of recent back-and-forth using each
  // speaker's display name. Falls back to group/role labels when an
  // NPC id is missing (older lines, anonymous parties).
  function transcriptLine(m: { role: string; text: string; npcId?: string }): string {
    if (m.role === "player") return `${playerLabel}: ${m.text}`;
    if (m.role === "system") return `Narrator: ${m.text}`;
    const npc = m.npcId ? world.world.npcs[m.npcId] : undefined;
    const speaker = npc?.name?.trim() || m.npcId || "NPC";
    return `${speaker}: ${m.text}`;
  }

  // Who is the player currently engaged with? List them so the
  // narrator knows exactly which `say({npcId, ...})` to call.
  const engagedIds: string[] = [];
  for (const g of Object.values(state.engagement.groups)) {
    if (g.state !== "engaged" && g.state !== "locked") continue;
    for (const id of g.npcIds) engagedIds.push(id);
  }
  const engagedRoster =
    engagedIds.length > 0
      ? engagedIds
          .map((id) => {
            const npc = world.world.npcs[id];
            return npc?.name ? `${id} ("${npc.name}")` : id;
          })
          .join(", ")
      : "";

  if (intent.kind === "freetext") {
    // In a scene, recent NPC / player back-and-forth gives the model
    // crucial context for tone and continuity. On the map there's no
    // equivalent — each step is its own beat — so we send just the raw
    // action and let the system prompt's tile / region context carry
    // the load.
    if (state.mode === "scene") {
      const recent = state.dialogue.slice(-6);
      const transcript = recent.map(transcriptLine).join("\n");
      const parts: string[] = [];
      if (transcript) parts.push(`Recent dialogue:\n${transcript}`);
      if (engagedRoster) {
        parts.push(
          `Engaged with: ${engagedRoster}. If the action addresses any of them, you MUST emit \`say({npcId, text})\` for that NPC's reply on this turn.`,
        );
      }
      parts.push(`Player action (${playerLabel}): ${intent.text}${interp}`);
      return parts.join("\n\n");
    }
    return `Player action (${playerLabel}): ${intent.text}${interp}`;
  }
  return `Player intent: ${intentText}${interp}`;
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
    case "scene.button":
      // Each scene-button verb has a canonical mechanical tool. If the
      // LLM forgot to emit it (smaller models drop tool calls when they
      // narrate), we run the canonical handler ourselves so the world
      // state catches up with what the narration just implied. `engage`
      // is idempotent — re-engaging an already-engaged group is a
      // no-op — so the fallback is safe to fire unconditionally.
      switch (intent.verb) {
        case "engage":
        case "talk":
        case "trade":
          return ["engage"];
        case "attack":
          return ["start_combat"];
        case "leave":
          return ["disengage"];
      }
      return [];
    case "freetext":
      // Free-text has no single canonical tool — the LLM picks among
      // say / engage / disengage / etc., or just narrates. We trust the
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
    case "scene.button":
      // Fallback the LLM should have emitted. For talk/engage we always
      // engage; the `say` will follow on the next turn when the player
      // actually speaks. Combat and disengage map directly.
      switch (intent.verb) {
        case "engage":
        case "talk":
          return { name: "engage", arguments: { groupId: intent.groupId } };
        case "attack":
          return {
            name: "start_combat",
            arguments: { groupId: intent.groupId },
          };
        case "leave":
          return {
            name: "disengage",
            arguments: { groupId: intent.groupId },
          };
        case "trade":
          // Trade has no single deterministic tool (engine flow varies
          // by NPC). Engage at least so the NPC is in dialogue scope.
          return { name: "engage", arguments: { groupId: intent.groupId } };
      }
      return null;
    case "freetext":
      return null;
  }
}
