import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

/**
 * No-network fallback. The chat/story engines special-case providers whose id
 * starts with "mock" and generate content locally, so this provider only ever
 * sees stray calls — it returns something harmless.
 */
export class MockProvider implements LlmProvider {
  readonly id = "mock-local";
  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (request.jsonMode) return { text: "{}" };
    return { text: "" };
  }
}
