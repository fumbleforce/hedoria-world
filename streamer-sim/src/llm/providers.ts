import type { LlmProvider, LlmRequest, LlmResponse } from "./types";
import { GeminiTextProvider } from "./geminiProvider";
import { OpenRouterTextProvider } from "./openRouterTextProvider";
import { MockProvider } from "./mockProvider";
import { useStore } from "../state/store";

/**
 * Routes each call to Gemini / OpenRouter / Mock based on the live store
 * setting, so the player can switch backends without a reload. Falls back to
 * whatever is actually available.
 */
export class DelegatingTextProvider implements LlmProvider {
  constructor(
    private readonly gemini: GeminiTextProvider | null,
    private readonly openRouter: OpenRouterTextProvider | null,
    private readonly mock: MockProvider,
  ) {}

  private pick(): LlmProvider {
    const backend = useStore.getState().settings.textBackend;
    // An explicit "mock" choice is honored so the offline engine can be tested
    // even when real keys are present. Other choices fall back to whatever is
    // actually available rather than silently doing nothing.
    if (backend === "mock") return this.mock;
    if (backend === "gemini" && this.gemini) return this.gemini;
    if (backend === "openrouter" && this.openRouter) return this.openRouter;
    return this.gemini ?? this.openRouter ?? this.mock;
  }

  get id(): string {
    return this.pick().id;
  }
  complete(request: LlmRequest): Promise<LlmResponse> {
    return this.pick().complete(request);
  }
  async stream(request: LlmRequest, onToken: (delta: string) => void): Promise<LlmResponse> {
    const provider = this.pick();
    if (provider.stream) return provider.stream(request, onToken);
    // Provider has no native streaming: emit the whole completion as one chunk.
    const res = await provider.complete(request);
    onToken(res.text);
    return res;
  }
}

export function resolveTextProvider(geminiKey: string, openRouterOk: boolean): LlmProvider {
  const gemini = geminiKey ? new GeminiTextProvider(geminiKey) : null;
  const openRouter = openRouterOk ? new OpenRouterTextProvider() : null;
  const mock = new MockProvider();
  if (!gemini && !openRouter) return mock;
  return new DelegatingTextProvider(gemini, openRouter, mock);
}
