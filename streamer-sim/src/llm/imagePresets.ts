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
  | "retro-sim"
  | "pixel-art"
  | "storybook"
  | "synthwave"
  | "claymation"
  | "papercraft";

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
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a slice-of-life anime background. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, expressive anime eyes, friendly smile,",
    "soft gradient background, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain flat light-grey studio background, even lighting, no shadows on the floor,",
    "no text, no watermark, no UI. Clean anime turnaround reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural slice-of-life pose, bright cheerful anime interior lighting,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
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
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a comic establishing panel. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, confident expression,",
    "dark textured background with a single warm rim light, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain off-white paper background, flat even lighting, no text, no watermark, no UI.",
    "Ink-and-wash character turnaround reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural pose, dramatic comic-panel lighting with strong shadows,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
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
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "architectural clarity, viewed slightly from above like a life-sim. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, natural friendly expression,",
    "soft neutral studio backdrop, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain light-grey seamless studio background, softbox lighting, no text, no watermark, no UI.",
    "Photographic character reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural candid pose, realistic interior with balanced natural window light,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
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
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "isometric camera angle like a classic life-sim build mode screenshot. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, friendly stylized expression,",
    "simple bright gradient background, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain flat mint-green studio background, even cartoon lighting, no text, no watermark, no UI.",
    "Stylized life-sim character turnaround.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Playful life-sim pose, bright cheerful interior, saturated cheerful colors,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Dynamic life-sim screenshot framing, expressive cartoon energy, colorful stream setup,",
    "no text, no watermark, no UI. Square isometric composition.",
    "{{style}}",
  ].join(" "),
};

