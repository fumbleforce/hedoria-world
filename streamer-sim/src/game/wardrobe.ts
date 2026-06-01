import type { SegmentId } from "./segments";
import { OUTFITS, type OutfitId, type VibeId } from "./outfits";
import type { Item } from "./items";
import { isClothingItem, makeClothingItem } from "./items";
import { isNoLimits } from "./content";
import type { ContentTier } from "./types";
import { genderMode, type GenderPreset } from "./gender";

export const STARTER_WARDROBE_META = "starterWardrobe";

export type ClothingSlot =
  | "underwear"
  | "top"
  | "bottom"
  | "feet"
  | "head"
  | "outer"
  | "accessory"
  | "full";

/** Display/layering order: base layer first. */
export const CLOTHING_SLOTS: ClothingSlot[] = [
  "underwear",
  "top",
  "bottom",
  "feet",
  "head",
  "outer",
  "accessory",
  "full",
];

/**
 * Whether a clothing slot may be *removed* (taken off, leaving that layer bare)
 * at the current content tier. Changing into a different piece is always allowed;
 * this only gates stripping a layer off.
 * - underwear: only at No-Limits tiers (unhinged / custom).
 * - top / bottom: not at wholesome (clothes can only be swapped there).
 * - everything else (outer, feet, head, accessory, full): always removable.
 */
export function canRemoveClothingSlot(slot: ClothingSlot, tier: ContentTier): boolean {
  if (slot === "underwear") return isNoLimits(tier);
  if (slot === "top" || slot === "bottom") return tier !== "wholesome";
  return true;
}

const SLOT_LABEL: Record<ClothingSlot, string> = {
  underwear: "Underwear",
  top: "Top",
  bottom: "Bottom",
  feet: "Feet",
  head: "Head",
  outer: "Outer",
  accessory: "Accessory",
  full: "Full outfit",
};

export function clothingSlotLabel(slot: ClothingSlot): string {
  return SLOT_LABEL[slot];
}

/** Map vibe tags to segment appeal using the legacy outfit table. */
function vibeToSegmentAppeal(vibe: VibeId, amount: number): Partial<Record<SegmentId, number>> {
  const base = OUTFITS[vibe]?.appeal ?? {};
  const out: Partial<Record<SegmentId, number>> = {};
  for (const [seg, v] of Object.entries(base) as [SegmentId, number][]) {
    out[seg] = (out[seg] ?? 0) + v * amount;
  }
  return out;
}

/** Diminishing returns: each stacked point of the same vibe is worth slightly less. */
function stackValue(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += 1 / (1 + i * 0.15);
  return total;
}

/**
 * Combined passive appeal from all equipped clothing pieces.
 * Vibes stack with diminishing returns so 5 cute pieces read strongly cute.
 */
export function wardrobeAppeal(
  equipped: Partial<Record<ClothingSlot, string>>,
  inventory: readonly Item[],
): Partial<Record<SegmentId, number>> {
  const vibeTotals: Partial<Record<VibeId, number>> = {};
  const byId = new Map(inventory.map((i) => [i.id, i]));

  for (const itemId of Object.values(equipped)) {
    if (!itemId) continue;
    const item = byId.get(itemId);
    if (!item || !isClothingItem(item)) continue;
    for (const [vibe, amt] of Object.entries(item.vibes) as [VibeId, number][]) {
      vibeTotals[vibe] = (vibeTotals[vibe] ?? 0) + amt;
    }
  }

  const out: Partial<Record<SegmentId, number>> = {};
  const add = (seg: SegmentId, v: number) => {
    out[seg] = (out[seg] ?? 0) + v;
  };

  for (const [vibe, raw] of Object.entries(vibeTotals) as [VibeId, number][]) {
    const scaled = stackValue(raw);
    for (const [seg, v] of Object.entries(vibeToSegmentAppeal(vibe, scaled)) as [SegmentId, number][]) {
      add(seg, v);
    }
  }

  return out;
}

const VIBE_PRIORITY: OutfitId[] = ["casual", "cozy", "cute", "bold"];

/**
 * Dominant vibe from equipped clothing (sum of item vibe weights). Used for UI
 * labels and preset matching — not stored on settings.
 */
