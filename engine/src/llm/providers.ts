import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

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

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const now = Date.now();
    if (this.cooldownUntil > now) {
      throw new RateLimitedError(
        `Gemini text API in cooldown after a previous 429 (${this.model}); skipping for ${Math.ceil(
          (this.cooldownUntil - now) / 1000,
        )}s`,
        this.cooldownUntil - now,
      );
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
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
    // Bridge our ToolSpec[] to Gemini's functionDeclarations[] so the model
    // can emit real structured function calls. Without this, Gemini sees
    // tools only as text in the system prompt and either ignores them or
    // (worse) emits Python-style `move_region(...)` strings into the text
    // body, which then leaks into the narration panel.
    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            // Gemini expects a JSON-Schema-shaped `parameters` block, which
            // is exactly what our `inputSchema` already is.
            parameters: t.inputSchema,
          })),
        },
      ];
      // Encourage but don't require function calls so the model can still
      // emit pure narration when no tool is appropriate.
      body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        // One concise warning instead of dumping the full body — the adapter
        // catches the throw and the cache falls back to the procedural spec.
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
    const json = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            functionCall?: { name?: string; args?: Record<string, unknown> };
          }>;
        };
      }>;
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];

    // Split the parts stream into prose text and structured function calls.
    // Gemini interleaves them in the order the model produced, so a single
    // candidate may look like:
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
