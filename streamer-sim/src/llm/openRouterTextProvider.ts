import type { LlmProvider, LlmRequest, LlmResponse } from "./types";
import { useStore } from "../state/store";

const PROXY = "/__openrouter/chat";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
const TIMEOUT_MS = 120_000;

function buildBody(model: string, request: LlmRequest): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (request.system.trim()) messages.push({ role: "system", content: request.system });
  for (const m of request.messages) messages.push({ role: m.role, content: m.content });
  const body: Record<string, unknown> = { model, messages, stream: false };
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
      const response = await fetch(PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
