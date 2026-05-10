import { SURFACE_CONDITIONS, SURFACE_MATERIALS } from "../sceneSpec";
import type { SurfaceCondition, SurfaceMaterial } from "../sceneSpec";

export type TexturePromptInput = {
  material: SurfaceMaterial;
  condition: SurfaceCondition;
  paletteHint?: string[];
  /**
   * Optional small note for variants beyond the (material, condition) pair.
   * E.g. "neon" for an emissive override on a lamp template. Kept generic — no
   * world-specific names allowed here either.
   */
  variant?: string;
};

const MATERIAL_DESCRIPTIONS: Record<SurfaceMaterial, string> = {
  stone: "natural stone surface, slabs and aggregate, subtle veining",
  earth: "packed soil and grass tussocks, organic earth texture",
  sand: "wind-shaped grains and shallow ripples",
  metal: "machined metal panels with seams and rivets",
  wood: "planks with visible grain and weathering",
  water: "still water surface with faint ripples",
  ice: "polycrystalline ice with refractive flecks",
  crystal: "tightly packed crystal facets, prismatic highlights",
  energy: "abstract energy field, soft glow, faint particles",
  void: "dim, near-featureless void surface, faint ambient sheen",
};

const CONDITION_DESCRIPTIONS: Record<SurfaceCondition, string> = {
  pristine: "clean, well-kept, intact",
  worn: "weathered, faintly cracked, dust in seams",
  ruined: "broken, cracked, partially fallen, debris and gaps",
  scorched: "burnt, blackened, soot streaks, heat damage",
  overgrown: "moss, vines, lichen creeping across, organic fingers",
};

export function buildTextureSystemPrompt(): string {
  return [
    "You are the Voyage texture-generation prompt builder. Generate ONE seamless tiling texture per request describing a (material, condition) pair, plus an optional generic variant tag. The texture must:",
    "- be a top-down view of a horizontal surface;",
    "- tile seamlessly horizontally and vertically;",
    "- contain no characters, no logos, no text, no figures;",
    "- contain no genre-specific motifs (no fantasy crests, no sci-fi insignia, no historical markers);",
    "- match the material description and condition modifier exactly;",
    "- be lit ambiently from above with a single soft directional component;",
    "- avoid lens flare, vignette, depth of field, and pictorial framing;",
    "- be at most 1024x1024 px.",
    "",
    "Vocabulary:",
    `material: ${SURFACE_MATERIALS.join(" | ")}`,
    `condition: ${SURFACE_CONDITIONS.join(" | ")}`,
  ].join("\n");
}

export function buildTexturePrompt(input: TexturePromptInput): string {
  const material = MATERIAL_DESCRIPTIONS[input.material];
  const condition = CONDITION_DESCRIPTIONS[input.condition];
  const palette = input.paletteHint?.length
    ? `\nPalette hint: ${input.paletteHint.join(", ")} (approximate, may deviate slightly).`
    : "";
  const variant = input.variant
    ? `\nVariant tag (generic only): ${input.variant}.`
    : "";
  return [
    `Material: ${input.material} — ${material}.`,
    `Condition: ${input.condition} — ${condition}.`,
    "Output: one seamless tiling texture suitable for a flat ground plane, no objects, no people, no text.",
    palette + variant,
  ].join("\n");
}

export function textureKey(material: SurfaceMaterial, condition: SurfaceCondition, variant?: string): string {
  const base = `${material}-${condition}`;
  return variant ? `${base}-${slugify(variant)}` : base;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/(^-|-$)/gu, "")
    .slice(0, 32);
}

export function listBaseTextureKeys(): Array<{
  key: string;
  material: SurfaceMaterial;
  condition: SurfaceCondition;
}> {
  const out: Array<{ key: string; material: SurfaceMaterial; condition: SurfaceCondition }> = [];
  for (const material of SURFACE_MATERIALS) {
    for (const condition of SURFACE_CONDITIONS) {
      out.push({ key: textureKey(material, condition), material, condition });
    }
  }
  return out;
}
