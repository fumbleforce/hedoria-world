/**
 * Curated image-prompt sets. Empty per-field settings overrides fall back to the
 * active preset; empty preset id falls back to `cozy-neon`.
 */

import type { Settings } from "../game/types";
import {
  DEFAULT_BODY_PROMPT,
  DEFAULT_IMAGE_STYLE,
  DEFAULT_PORTRAIT_PROMPT,
  DEFAULT_PRESENCE_PROMPT,
  DEFAULT_ROOM_PROMPT,
  DEFAULT_SCENE_PROMPT,
} from "./imageProvider";

export type ImageStylePresetId =
  | "cozy-neon"
  | "anime-cel"
  | "graphic-novel"
  | "semi-real"
  | "retro-sim";

export interface ImagePromptSet {
  id: ImageStylePresetId;
  label: string;
  blurb: string;
  swatch: [string, string];
  imageStyle: string;
  roomPrompt: string;
  portraitPrompt: string;
  bodyPrompt: string;
  presencePrompt: string;
  scenePrompt: string;
}

const COZY_NEON: ImagePromptSet = {
  id: "cozy-neon",
  label: "Cozy Neon",
  blurb: "Warm purple-pink streamer room — the original look.",
  swatch: ["#b079ff", "#ff5d8f"],
  imageStyle: DEFAULT_IMAGE_STYLE,
  roomPrompt: DEFAULT_ROOM_PROMPT,
  portraitPrompt: DEFAULT_PORTRAIT_PROMPT,
  bodyPrompt: DEFAULT_BODY_PROMPT,
  presencePrompt: DEFAULT_PRESENCE_PROMPT,
  scenePrompt: DEFAULT_SCENE_PROMPT,
};

