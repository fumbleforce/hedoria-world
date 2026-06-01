/**
 * Clothing vibe tags (casual / cozy / cute / bold) and their segment-appeal
 * weights. Equipped items stack vibes via `wardrobeAppeal()` in `wardrobe.ts`;
 * `dominantOutfitVibe()` picks the label shown in UI from what is actually worn.
 */

import type { SegmentId } from "./segments";

export type OutfitId = "casual" | "cozy" | "cute" | "bold";
/** Vibe tag on clothing items — maps to segment appeal via OUTFITS. */
export type VibeId = OutfitId;

export interface OutfitDef {
  id: OutfitId;
  label: string;
  /** Passive per-beat baseline appeal while equipped and live. */
  appeal: Partial<Record<SegmentId, number>>;
}

export const OUTFITS: Record<OutfitId, OutfitDef> = {
  casual: { id: "casual", label: "Casual", appeal: {} },
  cozy: { id: "cozy", label: "Cozy", appeal: { cozy: 1, lonely: 0.5 } },
  cute: { id: "cute", label: "Cute", appeal: { hype: 1, simps: 0.5 } },
  bold: { id: "bold", label: "Bold", appeal: { simps: 1.5, whales: 0.5, cozy: -0.5 } },
};

export function outfitVibeLabel(id: OutfitId): string {
  return OUTFITS[id]?.label ?? id;
}
