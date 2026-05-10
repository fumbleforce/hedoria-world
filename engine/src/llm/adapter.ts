import { z } from "zod";
import { findTranscriptByPromptHash, putTranscript } from "../persist/saveLoad";
import { diag } from "../diag/log";
import type {
  LlmCallKind,
  LlmCallOptions,
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from "./types";

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
    const promptHash = hashPrompt(promptBlob);
    const startedAt = performance.now();
    const promptLength = promptBlob.length;

    const cached = await findTranscriptByPromptHash(this.saveId, promptHash);
    if (cached) {
      const parsed = LlmResponseSchema.safeParse(JSON.parse(cached.response) as unknown);
      if (parsed.success) {
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

    diag.info("llm", `text-llm request → ${this.provider.id} (kind=${kind})`, {
      model: this.provider.id,
      kind,
      promptHash,
      promptLength,
      jsonMode: request.jsonMode ?? false,
      toolCount: request.tools?.length ?? 0,
    });
    try {
      const raw = await this.provider.complete(request);
      const parsed = LlmResponseSchema.parse(raw);
      const durationMs = performance.now() - startedAt;
      await putTranscript({
        saveId: this.saveId,
        callId: crypto.randomUUID(),
        promptHash,
        model: this.provider.id,
        prompt: promptBlob,
        response: JSON.stringify(parsed),
        generatedAt: Date.now(),
      });
      diag.info("llm", `text-llm response (${Math.round(durationMs)}ms)`, {
        model: this.provider.id,
        kind,
        promptHash,
        responseLength: parsed.text.length,
        toolCalls: parsed.toolCalls?.length ?? 0,
        durationMs: Math.round(durationMs),
      });
      logLlmCall({
        kind,
        model: this.provider.id,
        promptHash,
        cached: false,
        request,
        response: parsed,
        durationMs,
      });
      return parsed;
    } catch (err) {
      diag.error("llm", `text-llm failed (${kind})`, {
        model: this.provider.id,
        kind,
        promptHash,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw err;
    }
  }
}
