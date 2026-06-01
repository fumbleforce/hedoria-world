import type { LlmProvider, LlmRequest, LlmResponse } from "./types";
import { useStore } from "../state/store";
import { supabase, supabaseConfigured } from "../lib/supabase";

// Dev: Vite middleware proxy (keeps API key server-side during local dev).
// Prod: Supabase edge function (requires a valid auth JWT).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const PROXY = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/openrouter-proxy`
  : "/__openrouter/chat";

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const TIMEOUT_MS = 120_000;
// Generous default so replies finish their thought instead of being clipped by
// a provider-side length cap. Overridable per-request via `maxTokens`.
const DEFAULT_MAX_TOKENS = 1024;

function buildBody(model: string, request: LlmRequest): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (request.system.trim()) messages.push({ role: "system", content: request.system });
  for (const m of request.messages) messages.push({ role: m.role, content: m.content });
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (request.jsonSchema) {
    // Native structured output: constrain the model to the schema directly.
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "response", strict: false, schema: request.jsonSchema },
    };
  } else if (request.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

/** Resolves the model from the store on each call so settings apply with no reload. */
export class OpenRouterTextProvider implements LlmProvider {
  get id(): string {
    return `openrouter:${this.model()}`;
  }
  /** Resolve the model, honouring two-tier routing (fast model for chat). */
  private model(kind?: LlmRequest["kind"]): string {
    const s = useStore.getState().settings;
    if (s.tieredModels && kind === "chat") {
      return s.openRouterFastModel.trim() || s.openRouterModel.trim() || DEFAULT_MODEL;
    }
    return s.openRouterModel.trim() || DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // In production inject the Supabase JWT so the edge function can verify the caller.
      if (supabaseConfigured) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }
      }
      const response = await fetch(PROXY, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(this.model(request.kind), request)),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${raw.slice(0, 200)}`);
      const json = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        error?: { message?: string };
      };
      if (json.error?.message) throw new Error(`OpenRouter: ${json.error.message}`);
      return { text: json.choices?.[0]?.message?.content ?? "" };
    } finally {
      clearTimeout(timer);
    }
  }
}
