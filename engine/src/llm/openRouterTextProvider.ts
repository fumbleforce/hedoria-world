import type { LlmProvider, LlmRequest, LlmResponse, ToolSpec } from "./types";
import { diag } from "../diag/log";
import { DEFAULT_OPENROUTER_TEXT_MODEL } from "./openRouterDefaults";
import {
  formatOpenRouterHttpError,
  OPENROUTER_PROXY_CHAT_PATH,
} from "./openRouterProxyErrors";
import { normalizeOpenRouterTextModelId } from "./openRouterPresets";
import { useStore } from "../state/store";

export { DEFAULT_OPENROUTER_TEXT_MODEL };

let openRouterTextRequestSeq = 0;

const TEXT_REQUEST_TIMEOUT_MS = (() => {
  const raw = (import.meta as { env?: Record<string, string | undefined> })
    ?.env?.VITE_OPENROUTER_TEXT_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
})();

function toOpenAiTools(tools: ToolSpec[]): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

function buildChatPayload(model: string, request: LlmRequest): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];
  if (request.system.trim()) {
    messages.push({ role: "system", content: request.system });
  }
  for (const m of request.messages) {
    messages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = toOpenAiTools(request.tools);
    body.tool_choice = "auto";
  }

  if (request.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function parseOpenRouterChatJson(json: unknown): LlmResponse {
  const root = json as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
    error?: { message?: string };
  };

  if (root.error?.message) {
    throw new Error(`OpenRouter: ${root.error.message}`);
  }

  const message = root.choices?.[0]?.message;
  let text = "";
  if (typeof message?.content === "string") {
    text = message.content;
  } else if (Array.isArray(message?.content)) {
    const parts = message!.content as Array<{ type?: string; text?: string }>;
    text = parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }

  const rawCalls = message?.tool_calls ?? [];
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  for (const tc of rawCalls) {
    const name = tc.function?.name;
    if (typeof name !== "string" || !name) continue;
    let args: Record<string, unknown> = {};
    const argStr = tc.function?.arguments;
    if (typeof argStr === "string" && argStr.trim()) {
      try {
        const parsed = JSON.parse(argStr) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
    }
    toolCalls.push({ name, arguments: args });
  }

  return {
    text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

class OpenRouterTextProvider implements LlmProvider {
  readonly id: string;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
    this.id = `openrouter:${model}`;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const payload = buildChatPayload(this.model, request);
    const payloadJson = JSON.stringify(payload);
    const reqId = `or-text-${++openRouterTextRequestSeq}`;
    const startedAt = performance.now();

    diag.info("llm", `openrouter text → POST ${OPENROUTER_PROXY_CHAT_PATH}`, {
      reqId,
      model: this.model,
      bytes: payloadJson.length,
      messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
      hasTools: Boolean(request.tools && request.tools.length > 0),
      jsonMode: Boolean(request.jsonMode),
      timeoutMs: TEXT_REQUEST_TIMEOUT_MS,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEXT_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(OPENROUTER_PROXY_CHAT_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": reqId,
        },
        body: payloadJson,
        signal: controller.signal,
      });
    } catch (err) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      if ((err as { name?: string })?.name === "AbortError") {
        diag.error("llm", `openrouter text aborted (timeout)`, {
          reqId,
          model: this.model,
          elapsedMs,
          timeoutMs: TEXT_REQUEST_TIMEOUT_MS,
        });
        throw new Error(
          `OpenRouter text timeout after ${Math.round(TEXT_REQUEST_TIMEOUT_MS / 1000)}s (${this.model}). Set VITE_OPENROUTER_TEXT_TIMEOUT_MS in engine/.env if you need longer.`,
        );
      }
      diag.error("llm", `openrouter text fetch failed`, {
        reqId,
        model: this.model,
        elapsedMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const headerMs = Math.round(performance.now() - startedAt);
    diag.info("llm", `openrouter text ← headers`, {
      reqId,
      model: this.model,
      status: response.status,
      headerMs,
    });

    const rawText = await response.text();
    const totalMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      diag.error("llm", `openrouter text HTTP ${response.status}`, {
        reqId,
        model: this.model,
        totalMs,
        bytes: rawText.length,
        bodyPreview: rawText.slice(0, 400),
      });
      throw new Error(formatOpenRouterHttpError("text", response.status, rawText));
    }

    let json: unknown;
    try {
      json = JSON.parse(rawText) as unknown;
    } catch {
      diag.error("llm", `openrouter text response was not JSON`, {
        reqId,
        model: this.model,
        totalMs,
        bytes: rawText.length,
        bodyPreview: rawText.slice(0, 400),
      });
      throw new Error("OpenRouter: response was not JSON");
    }
    const parsed = parseOpenRouterChatJson(json);
    const root = json as {
      usage?: Record<string, unknown>;
      model?: string;
      provider?: string;
    };
    diag.info("llm", `openrouter text ← parsed`, {
      reqId,
      requestedModel: this.model,
      reportedModel: root.model,
      reportedProvider: root.provider,
      totalMs,
      bytes: rawText.length,
      textLength: parsed.text.length,
      toolCalls: parsed.toolCalls?.length ?? 0,
      usage: root.usage,
    });
    return parsed;
  }
}

/**
 * Resolves OpenRouter model from the store on each call (settings apply without reload).
 */
export class StoreBackedOpenRouterTextProvider implements LlmProvider {
  private readonly providersByModel = new Map<string, OpenRouterTextProvider>();

  get id(): string {
    return this.current().id;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return this.current().complete(request);
  }

  private current(): OpenRouterTextProvider {
    const store = useStore.getState();
    const trimmed =
      store.openRouterTextModel.trim() || DEFAULT_OPENROUTER_TEXT_MODEL;
    const model = normalizeOpenRouterTextModelId(trimmed);
    if (model !== trimmed) {
      store.setOpenRouterTextModel(model);
    }
    let provider = this.providersByModel.get(model);
    if (!provider) {
      provider = new OpenRouterTextProvider(model);
      this.providersByModel.set(model, provider);
    }
    return provider;
  }
}
