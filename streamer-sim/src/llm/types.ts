/** Minimal provider contract, ported from the Hedoria engine. */

export type LlmCallKind = "chat" | "story" | "other";

export interface LlmCallOptions {
  kind?: LlmCallKind;
}

export interface LlmRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  jsonMode?: boolean;
}

export interface LlmResponse {
  text: string;
}

export interface LlmProvider {
  readonly id: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
