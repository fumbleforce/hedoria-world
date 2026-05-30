/** Minimal provider contract, ported from the Hedoria engine. */

export type LlmCallKind = "chat" | "story" | "other";

export interface LlmCallOptions {
  kind?: LlmCallKind;
}

export interface LlmRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  jsonMode?: boolean;
  /**
   * A JSON Schema describing the expected response shape. When set (and the
   * provider supports it), the model is constrained to emit conforming JSON via
   * native structured output, removing the "respond with JSON" + parse dance.
   */
  jsonSchema?: Record<string, unknown>;
  /**
   * Call category, injected by the adapter. Providers use it for two-tier model
   * routing (a cheap/fast model for `chat`, a stronger one for `story`/`other`).
   */
  kind?: LlmCallKind;
}

export interface LlmResponse {
  text: string;
}

export interface LlmProvider {
  readonly id: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
  /**
   * Optional token-streaming variant. Calls `onToken` with each incremental
   * delta and resolves with the full text. Providers without streaming omit
   * this; callers fall back to `complete`.
   */
  stream?(request: LlmRequest, onToken: (delta: string) => void): Promise<LlmResponse>;
}
