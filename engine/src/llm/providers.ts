import type {
  LlmCallKind,
  LlmCallOptions,
  LlmProvider,
  LlmRequest,
  LlmResponse,
} from "./types";
import {
  defaultGeminiTextModel,
  normalizeGeminiTextModel,
} from "./geminiModelOptions";
import { DEFAULT_OPENROUTER_TEXT_MODEL } from "./openRouterDefaults";
import { normalizeOpenRouterTextModelId } from "./openRouterPresets";
import { StoreBackedOpenRouterTextProvider } from "./openRouterTextProvider";
import { useStore } from "../state/store";

type HttpProviderConfig = {
  id: string;
  endpoint: string;
  apiKey?: string;
  model: string;
};

/**
 * Quota / 429 cooldown. When Gemini returns 429 we record a "do not call
 * again before X" timestamp on the provider instance. Subsequent calls inside
 * the window throw a typed RateLimitedError immediately, without hitting the
 * network. This stops a single bad page-load from firing dozens of redundant
 * requests against an already-exhausted quota.
 *
 * Tries to honour Google's `retryDelay` field from the error body. Falls back
 * to `DEFAULT_COOLDOWN_MS` if missing or unparseable. Caps at `MAX_COOLDOWN_MS`
 * because Google sometimes returns "wait 24h" for daily-quota exhaustion and
 * we'd rather retry sooner if the user manually triggers it.
 */
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parse `retryDelay: "30s"` (or `"500ms"`) out of a Gemini 429 body. Returns
 * the delay in ms, or null if no parseable retry hint is present.
 */
function parseRetryDelay(errorBody: string): number | null {
  const match = /retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)(ms|s)?"/u.exec(errorBody);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  return match[2] === "ms" ? n : n * 1000;
}

/**
 * Generic Bearer-auth HTTP JSON provider. Used by Anthropic / OpenAI when
 * routed through a server-side proxy (the browser cannot call those APIs
 * directly because of CORS).
 */
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

/**
 * Direct-to-Google Gemini text provider. Calls the public Generative Language
 * REST API from the browser using an API key embedded in the URL.
 *
 * The API supports CORS, so this works without a server proxy. The trade-off
 * is that the key ships in the browser bundle — fine for personal/dev use,
 * NOT safe for a public deployment. For production, route through a proxy
 * and use {@link HttpJsonProvider} instead.
 */
type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
};

