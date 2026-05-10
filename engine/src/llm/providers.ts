import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

type HttpProviderConfig = {
  id: string;
  endpoint: string;
  apiKey?: string;
  model: string;
};

class HttpJsonProvider implements LlmProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(config: HttpProviderConfig) {
    this.id = config.id;
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        jsonMode: request.jsonMode ?? false,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM provider ${this.id} failed: ${response.status}`);
    }
    const payload = (await response.json()) as LlmResponse;
    return payload;
  }
}

export function createGeminiProvider(apiKey: string): LlmProvider {
  return new HttpJsonProvider({
    id: "gemini-flash",
    endpoint: "/api/llm/gemini",
    apiKey,
    model: "gemini-2.5-flash",
  });
}

export function createAnthropicProvider(apiKey: string): LlmProvider {
  return new HttpJsonProvider({
    id: "claude-haiku-4.5",
    endpoint: "/api/llm/anthropic",
    apiKey,
    model: "claude-haiku-4-5",
  });
}

export function createOpenAiProvider(apiKey: string): LlmProvider {
  return new HttpJsonProvider({
    id: "gpt-4.1-mini",
    endpoint: "/api/llm/openai",
    apiKey,
    model: "gpt-4.1-mini",
  });
}
