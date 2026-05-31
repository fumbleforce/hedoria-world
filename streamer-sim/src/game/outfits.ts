/**
 * Wardrobe. The outfit you're wearing applies a passive baseline-appeal nudge
 * while live — a cheaper, faster lever than gear for shaping who likes your
 * content (cute → hype, bold → simps/whales, cozy → cozy crowd). The one-off
 * "change outfit" actions equip these; the effect then rides every live beat
 * through the resolver's baseline appeal (game/controller.baselineAppeal).
 */

import type { SegmentId } from "./segments";

export type OutfitId = "casual" | "cozy" | "cute" | "bold";

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

export function outfitAppeal(id: OutfitId | undefined): Partial<Record<SegmentId, number>> {
  return OUTFITS[id ?? "casual"]?.appeal ?? {};
}
