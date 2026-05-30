import type { LlmProvider, LlmRequest, LlmResponse } from "./types";
import { useStore } from "../state/store";

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
  private model(): string {
    return useStore.getState().settings.geminiModel.trim() || DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = this.model();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const body: Record<string, unknown> = { contents };
    if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
    if (request.jsonMode) body.generationConfig = { responseMimeType: "application/json" };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
}
