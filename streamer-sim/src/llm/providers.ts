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
    if (backend === "gemini" && this.gemini) return this.gemini;
    if (backend === "openrouter" && this.openRouter) return this.openRouter;
    if (this.gemini) return this.gemini;
    if (this.openRouter) return this.openRouter;
    return this.mock;
  }

  get id(): string {
    return this.pick().id;
  }
  complete(request: LlmRequest): Promise<LlmResponse> {
    return this.pick().complete(request);
  }
}

export function resolveTextProvider(geminiKey: string, openRouterOk: boolean): LlmProvider {
  const gemini = geminiKey ? new GeminiTextProvider(geminiKey) : null;
  const openRouter = openRouterOk ? new OpenRouterTextProvider() : null;
  const mock = new MockProvider();
  if (!gemini && !openRouter) return mock;
  return new DelegatingTextProvider(gemini, openRouter, mock);
}