const PIXEL_ART: ImagePromptSet = {
  id: "pixel-art",
  label: "Pixel Art",
  blurb: "Crisp 16-bit pixel art, retro cozy-game charm.",
  swatch: ["#3bc9db", "#f783ac"],
  imageStyle:
    "Detailed 16-bit pixel art, crisp clean pixel clusters and dithering, limited retro palette, sharp hard edges with no blur or anti-aliasing, cozy SNES-era game sprite aesthetic.",
  roomPrompt: [
    "A top-down / high-angle pixel-art view of a small studio apartment for a retro video-game.",
    "{{style}}",
    "Warm cozy interior, tidy pixel tiling, readable chunky props. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a classic top-down RPG room. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Pixel-art character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, friendly expression, readable chunky pixels,",
    "simple flat background, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body pixel-art character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain flat light-grey background, even lighting, no text, no watermark, no UI.",
    "Clean pixel-art sprite turnaround reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural pixel-sprite pose, cozy interior lighting,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Expressive pixel-art scene, readable retro-game framing, cozy stream setup,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

const STORYBOOK: ImagePromptSet = {
  id: "storybook",
  label: "Storybook",
  blurb: "Hand-painted gouache, soft whimsical Ghibli warmth.",
  swatch: ["#ffd8a8", "#69db7c"],
  imageStyle:
    "Hand-painted storybook illustration, soft gouache and watercolor textures, visible painterly brushwork, warm whimsical golden-hour lighting, gentle Studio Ghibli inspired charm.",
  roomPrompt: [
    "A top-down / high-angle view of a small studio apartment for a cozy video-game.",
    "{{style}}",
    "Soft painterly afternoon light, lived-in warmth, gentle plants and clutter, dreamy readable layout. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a painted picture-book spread. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Hand-painted storybook portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, warm gentle expression,",
    "soft painted gradient background, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body hand-painted character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain soft cream painted background, even gentle lighting, no text, no watermark, no UI.",
    "Painterly storybook character turnaround.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural gentle pose, warm painted interior light, dreamy storybook mood,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Painterly picture-book framing, warm expressive mood, cozy stream-room setting,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

const SYNTHWAVE: ImagePromptSet = {
  id: "synthwave",
  label: "Synthwave",
  blurb: "80s neon retro-future — chrome, glow, sunset grid.",
  swatch: ["#f72585", "#4361ee"],
  imageStyle:
    "1980s synthwave / outrun aesthetic, glowing neon magenta and cyan, chrome reflections, retro-futurist sunset gradients, subtle scanline glow and grid lines, bold and electric.",
  roomPrompt: [
    "A top-down / high-angle view of a small studio apartment for a retro-futurist video-game.",
    "{{style}}",
    "Neon-drenched night, magenta and cyan light strips, glowing grid floor accents, dark glossy surfaces. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a stylish life-sim. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Synthwave character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, confident expression,",
    "dark background with neon magenta-and-cyan rim glow, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body synthwave character reference sheet of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain dark studio background with subtle neon glow, no text, no watermark, no UI.",
    "Neon retro-futurist character turnaround.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural pose, neon-lit retro-futurist interior, glowing magenta-cyan accents,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Electric synthwave framing, dramatic neon glow, glossy retro-future stream setup,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

const CLAYMATION: ImagePromptSet = {
  id: "claymation",
  label: "Claymation",
  blurb: "Tactile stop-motion clay, sculpted and handmade.",
  swatch: ["#ff922b", "#a9e34b"],
  imageStyle:
    "Stop-motion claymation look, sculpted modeling-clay surfaces with visible fingerprints and tool marks, soft studio key light, tactile handmade miniature set, Aardman inspired.",
  roomPrompt: [
    "A top-down / high-angle view of a small studio apartment built as a claymation miniature set.",
    "{{style}}",
    "Soft diffused set lighting, chunky sculpted clay furniture, tactile handmade textures, readable layout. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a miniature diorama. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Claymation character portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, charming sculpted expression, visible clay texture,",
    "soft seamless backdrop, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body claymation character reference of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain light-grey seamless backdrop, soft even set lighting, no text, no watermark, no UI.",
    "Sculpted clay character turnaround reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural sculpted pose, soft miniature-set lighting, tactile clay textures,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Charming stop-motion framing, expressive clay posing, handmade miniature stream set,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

const PAPERCRAFT: ImagePromptSet = {
  id: "papercraft",
  label: "Papercraft",
  blurb: "Layered cut-paper diorama with soft depth shadows.",
  swatch: ["#fab005", "#4dabf7"],
  imageStyle:
    "Layered cut-paper craft diorama, stacked construction-paper shapes, soft drop shadows between paper layers, handmade collage texture, clean charming and tactile.",
  roomPrompt: [
    "A top-down / high-angle view of a small studio apartment built from layered cut paper.",
    "{{style}}",
    "Soft even light casting gentle shadows between paper layers, bright crafty colors, readable flat-but-layered shapes. One room containing:",
    "an unmade bed (top-left), a streaming desk with dual monitors, webcam, ring light",
    "and RGB (top-right), a comfy couch with a rug (center), a small kitchenette with a",
    "hot plate and kettle (bottom-left), a front door (bottom-center), and a tiny",
    "bathroom nook with a bathroom door (bottom-right). No people, no text, no UI. Square composition,",
    "viewed slightly from above like a paper diorama. {{upgrades}}",
  ].join(" "),
  portraitPrompt: [
    "Cut-paper papercraft portrait of {{name}}, a {{gender}} video-game streamer.",
    "Face: {{faceDescription}}.",
    "Head-and-shoulders framing, looking at camera, friendly expression, layered paper shapes with soft shadows,",
    "simple layered-paper background, no text, no watermark, no UI.",
    "{{style}}",
    "Square composition.",
  ].join(" "),
  bodyPrompt: [
    "Full-body cut-paper character reference of {{name}}, a {{gender}} video-game streamer.",
    "Body: {{bodyDescription}}.",
    "{{match}}",
    "Wearing: {{outfit}}.",
    "Standing in a neutral A-pose / T-pose, facing forward, full body visible head to toe,",
    "plain light-grey background, soft even lighting, no text, no watermark, no UI.",
    "Layered papercraft character turnaround reference.",
    "{{style}}",
  ].join(" "),
  presencePrompt: [
    `Show this exact character, {{name}}, at the "{{zone}}" of {{poss}} studio apartment.`,
    "The spot: {{zoneDesc}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Natural pose, soft paper-layer shadows, bright crafty diorama lighting,",
    "no text, no watermark, no UI. Square composition, eye-level / standing-height view; the character standing or seated naturally in the space.",
    "{{style}}",
  ].join(" "),
  scenePrompt: [
    "Illustrate this moment of {{name}}'s livestream.",
    "Where {{name}} is right now: {{position}}.",
    "What is happening: {{narrative}}",
    "Face: {{faceDescription}}. Body: {{bodyDescription}}.",
    "Keep {{poss}} appearance consistent with the reference image.",
    "Charming layered-paper framing, expressive cut-paper posing, crafty stream-room diorama,",
    "no text, no watermark, no UI. Square composition.",
    "{{style}}",
  ].join(" "),
};

export const IMAGE_STYLE_PRESETS: ImagePromptSet[] = [
  COZY_NEON,
  ANIME_CEL,
  GRAPHIC_NOVEL,
  SEMI_REAL,
  RETRO_SIM,
  PIXEL_ART,
  STORYBOOK,
  SYNTHWAVE,
  CLAYMATION,
  PAPERCRAFT,
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
