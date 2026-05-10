export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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
