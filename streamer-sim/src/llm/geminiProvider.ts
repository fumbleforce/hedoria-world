import type { LlmProvider, LlmRequest, LlmResponse } from "./types";
import { useStore } from "../state/store";
import { toGeminiSchema } from "./schema";

const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * Direct-to-Google Gemini. CORS-friendly, so it works from the browser with the
 * key in the URL — fine for personal/dev use, NOT for public deployment.
 */
export class GeminiTextProvider implements LlmProvider {
  constructor(private readonly apiKey: string) {}

  get id(): string {
    return `gemini:${this.model()}`;
  }

  /** Resolve the model, honouring two-tier routing (fast model for chat). */
  private model(kind?: LlmRequest["kind"]): string {
    const s = useStore.getState().settings;
    if (s.tieredModels && kind === "chat") {
      return s.geminiFastModel.trim() || s.geminiModel.trim() || DEFAULT_MODEL;
    }
    return s.geminiModel.trim() || DEFAULT_MODEL;
  }

  private body(request: LlmRequest): Record<string, unknown> {
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const body: Record<string, unknown> = { contents };
    if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
    if (request.jsonMode || request.jsonSchema) {
      const gen: Record<string, unknown> = { responseMimeType: "application/json" };
      if (request.jsonSchema) {
        const schema = toGeminiSchema(request.jsonSchema);
        if (schema) gen.responseSchema = schema;
      }
      body.generationConfig = gen;
    }
    return body;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = this.model(request.kind);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.body(request)),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    return { text };
  }

  /** Server-sent-events streaming via Gemini's streamGenerateContent. */
  async stream(request: LlmRequest, onToken: (delta: string) => void): Promise<LlmResponse> {
    const model = this.model(request.kind);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.body(request)),
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    const handleData = (payload: string) => {
      if (!payload || payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const delta = (obj.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        /* partial / non-JSON keepalive line */
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) handleData(trimmed.slice(5).trim());
      }
    }
    if (buffer.trim().startsWith("data:")) handleData(buffer.trim().slice(5).trim());
    return { text: full };
  }
}
