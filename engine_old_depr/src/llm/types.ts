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
  | "scene-classify"
  | "skill-check"
  | "expansion"
  | "death-recovery"
  | "quest-verify"
  | "other";

export type LlmCallOptions = {
  /** Categorical tag for log filtering. Defaults to "other". */
  kind?: LlmCallKind;
};

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

export interface LlmProvider {
  readonly id: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