const ANIME_CEL: ImagePromptSet = {
  id: "anime-cel",
  label: "Anime Cel",
  blurb: "Bright cel-shaded visual-novel art, clean lines.",
  swatch: ["#ff8787", "#74c0fc"],
  imageStyle:
    "Vibrant anime cel-shading, crisp clean line art, saturated colors, soft anime key lighting, visual-novel character art.",
  roomPrompt: [
    "A cozy top-down / high-angle view of a small studio apartment for a video-game.",
    "{{style}}",
    "Bright sunlit afternoon through the window, pastel walls, colorful props, clean readable layout. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a slice-of-life anime background. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "Head-and-shoulders framing, looking at camera, expressive anime eyes, friendly smile,",
    "soft gradient background, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "{{match}}",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain flat light-grey studio background, even lighting, no shadows on the floor,",
    "no text, no watermark, no UI. Clean anime turnaround reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of her studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Natural slice-of-life pose, bright cheerful anime interior lighting,",
    "no text, no watermark, no UI. Square composition, slight high angle like a life-sim.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where she is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Dynamic anime screenshot framing, expressive reaction, colorful stream setup,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

const GRAPHIC_NOVEL: ImagePromptSet = {
  id: "graphic-novel",
  label: "Graphic Novel",
  blurb: "Ink and watercolor, moody shadows, limited palette.",
  swatch: ["#495057", "#fab005"],
  imageStyle:
    "Graphic novel illustration, bold ink outlines with watercolor washes, rich chiaroscuro shadows, limited desaturated palette, editorial comic art.",
  roomPrompt: [
    "A top-down / high-angle view of a small studio apartment for a video-game.",
    "{{style}}",
    "Moody evening interior, amber desk lamp pools of light, deep blue shadows, ink-wash textures. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a comic establishing panel. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "Head-and-shoulders framing, looking at camera, confident expression,",
    "dark textured background with a single warm rim light, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "{{match}}",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain off-white paper background, flat even lighting, no text, no watermark, no UI.",
    "Ink-and-wash character turnaround reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of her studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Natural pose, dramatic comic-panel lighting with strong shadows,",
    "no text, no watermark, no UI. Square composition, slight high angle.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where she is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Cinematic comic-panel framing, expressive body language, moody stream-room lighting,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

const SEMI_REAL: ImagePromptSet = {
  id: "semi-real",
  label: "Semi-Real",
  blurb: "Natural lighting and skin tones, less stylized.",
  swatch: ["#e9ecef", "#868e96"],
  imageStyle:
    "Semi-photorealistic digital illustration, natural skin tones and proportions, soft diffuse lighting, subtle film grain, contemporary portrait photography influence.",
  roomPrompt: [
    "A realistic top-down / high-angle view of a small studio apartment for a video-game.",
    "{{style}}",
    "Neutral warm daylight from windows, realistic materials, natural wood and fabric textures, clean readable layout. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook (bottom-right). No people, no text, no UI. Square composition,",
    "architectural clarity, viewed slightly from above like a life-sim. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "Head-and-shoulders framing, looking at camera, natural friendly expression,",
    "soft neutral studio backdrop, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "{{match}}",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain light-grey seamless studio background, softbox lighting, no text, no watermark, no UI.",
    "Photographic character reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of her studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Natural candid pose, realistic interior with balanced natural window light,",
    "no text, no watermark, no UI. Square composition, slight high angle like a life-sim.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where she is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Documentary-style framing, authentic in-the-moment energy, realistic stream setup,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

const RETRO_SIM: ImagePromptSet = {
  id: "retro-sim",
  label: "Retro Sim",
  blurb: "Cheerful isometric life-sim dollhouse look.",
  swatch: ["#51cf66", "#ffd43b"],
  imageStyle:
    "Isometric life-simulation game art, clean stylized 3D look, cheerful saturated colors, playful rounded shapes, The Sims inspired, crisp and readable.",
  roomPrompt: [
    "An isometric dollhouse view of a small studio apartment for a life-simulation video-game.",
    "{{style}}",
    "Bright cheerful daylight, pastel walls, playful clutter, highly readable floor plan. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook (bottom-right). No people, no text, no UI. Square composition,",
    "isometric camera angle like a classic life-sim build mode screenshot. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "Head-and-shoulders framing, looking at camera, friendly stylized expression,",
    "simple bright gradient background, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Appearance: {{description}}.",
    "{{match}}",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain flat mint-green studio background, even cartoon lighting, no text, no watermark, no UI.",
    "Stylized life-sim character turnaround.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of her studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Playful life-sim pose, bright isometric room, saturated cheerful colors,",
    "no text, no watermark, no UI. Square isometric composition.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where she is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Keep her appearance consistent with the reference image ({{description}}).",
    "Dynamic life-sim screenshot framing, expressive cartoon energy, colorful stream setup,",
    "no text, no watermark, no UI. Square isometric composition.",
    "{{style}}",
  ].join(" "),
};

export const IMAGE_STYLE_PRESETS: ImagePromptSet[] = [
  COZY_NEON,
  ANIME_CEL,
  GRAPHIC_NOVEL,
  SEMI_REAL,
  RETRO_SIM,
];

const PRESET_BY_ID = Object.fromEntries(IMAGE_STYLE_PRESETS.map((p) => [p.id, p])) as Record<
  ImageStylePresetId,
  ImagePromptSet
>;

export function getImagePreset(id: ImageStylePresetId | undefined): ImagePromptSet {
  return PRESET_BY_ID[id ?? "cozy-neon"] ?? COZY_NEON;
}

export type ImagePromptField =
  | "imageStyle"
  | "roomPrompt"
  | "portraitPrompt"
  | "bodyPrompt"
  | "presencePrompt"
  | "scenePrompt";

/** Effective prompt text: per-field override, else active preset, else cozy-neon. */
export function effectiveImagePrompt(settings: Settings, field: ImagePromptField): string {
  const override = (settings[field] ?? "").trim();
  if (override) return override;
  return getImagePreset(settings.imageStylePreset)[field];
}

/** Patch that clears all per-field overrides so the preset takes full effect. */
export function clearImagePromptOverrides(): Pick<
  Settings,
  "imageStyle" | "roomPrompt" | "portraitPrompt" | "bodyPrompt" | "presencePrompt" | "scenePrompt"
> {
  return {
    imageStyle: "",
    roomPrompt: "",
    portraitPrompt: "",
    bodyPrompt: "",
    presencePrompt: "",
    scenePrompt: "",
  };
}

export function hasImagePromptOverrides(settings: Settings): boolean {
  return (
    (settings.imageStyle ?? "").trim() !== "" ||
    (settings.roomPrompt ?? "").trim() !== "" ||
    (settings.portraitPrompt ?? "").trim() !== "" ||
    (settings.bodyPrompt ?? "").trim() !== "" ||
    (settings.presencePrompt ?? "").trim() !== "" ||
    (settings.scenePrompt ?? "").trim() !== ""
  );
}