function collectPartsIntoResponse(parts: GeminiPart[]): LlmResponse {
  // Split Gemini's interleaved parts into prose text and structured
  // function calls. A single candidate may look like:
  //   parts: [{text:"You walk west."}, {functionCall:{name:"move_region",args:{...}}}]
  // We preserve order in `toolCalls[]` so the narrator dispatcher applies
  // them in the same sequence the model intended.
  const textChunks: string[] = [];
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  for (const part of parts) {
    if (part.functionCall && typeof part.functionCall.name === "string") {
      toolCalls.push({
        name: part.functionCall.name,
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    } else if (typeof part.text === "string" && part.text.length > 0) {
      textChunks.push(part.text);
    }
  }
  return {
    text: textChunks.join(""),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

class GeminiTextProvider implements LlmProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private cooldownUntil = 0;

  constructor(apiKey: string, model: string) {
    this.id = model;
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(
    request: LlmRequest,
    options?: LlmCallOptions,
  ): Promise<LlmResponse> {
    const now = Date.now();
    if (this.cooldownUntil > now) {
      throw new RateLimitedError(
        `Gemini text API in cooldown after a previous 429 (${this.model}); skipping for ${Math.ceil(
          (this.cooldownUntil - now) / 1000,
        )}s`,
        this.cooldownUntil - now,
      );
    }

    const stream = options?.stream === true;
    const endpoint = stream
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.model,
        )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.model,
        )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = { contents };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }
    if (request.jsonMode) {
      body.generationConfig = { responseMimeType: "application/json" };
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
      body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 429) {
        const hinted = parseRetryDelay(text);
        const cooldown = Math.min(
          MAX_COOLDOWN_MS,
          Math.max(DEFAULT_COOLDOWN_MS, hinted ?? DEFAULT_COOLDOWN_MS),
        );
        this.cooldownUntil = Date.now() + cooldown;
        console.warn(
          `[gemini] 429 quota exhausted on ${this.model}; cooling down for ${Math.round(
            cooldown / 1000,
          )}s. Free-tier daily quota resets ~midnight Pacific. Override the model via VITE_GEMINI_TEXT_MODEL in engine/.env.`,
        );
        throw new RateLimitedError(
          `Gemini text API 429 on ${this.model}: quota exhausted`,
          cooldown,
        );
      }
      throw new Error(
        `Gemini text API ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    if (stream) {
      if (!response.body) {
        throw new Error("Gemini: missing response body for streaming");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const allParts: GeminiPart[] = [];
      const emittedToolCalls = new Set<number>();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr) continue;
          let json: unknown;
          try {
            json = JSON.parse(dataStr);
          } catch {
            continue;
          }
          const parts =
            (json as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> })
              .candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            allParts.push(part);
            if (typeof part.text === "string" && part.text.length > 0) {
              options?.onDelta?.({ kind: "text", text: part.text });
            }
            if (part.functionCall && typeof part.functionCall.name === "string") {
              const idx = allParts.length - 1;
              if (!emittedToolCalls.has(idx)) {
                emittedToolCalls.add(idx);
                options?.onDelta?.({
                  kind: "tool-call",
                  call: {
                    name: part.functionCall.name,
                    arguments: (part.functionCall.args ?? {}) as Record<
                      string,
                      unknown
                    >,
                  },
                });
              }
            }
          }
        }
      }
      return collectPartsIntoResponse(allParts);
    }

    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return collectPartsIntoResponse(parts);
  }
}

/**
 * Stable provider handle used by booted services. It resolves the actual
 * Gemini client at call time, so changing the model in settings affects the
 * next request without rebuilding the game session.
 */
export class StoreBackedGeminiTextProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly providersByModel = new Map<string, GeminiTextProvider>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  get id(): string {
    return this.current("chat").id;
  }

  async complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const kind = options?.kind ?? "other";
    return this.current(kind).complete(request, options);
  }

  private current(kind: LlmCallKind): GeminiTextProvider {
    const store = useStore.getState();
    const selection = store.textModelRegistry[kind] ?? store.textModelRegistry.other;
    // Resolve precedence: an explicit per-kind model id wins; otherwise
    // we use the top-level Gemini chat model. We do NOT auto-write the
    // chosen id back into `geminiTextModel` — that previously caused a
    // per-kind override to silently rename the user's primary model
    // selection (and even to bleed an OpenRouter slug into the Gemini
    // slot).
    //
    // We also defend against shape mismatch at call time: a slug
    // containing `/` cannot be a Gemini model id, so we silently fall
    // back to the top-level model rather than shipping a bad request.
    const isGeminiShape = (m: string) => m.length > 0 && !m.includes("/");
    const candidate = selection.model.trim();
    const topLevel = store.geminiTextModel.trim();
    const raw = isGeminiShape(candidate)
      ? candidate
      : isGeminiShape(topLevel)
        ? topLevel
        : defaultGeminiTextModel();
    const model = normalizeGeminiTextModel(raw) || defaultGeminiTextModel();
    let provider = this.providersByModel.get(model);
    if (!provider) {
      provider = new GeminiTextProvider(this.apiKey, model);
      this.providersByModel.set(model, provider);
    }
    return provider;
  }
}

/**
 * Routes each text LLM call to Gemini or OpenRouter based on store (no reload).
 */
export class DelegatingTextLlmProvider implements LlmProvider {
  private readonly gemini: StoreBackedGeminiTextProvider | null;
  private readonly openRouter: StoreBackedOpenRouterTextProvider | null;

  constructor(
    gemini: StoreBackedGeminiTextProvider | null,
    openRouter: StoreBackedOpenRouterTextProvider | null,
  ) {
    this.gemini = gemini;
    this.openRouter = openRouter;
  }

  get id(): string {
    const s = useStore.getState();
    if (s.textLlmBackend === "openrouter") {
      const trimmed =
        s.openRouterTextModel.trim() || DEFAULT_OPENROUTER_TEXT_MODEL;
      const m = normalizeOpenRouterTextModelId(trimmed);
      return `openrouter:${m}`;
    }
    const model =
      normalizeGeminiTextModel(s.geminiTextModel) || defaultGeminiTextModel();
    return `gemini:${model}`;
  }

  async complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const s = useStore.getState();
    const kind = options?.kind ?? "other";
    const selection = s.textModelRegistry[kind] ?? s.textModelRegistry.other;
    const backend =
      selection.backend === "default" ? s.textLlmBackend : selection.backend;
    if (backend === "openrouter") {
      if (!this.openRouter) {
        throw new Error(
          "OpenRouter text is not available. Set OPENROUTER_API_KEY in engine/.env.local and run the Vite dev server.",
        );
      }
      return this.openRouter.complete(request, options);
    }
    if (!this.gemini) {
      throw new Error(
        "Gemini text is not available. Set VITE_GEMINI_API_KEY in engine/.env.local.",
      );
    }
    return this.gemini.complete(request, options);
  }
}

// Default text model: gemini-2.5-flash — chosen for free-tier reliability.
// As of 2026-05, gemini-2.5-flash has the most generous free-tier quota among
// the production-stable text models (~500 requests/day, vs ~250/day for
// gemini-3-flash-preview and even tighter caps on gemini-3.1-pro-preview).
// Scene classification and NPC dialogue do not need frontier reasoning, so
// the stable model is the right default. Override via VITE_GEMINI_TEXT_MODEL
// in engine/.env to opt into newer/larger models (gemini-3-flash-preview,
// gemini-3.1-flash, gemini-3.1-pro-preview, gemini-2.5-pro).
export function createGeminiProvider(
  apiKey: string,
  model: string = "gemini-2.5-flash-lite",
): LlmProvider {
  return new GeminiTextProvider(apiKey, model);
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
