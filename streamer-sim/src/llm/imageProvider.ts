/**
 * Minimal image generation, mirroring the Hedoria engine's two paths:
 *   - Gemini (direct from browser, key in URL — dev/personal only)
 *   - OpenRouter (via the same dev proxy as text, using image modalities)
 * Returns a data: URL. There is no offline mock — callers check `available`.
 */

import { useStore } from "../state/store";
import { diag } from "../diag/log";
import {
  imageRequestModalitiesFallbacks,
  isOpenRouterModalityError,
  loadOpenRouterCatalog,
} from "./openRouterCatalog";

const PROXY = "/__openrouter/chat";

export interface ImageBackend {
  readonly id: string;
  /**
   * Generate an image from a prompt; returns a data URL. Optional `refs` are
   * data-URL images fed to the model for image-to-image templating (e.g. the
   * character's T-pose body so they stay consistent across scenes).
   */
  generate(prompt: string, refs?: string[]): Promise<string>;
}

/** Split a `data:<mime>;base64,<data>` URL into its parts. */
function splitDataUrl(url: string): { mimeType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

class GeminiImageBackend implements ImageBackend {
  readonly id = "gemini-image";
  constructor(private readonly apiKey: string) {}
  async generate(prompt: string, refs: string[] = []): Promise<string> {
    const model = useStore.getState().settings.geminiImageModel || "gemini-2.5-flash-image";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const parts: Array<Record<string, unknown>> = [];
    for (const ref of refs) {
      const split = splitDataUrl(ref);
      if (split) parts.push({ inlineData: { mimeType: split.mimeType, data: split.data } });
    }
    parts.push({ text: prompt });
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
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

  async generate(prompt: string, refs: string[] = []): Promise<string> {
    const model = useStore.getState().settings.openRouterImageModel || "google/gemini-2.5-flash-image";
    await loadOpenRouterCatalog();
    const tries = imageRequestModalitiesFallbacks(model);
    let lastErr = "OpenRouter image: request failed";
    for (const modalities of tries) {
      try {
        return await this.request(model, prompt, refs, modalities);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = msg;
        if (!isOpenRouterModalityError(msg)) throw err;
        diag.warn("world", "openrouter image modality retry", { model, modalities, error: msg });
      }
    }
    throw new Error(lastErr);
  }

  private async request(
    model: string,
    prompt: string,
    refs: string[],
    modalities: ("image" | "text")[],
  ): Promise<string> {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    for (const ref of refs) content.push({ type: "image_url", image_url: { url: ref } });
    const res = await fetch(PROXY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: refs.length ? content : prompt }],
        modalities,
        image_config: { aspect_ratio: "1:1" },
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenRouter image HTTP ${res.status}: ${raw.slice(0, 200)}`);
    const json = JSON.parse(raw) as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string }; imageUrl?: { url?: string } }> } }>;
      error?: { message?: string };
    };
    if (json.error?.message) throw new Error(`OpenRouter image: ${json.error.message}`);
    const images = json.choices?.[0]?.message?.images ?? [];
    const hit = images.find((im) => {
      const u = im.image_url?.url ?? im.imageUrl?.url;
      return typeof u === "string" && u.length > 0;
    });
    const url = hit?.image_url?.url ?? hit?.imageUrl?.url;
    if (!url) throw new Error("OpenRouter image: no image in response");
    return url;
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

// --- editable prompt templates ----------------------------------------------

/**
 * The universal art-style line, shared by every generated image so they stay
 * visually consistent. Injected into the other templates as `{{style}}`.
 */
export const DEFAULT_IMAGE_STYLE =
  "Stylized semi-realistic video-game art, soft warm lighting, clean and appealing.";

/**
 * Default templates for the user-editable image prompts. `{{placeholders}}` are
 * filled at generation time via `fillImagePrompt`. These can be overridden in
 * Settings; an empty override falls back to the matching default here.
 */
export const DEFAULT_ROOM_PROMPT = [
  "A cozy top-down / high-angle view of a small studio apartment for a video-game.",
  "{{style}}",
  "Warm purple-and-pink night lighting, clean and readable. One room containing:",
  "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
  "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
  "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
  "bathroom nook (bottom-right). No people, no text, no UI. Square composition,",
  "viewed slightly from above like a life-sim. {{upgrades}}",
].join(" ");

export const DEFAULT_PORTRAIT_PROMPT = [
  "Character portrait of {{name}}, a {{gender}} video-game streamer.",
  "Face: {{faceDescription}}.",
  "Head-and-shoulders framing, looking at camera, friendly expression,",
  "simple soft-gradient background, no text, no watermark, no UI.",
  "{{style}}",
  "Square composition.",
].join(" ");

export const DEFAULT_BODY_PROMPT = [
  "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
  "Body: {{bodyDescription}}.",
  "{{match}}",
  "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
  "plain flat light-grey studio background, even lighting, no shadows on the floor,",
  "no text, no watermark, no UI. A clean character turnaround reference.",
  "{{style}}",
].join(" ");

export const DEFAULT_PRESENCE_PROMPT = [
  `Show this exact character, {{name}}, at the "{{zone}}" of her studio apartment.`,
  "The spot: {{zoneDesc}}",
  "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
  "Keep her appearance consistent with the reference image.",
  "Natural pose appropriate for that spot, full scene, warm cozy night lighting,",
  "no text, no watermark, no UI. Square composition, slight high angle like a life-sim.",
  "{{style}}",
].join(" ");

export const DEFAULT_SCENE_PROMPT = [
  "A candid illustrated scene of {{name}}.",
  "Setting: {{position}}.",
  "Depict this moment: {{narrative}}",
  "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
  "Keep {{name}}'s appearance consistent with the reference image.",
  "Focus on body language, expression, and what is physically happening — natural, in-the-moment framing.",
  "No text, no watermark, no UI. Square composition.",
  "{{style}}",
].join(" ");

/** Replace `{{key}}` placeholders, trimming any that resolve to empty. */
export function fillImagePrompt(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generatePortrait(
  backend: ImageBackend,
  vars: { handle: string; archetypeLabel: string; vibe: string; gender?: string },
): Promise<string> {
  const genderLabel = vars.gender === "female" ? "woman" : vars.gender === "male" ? "man" : "person";
  const prompt = [
    `A small square profile avatar for a livestream viewer named "${vars.handle}".`,
    `Stylized semi-realistic game art, warm purple-and-pink lighting to match the app,`,
    `head-and-shoulders, friendly readable icon at small sizes.`,
    `Personality: ${vars.archetypeLabel} — ${vars.vibe}.`,
    `Present as a ${genderLabel}.`,
    `Tasteful and non-explicit. No text, no watermark, no UI. Plain soft background.`,
  ].join(" ");
  diag.info("world", "generating portrait", { backend: backend.id, handle: vars.handle });
  const url = await backend.generate(prompt);
  diag.info("world", "portrait generated", { bytes: url.length });
  return url;
}

/**
 * Generate a full-body T-pose reference for a named character, mirroring the
 * player's body sheet. When a portrait exists it's passed as a reference so the
 * face/outfit carry over; otherwise the look is invented from archetype + vibe.
 */
export async function generateCharacterBody(
  backend: ImageBackend,
  vars: { name: string; archetypeLabel: string; vibe: string; appearance?: string; style: string; gender?: string },
  portraitRef?: string,
): Promise<string> {
  const genderLabel = vars.gender === "female" ? "woman" : vars.gender === "male" ? "man" : "person";
  const prompt = [
    `Full-body character reference sheet of "${vars.name}", a livestream viewer (${genderLabel}).`,
    vars.appearance ? `Appearance: ${vars.appearance}.` : `Personality/look: ${vars.archetypeLabel} — ${vars.vibe}.`,
    portraitRef ? "Match the face, hair, and outfit of the reference portrait exactly." : "",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain flat light-grey studio background, even lighting, no text, no watermark, no UI.",
    "A clean character turnaround reference.",
    vars.style,
  ].filter(Boolean).join(" ");
  diag.info("world", "generating character body", { backend: backend.id, name: vars.name });
  const url = await backend.generate(prompt, portraitRef ? [portraitRef] : undefined);
  diag.info("world", "character body generated", { bytes: url.length });
  return url;
}
