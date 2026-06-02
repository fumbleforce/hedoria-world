export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Tag identifying the *purpose* of an LLM call. Threaded through
 * `LlmAdapter.complete` into the dev-server transcript log so prompt
 * categories can be filtered apart in `engine/logs/llm-prompts.jsonl`:
 *
 *   jq 'select(.kind == "chat")' engine/logs/llm-prompts.jsonl
 */
export type LlmCallKind =
  | "chat"
  | "action-eval"
  | "scene-classify"
  | "skill-check"
  | "expansion"
  | "death-recovery"
  | "quest-verify"
  | "other";

export type LlmRequest = {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: ToolSpec[];
  jsonMode?: boolean;
};

export type LlmResponse = {
  text: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
};

export type LlmStreamDelta =
  | { kind: "text"; text: string }
  | {
      kind: "tool-call";
      call: { name: string; arguments: Record<string, unknown> };
    }
  | { kind: "done"; final: LlmResponse };

export type LlmCallOptions = {
  /** Categorical tag for log filtering and model selection. Defaults to "other". */
  kind?: LlmCallKind;
  /** Enable token/chunk streaming where the provider supports it. */
  stream?: boolean;
  /** Streaming callback for text/tool deltas and final assembled response. */
  onDelta?: (delta: LlmStreamDelta) => void;
  /** Optional abort signal forwarded to provider calls. */
  signal?: AbortSignal;
  /** Optional correlation id for multi-call turn tracing. */
  turnId?: string;
};

export interface LlmProvider {
  readonly id: string;
  complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse>;
}
