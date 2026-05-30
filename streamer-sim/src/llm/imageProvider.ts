/**
 * Minimal image generation, mirroring the Hedoria engine's two paths:
 *   - Gemini (direct from browser, key in URL — dev/personal only)
 *   - OpenRouter (via the same dev proxy as text, using image modalities)
 * Returns a data: URL. There is no offline mock — callers check `available`.
 */

import { useStore } from "../state/store";
import { diag } from "../diag/log";

const PROXY = "/__openrouter/chat";

export interface ImageBackend {
  readonly id: string;
  /** Generate an image from a prompt; returns a data URL. */
  generate(prompt: string): Promise<string>;
}

class GeminiImageBackend implements ImageBackend {
  readonly id = "gemini-image";
  constructor(private readonly apiKey: string) {}
  async generate(prompt: string): Promise<string> {
    const model = useStore.getState().settings.geminiImageModel || "gemini-2.5-flash-image";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
      }),
    });
    if (!res.ok) throw new Error(`Gemini image HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
    };
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const data = part?.inlineData?.data;
    if (!data) throw new Error("Gemini image: no image in response");
    return `data:${part?.inlineData?.mimeType ?? "image/png"};base64,${data}`;
  }
}

class OpenRouterImageBackend implements ImageBackend {
  readonly id = "openrouter-image";
  async generate(prompt: string): Promise<string> {
    const model = useStore.getState().settings.openRouterImageModel || "google/gemini-2.5-flash-image";
    const res = await fetch(PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
        image_config: { aspect_ratio: "1:1" },
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenRouter image HTTP ${res.status}: ${raw.slice(0, 160)}`);
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
      error?: { message?: string };
    };
    if (json.error?.message) throw new Error(`OpenRouter image: ${json.error.message}`);
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("OpenRouter image: no image in response");
    return url; // already a data: URL
  }
}

export function resolveImageBackend(geminiKey: string, openRouterOk: boolean): ImageBackend | null {
  const backend = useStore.getState().settings.textBackend;
  if (backend === "gemini" && geminiKey) return new GeminiImageBackend(geminiKey);
  if (backend === "openrouter" && openRouterOk) return new OpenRouterImageBackend();
  if (geminiKey) return new GeminiImageBackend(geminiKey);
  if (openRouterOk) return new OpenRouterImageBackend();
  return null;
}

export async function generateRoomImage(
  backend: ImageBackend,
  vars: { persona: string; upgrades: string[] },
): Promise<string> {
  const prompt = [
    "A cozy top-down / high-angle view of a small studio apartment for a video-game,",
    "stylized semi-realistic game art, warm purple-and-pink night lighting, clean and",
    "readable. One room containing: an unmade bed (top-left), a streaming desk with",
    "dual monitors, webcam, ring light and RGB (top-right), a comfy couch with a rug",
    "(center), a small kitchenette with a hot plate and kettle (bottom-left), a front",
    "door (bottom-center), and a tiny bathroom nook (bottom-right). No people, no text,",
    "no UI. Square composition, viewed slightly from above like a life-sim.",
    vars.upgrades.length ? `Nice touches: ${vars.upgrades.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  diag.info("world", "generating room image", { backend: backend.id });
  const url = await backend.generate(prompt);
  diag.info("world", "room image generated", { bytes: url.length });
  return url;
}
