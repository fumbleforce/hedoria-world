import { z } from "zod";
import { findTranscriptByPromptHash, putTranscript } from "../persist/saveLoad";
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

function hashPrompt(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
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

    const cached = await findTranscriptByPromptHash(this.saveId, promptHash);
    if (cached) {
      const parsed = LlmResponseSchema.safeParse(JSON.parse(cached.response) as unknown);
      if (parsed.success) {
        logLlmCall({
          kind,
          model: cached.model,
          promptHash,
          cached: true,
          request,
          response: parsed.data,
          durationMs: performance.now() - startedAt,
        });
        return parsed.data;
      }
    }

    const raw = await this.provider.complete(request);
    const parsed = LlmResponseSchema.parse(raw);
    await putTranscript({
      saveId: this.saveId,
      callId: crypto.randomUUID(),
      promptHash,
      model: this.provider.id,
      prompt: promptBlob,
      response: JSON.stringify(parsed),
      generatedAt: Date.now(),
    });
    logLlmCall({
      kind,
      model: this.provider.id,
      promptHash,
      cached: false,
      request,
      response: parsed,
      durationMs: performance.now() - startedAt,
    });
    return parsed;
  }
}