export function dominantOutfitVibe(
  equipped: Partial<Record<ClothingSlot, string>>,
  inventory: readonly Item[],
): OutfitId {
  const vibeTotals: Partial<Record<VibeId, number>> = {};
  const byId = new Map(inventory.map((i) => [i.id, i]));

  for (const itemId of Object.values(equipped)) {
    if (!itemId) continue;
    const item = byId.get(itemId);
    if (!item || !isClothingItem(item)) continue;
    for (const [vibe, amt] of Object.entries(item.vibes) as [VibeId, number][]) {
      vibeTotals[vibe] = (vibeTotals[vibe] ?? 0) + amt;
    }
  }

  let best: OutfitId = "casual";
  let bestScore = -1;
  for (const id of VIBE_PRIORITY) {
    const score = vibeTotals[id] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

type StarterPiece = {
  name: string;
  description: string;
  slot: ClothingSlot;
  vibes: Partial<Record<VibeId, number>>;
};

/** Default three-piece starter sets (underwear + top + bottom) per gender mode. */
const STARTER_GENDER_SETS: Record<GenderPreset, StarterPiece[]> = {
  female: [
    { name: "Cotton Bra & Briefs", description: "Plain, comfortable everyday underwear.", slot: "underwear", vibes: { casual: 0.5 } },
    { name: "Everyday Tee", description: "Simple, comfortable, nothing fancy.", slot: "top", vibes: { casual: 1 } },
    { name: "Blue Jeans", description: "Reliable default.", slot: "bottom", vibes: { casual: 0.5 } },
  ],
  male: [
    { name: "Cotton Boxer Briefs", description: "Plain, comfortable everyday underwear.", slot: "underwear", vibes: { casual: 0.5 } },
    { name: "Crew Neck Tee", description: "Simple, comfortable, nothing fancy.", slot: "top", vibes: { casual: 1 } },
    { name: "Relaxed Jeans", description: "Reliable default.", slot: "bottom", vibes: { casual: 0.5 } },
  ],
  custom: [
    { name: "Neutral Boxer Briefs", description: "Comfortable unisex underwear.", slot: "underwear", vibes: { casual: 0.5 } },
    { name: "Oversized Tee", description: "Relaxed fit, easy on cam.", slot: "top", vibes: { casual: 1 } },
    { name: "Cargo Joggers", description: "Easy movement, neutral silhouette.", slot: "bottom", vibes: { casual: 0.5 } },
  ],
};

function buildStarterSet(
  pieces: StarterPiece[],
  tagStarter = false,
): {
  items: import("./items").ClothingItem[];
  equipped: Partial<Record<ClothingSlot, string>>;
} {
  const items = pieces.map((p) =>
    makeClothingItem({
      name: p.name,
      description: p.description,
      slot: p.slot,
      vibes: { ...p.vibes },
      ...(tagStarter ? { meta: { [STARTER_WARDROBE_META]: "1" } } : {}),
    }),
  );
  const equipped: Partial<Record<ClothingSlot, string>> = {};
  for (const item of items) equipped[item.slot] = item.id;
  return { items, equipped };
}

/** Starter three-piece set for a vibe, with gender-appropriate underwear names. */
export function starterClothingFor(
  outfit: OutfitId,
  gender: string,
): {
  items: import("./items").ClothingItem[];
  equipped: Partial<Record<ClothingSlot, string>>;
} {
  const pieces = [...(STARTER_SETS[outfit] ?? STARTER_SETS.casual)];
  const mode = genderMode(gender);
  if (mode !== "female") {
    const genderUnderwear = (STARTER_GENDER_SETS[mode] ?? STARTER_GENDER_SETS.female).find(
      (p) => p.slot === "underwear",
    );
    const idx = pieces.findIndex((p) => p.slot === "underwear");
    if (genderUnderwear && idx >= 0) {
      pieces[idx] = { ...genderUnderwear, vibes: { ...pieces[idx].vibes } };
    }
  }
  return buildStarterSet(pieces, true);
}

/** Casual starter keyed off gender only (save migration). */
export function starterClothingForGender(gender: string): {
  items: import("./items").ClothingItem[];
  equipped: Partial<Record<ClothingSlot, string>>;
} {
  return starterClothingFor("casual", gender);
}

export function isStarterWardrobeItem(item: Item): boolean {
  return item.meta?.[STARTER_WARDROBE_META] === "1";
}

/** Concrete three-piece starter sets (underwear + top + bottom) per vibe. */
const STARTER_SETS: Record<OutfitId, StarterPiece[]> = {
  casual: [
    { name: "Cotton Bra & Briefs", description: "Plain, comfortable everyday underwear.", slot: "underwear", vibes: { casual: 0.5 } },
    { name: "Everyday Tee", description: "Simple, comfortable, nothing fancy.", slot: "top", vibes: { casual: 1 } },
    { name: "Blue Jeans", description: "Reliable default.", slot: "bottom", vibes: { casual: 0.5 } },
  ],
  cozy: [
    { name: "Soft Cotton Set", description: "Worn-in, comfy underwear.", slot: "underwear", vibes: { cozy: 0.5 } },
    { name: "Oversized Hoodie", description: "Soft, warm, and very streamable.", slot: "top", vibes: { cozy: 1 } },
    { name: "Lounge Shorts", description: "The comfiest thing you own.", slot: "bottom", vibes: { cozy: 0.5 } },
  ],
  cute: [
    { name: "Frilly Lingerie Set", description: "A cute matching bra and panties.", slot: "underwear", vibes: { cute: 0.5 } },
    { name: "Frilly Crop Top", description: "Photogenic and playful.", slot: "top", vibes: { cute: 1 } },
    { name: "Pleated Mini Skirt", description: "Spins nicely on cam.", slot: "bottom", vibes: { cute: 0.5 } },
  ],
  bold: [
    { name: "Lace Lingerie Set", description: "Daring lace underwear.", slot: "underwear", vibes: { bold: 0.5 } },
    { name: "Cropped Tank", description: "Shows a little, says a lot.", slot: "top", vibes: { bold: 1 } },
    { name: "Faux-Leather Mini", description: "Bold silhouette, bold energy.", slot: "bottom", vibes: { bold: 0.5 } },
  ],
};

/** @deprecated Prefer `starterClothingFor(outfit, gender)` — female underwear names. */
export function starterClothingForOutfit(outfit: OutfitId): {
  items: import("./items").ClothingItem[];
  equipped: Partial<Record<ClothingSlot, string>>;
} {
  return starterClothingFor(outfit, "female");
}

/** True if a save's clothing is the obsolete single "full outfit" starter placeholder. */
export function isLegacyStarterWardrobe(inventory: readonly Item[]): boolean {
  const clothing = inventory.filter(isClothingItem);
  if (clothing.length === 0) return false;
  const hasRealGarment = clothing.some((c) => c.slot === "top" || c.slot === "bottom" || c.slot === "underwear");
  return !hasRealGarment;
}

/** Core garment slots always spelled out in image prompts (explicit "nothing" when empty). */
const CORE_OUTFIT_SLOTS: ClothingSlot[] = ["underwear", "top", "bottom"];

function outfitSlotDescription(
  slot: ClothingSlot,
  equipped: Partial<Record<ClothingSlot, string>>,
  byId: Map<string, Item>,
): string {
  const id = equipped[slot];
  const item = id ? byId.get(id) : undefined;
  return `${slot}: ${item?.name ?? "nothing"}`;
}

function hasVisibleOuterLayers(
  equipped: Partial<Record<ClothingSlot, string>>,
  byId: Map<string, Item>,
): boolean {
  if (equipped.full && byId.get(equipped.full)) return true;
  return !!(equipped.top && byId.get(equipped.top) && equipped.bottom && byId.get(equipped.bottom));
}

/** Human-readable summary of equipped clothing for prompts and UI. */
export function describeEquippedLook(
  equipped: Partial<Record<ClothingSlot, string>>,
  inventory: readonly Item[],
  opts?: { hideCoveredUnderwear?: boolean },
): string {
  const byId = new Map(inventory.map((i) => [i.id, i]));
  const coreSlots =
    opts?.hideCoveredUnderwear && hasVisibleOuterLayers(equipped, byId)
      ? CORE_OUTFIT_SLOTS.filter((slot) => slot !== "underwear")
      : CORE_OUTFIT_SLOTS;
  const parts = coreSlots.map((slot) => outfitSlotDescription(slot, equipped, byId));
  for (const slot of CLOTHING_SLOTS) {
    if (CORE_OUTFIT_SLOTS.includes(slot)) continue;
    const id = equipped[slot];
    if (!id) continue;
    const item = byId.get(id);
    if (item) parts.push(`${slot}: ${item.name}`);
  }
  return parts.join(", ");
}
