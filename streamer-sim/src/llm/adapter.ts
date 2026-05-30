import type { LlmCallOptions, LlmProvider, LlmRequest, LlmResponse } from "./types";
import { diag } from "../diag/log";

/**
 * Thin wrapper over a provider. Deliberately does NOT cache (a live chat must
 * stay fresh). It logs every call through diag (browser + terminal) and to the
 * raw /__llm-log JSONL sink for prompt tuning.
 */
export class LlmAdapter {
  constructor(private readonly provider: LlmProvider) {}

  get id(): string {
    return this.provider.id;
  }
  get isMock(): boolean {
    return this.provider.id.startsWith("mock");
  }

  async complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const kind = options?.kind ?? "other";
    const startedAt = performance.now();
    diag.debug("llm", `request → ${this.provider.id} (${kind})`, {
      systemLen: request.system.length,
      messages: request.messages.length,
      jsonMode: request.jsonMode ?? false,
    });
    try {
      const res = await this.provider.complete(request);
      const durationMs = Math.round(performance.now() - startedAt);
      diag.info("llm", `response ← ${this.provider.id} (${kind})`, {
        durationMs,
        chars: res.text.length,
      });
      logLlmRaw({ kind, model: this.provider.id, request, response: res, durationMs });
      return res;
    } catch (err) {
      diag.error("llm", `failed (${kind})`, {
        model: this.provider.id,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Math.round(performance.now() - startedAt),
      });
      throw err;
    }
  }
}

/**
 * Append a raw call record to the dev-server /__llm-log sink (logs/llm-prompts.jsonl
 * + logs/llm-debug.log). Exported so non-text calls (image generation) log too.
 */
export function logLlmRaw(payload: object): void {
  void fetch("/__llm-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ts: new Date().toISOString(), ...payload }),
  }).catch(() => {
    /* dev-only sink */
  });
}
