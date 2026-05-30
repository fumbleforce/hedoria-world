import type { LlmCallKind, LlmCallOptions, LlmProvider, LlmRequest, LlmResponse } from "./types";
import { diag } from "../diag/log";
import { recordLlmCall } from "./stats";

function promptText(request: LlmRequest): string {
  return [request.system, ...request.messages.map((m) => `[${m.role}] ${m.content}`)]
    .filter(Boolean)
    .join("\n");
}

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
    const req: LlmRequest = { ...request, kind };
    const startedAt = performance.now();
    diag.debug("llm", `request → ${this.provider.id} (${kind})`, {
      systemLen: request.system.length,
      messages: request.messages.length,
      jsonMode: request.jsonMode ?? false,
      schema: request.jsonSchema ? true : false,
    });
    try {
      const res = await this.provider.complete(req);
      const durationMs = Math.round(performance.now() - startedAt);
      diag.info("llm", `response ← ${this.provider.id} (${kind})`, {
        durationMs,
        chars: res.text.length,
      });
      recordLlmCall({ kind, model: this.provider.id, durationMs, prompt: promptText(req), response: res.text, ok: true });
      logLlmRaw({ kind, model: this.provider.id, request: req, response: res, durationMs });
      return res;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message = err instanceof Error ? err.message : String(err);
      diag.error("llm", `failed (${kind})`, { model: this.provider.id, error: message, durationMs });
      recordLlmCall({ kind, model: this.provider.id, durationMs, prompt: promptText(req), response: "", ok: false, error: message });
      throw err;
    }
  }

  /**
   * Stream a response token-by-token via `onToken`, resolving with the full
   * text. Transparently falls back to a single `complete` call (emitting the
   * whole text as one delta) when the active provider has no streaming support.
   */
  async stream(
    request: LlmRequest,
    onToken: (delta: string) => void,
    options?: LlmCallOptions,
  ): Promise<LlmResponse> {
    const kind = options?.kind ?? "other";
    const req: LlmRequest = { ...request, kind };
    if (!this.provider.stream) {
      const res = await this.complete(request, options);
      onToken(res.text);
      return res;
    }
    const startedAt = performance.now();
    try {
      const res = await this.provider.stream(req, onToken);
      const durationMs = Math.round(performance.now() - startedAt);
      diag.info("llm", `stream ← ${this.provider.id} (${kind})`, { durationMs, chars: res.text.length });
      recordLlmCall({ kind, model: this.provider.id, durationMs, prompt: promptText(req), response: res.text, ok: true });
      logLlmRaw({ kind, model: this.provider.id, request: req, response: res, durationMs });
      return res;
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message = err instanceof Error ? err.message : String(err);
      diag.error("llm", `stream failed (${kind})`, { model: this.provider.id, error: message, durationMs });
      recordLlmCall({ kind, model: this.provider.id, durationMs, prompt: promptText(req), response: "", ok: false, error: message });
      throw err;
    }
  }

  /** Whether the active provider supports token streaming. */
  get canStream(): boolean {
    return typeof this.provider.stream === "function";
  }
}

/**
 * Complete a request that must yield structured output, with one cheap "repair"
 * retry: if the first response can't be parsed, we re-ask the model to return
 * ONLY valid JSON before the caller falls back to its local engine. Capable
 * models almost always self-correct on the second pass, so the deterministic
 * fallback path stops firing on transient formatting hiccups.
 *
 * `parse` should return the parsed value, or null when the text is unusable.
 */
export async function completeJsonWithRepair<T>(
  adapter: LlmAdapter,
  request: LlmRequest,
  parse: (text: string) => T | null,
  kind: LlmCallKind = "other",
): Promise<T | null> {
  const first = await adapter.complete(request, { kind });
  const parsed = parse(first.text);
  if (parsed != null) return parsed;

  diag.warn("llm", `unparseable ${kind} response — retrying with repair`, {
    raw: first.text.slice(0, 160),
  });
  const repair: LlmRequest = {
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", content: first.text.slice(0, 4000) },
      {
        role: "user",
        content:
          "Your previous reply was not valid JSON and could not be parsed. Reply again with ONLY the JSON value requested — no prose, no markdown code fences, no commentary.",
      },
    ],
  };
  const second = await adapter.complete(repair, { kind });
  return parse(second.text);
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
