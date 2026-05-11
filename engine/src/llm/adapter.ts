import { z } from "zod";
import {
  deleteTranscriptByPromptHash,
  findTranscriptByPromptHash,
  putTranscript,
} from "../persist/saveLoad";
import { diag } from "../diag/log";
import { useStore } from "../state/store";
import type {
  LlmCallKind,
  LlmCallOptions,
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from "./types";

let textLlmActivitySeq = 0;

/** Player-facing label for the HUD activity strip (never shown for `chat` — that uses `pendingNarrations`). */
function labelForNonChatLlmKind(kind: LlmCallKind): string {
  switch (kind) {
    case "scene-classify":
      return "Text model · map / tile layout";
    case "skill-check":
      return "Text model · skill check";
    case "quest-verify":
      return "Text model · quest check";
    case "death-recovery":
      return "Text model · death recovery";
    case "expansion":
      return "Text model · expansion";
    case "other":
      return "Text model · task";
    case "chat":
      return "Text model · narrator";
  }
}

const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

const LlmResponseSchema = z.object({
  text: z.string().default(""),
  toolCalls: z.array(ToolCallSchema).optional(),
});

/**
 * Schema version embedded in every cache key. Bump this whenever the
 * shape of `LlmResponse` we *expect* from the provider changes — e.g.
 * v2 marks the switch to real Gemini function-calling so cached v1
 * responses (which inline tool calls as pseudo-syntax in `text`) are
 * forced to miss and re-fetch.
 */
const LLM_CACHE_VERSION = "v2";

function hashPrompt(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `${LLM_CACHE_VERSION}_h${Math.abs(hash)}`;
}

/**
 * Tile/region `scene-classify` responses must be JSON with a non-empty
 * `cells` array. The transcript table only validates the outer
 * `{ text, toolCalls? }` wrapper, so malformed or pre-schema caches would
 * otherwise hit forever and force deterministic fallbacks in TileFiller.
 */
function isValidSceneClassifyGridPayload(text: string): boolean {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/```\s*$/u, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const cells = (parsed as { cells?: unknown }).cells;
  return Array.isArray(cells) && cells.length > 0;
}

/**
 * Fire-and-forget POST to the dev-server `/__llm-log` middleware. Appends one
 * JSON line per LLM call to `engine/logs/llm-prompts.jsonl`. Silently no-ops
 * in production builds (the endpoint 404s and we swallow the error).
 */
function logLlmCall(payload: {
  kind: LlmCallKind;
  model: string;
  promptHash: string;
  cached: boolean;
  request: LlmRequest;
  response: LlmResponse;
  durationMs: number;
}): void {
  void fetch("/__llm-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts: new Date().toISOString(), ...payload }),
  }).catch(() => {
    // Dev-only sink; production builds have no middleware. Swallow.
  });
}

export class LlmAdapter {
  private readonly provider: LlmProvider;
  private readonly saveId: string;

  constructor(provider: LlmProvider, saveId: string) {
    this.provider = provider;
    this.saveId = saveId;
  }

  async complete(
    request: LlmRequest,
    options?: LlmCallOptions,
  ): Promise<LlmResponse> {
    const kind: LlmCallKind = options?.kind ?? "other";
    const promptBlob = JSON.stringify(request);
    const providerId = this.provider.id;
    const promptHash = hashPrompt(`${providerId}\n${promptBlob}`);
    const startedAt = performance.now();
    const promptLength = promptBlob.length;

    const cached = await findTranscriptByPromptHash(this.saveId, promptHash);
    if (cached) {
      const parsed = LlmResponseSchema.safeParse(JSON.parse(cached.response) as unknown);
      if (parsed.success) {
        const needsGridBody =
          kind === "scene-classify" && (request.jsonMode ?? false);
        if (
          needsGridBody &&
          !isValidSceneClassifyGridPayload(parsed.data.text)
        ) {
          await deleteTranscriptByPromptHash(this.saveId, promptHash);
          diag.warn("llm", `text-llm cache dropped (invalid scene-classify JSON)`, {
            kind,
            promptHash,
            model: cached.model,
          });
        } else {
          const durationMs = performance.now() - startedAt;
          diag.info("llm", `text-llm cache hit (kind=${kind})`, {
            model: cached.model,
            kind,
            promptHash,
            promptLength,
            responseLength: parsed.data.text.length,
            toolCalls: parsed.data.toolCalls?.length ?? 0,
            durationMs: Math.round(durationMs),
            cached: true,
          });
          logLlmCall({
            kind,
            model: cached.model,
            promptHash,
            cached: true,
            request,
            response: parsed.data,
            durationMs,
          });
          return parsed.data;
        }
      }
    }

    diag.info("llm", `text-llm request → ${providerId} (kind=${kind})`, {
      model: providerId,
      kind,
      promptHash,
      promptLength,
      jsonMode: request.jsonMode ?? false,
      toolCount: request.tools?.length ?? 0,
    });
    const showHudActivity = kind !== "chat";
    const activityId = showHudActivity
      ? `text-llm:${++textLlmActivitySeq}:${kind}`
      : "";
    if (showHudActivity) {
      useStore
        .getState()
        .setBackgroundActivity(activityId, labelForNonChatLlmKind(kind));
    }
    try {
      const raw = await this.provider.complete(request);
      const parsed = LlmResponseSchema.parse(raw);
      const durationMs = performance.now() - startedAt;
      const cacheThis =
        kind !== "scene-classify" ||
        !request.jsonMode ||
        isValidSceneClassifyGridPayload(parsed.text);
      if (cacheThis) {
        await putTranscript({
          saveId: this.saveId,
          callId: crypto.randomUUID(),
          promptHash,
          model: providerId,
          prompt: promptBlob,
          response: JSON.stringify(parsed),
          generatedAt: Date.now(),
        });
      } else {
        diag.warn("llm", `text-llm response not cached (invalid scene-classify JSON)`, {
          kind,
          promptHash,
          model: providerId,
        });
      }
      diag.info("llm", `text-llm response (${Math.round(durationMs)}ms)`, {
        model: providerId,
        kind,
        promptHash,
        responseLength: parsed.text.length,
        toolCalls: parsed.toolCalls?.length ?? 0,
        durationMs: Math.round(durationMs),
      });
      logLlmCall({
        kind,
        model: providerId,
        promptHash,
        cached: false,
        request,
        response: parsed,
        durationMs,
      });
      return parsed;
    } catch (err) {
      diag.error("llm", `text-llm failed (${kind})`, {
        model: providerId,
        kind,
        promptHash,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw err;
    } finally {
      if (showHudActivity) {
        useStore.getState().setBackgroundActivity(activityId, null);
      }
    }
  }
}
