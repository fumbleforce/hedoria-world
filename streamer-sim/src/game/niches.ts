/**
 * Content niches. The niche you stream shapes WHO shows up (spawn-weight bias in
 * presence) and the baseline appeal of your content (resolver), so a cozy niche
 * pulls the cozy/lonely crowd while a spicy niche pulls simps/whales (and pushes
 * the cozy crowd away). Switching costs a little — see BALANCE.niche. Pure data.
 */

import type { SegmentId } from "./segments";
import { BALANCE } from "./balance";

export type NicheId = "variety" | "cozy" | "gaming" | "justchatting" | "spicy";

export interface NicheDef {
  id: NicheId;
  label: string;
  blurb: string;
  /** Relative spawn-weight nudge per segment (×spawnShift in presence). */
  spawnBias: Partial<Record<SegmentId, number>>;
  /** Passive baseline appeal added per segment in the resolver. */
  baselineAppeal: Partial<Record<SegmentId, number>>;
}

export const NICHES: Record<NicheId, NicheDef> = {
  variety: {
    id: "variety",
    label: "Variety",
    blurb: "A bit of everything. No strong pull either way.",
    spawnBias: {},
    baselineAppeal: {},
  },
  cozy: {
    id: "cozy",
    label: "Cozy / Chatting",
    blurb: "Chill vibes. Draws the cozy crowd and lonely hearts.",
    spawnBias: { cozy: 1, lonely: 0.6, trolls: -0.4 },
    baselineAppeal: { cozy: 1, lonely: 1 },
  },
  gaming: {
    id: "gaming",
    label: "Gaming",
    blurb: "High-energy gameplay. Hype beasts and trolls roll in.",
    spawnBias: { hype: 1, trolls: 0.5, cozy: -0.3 },
    baselineAppeal: { hype: 1 },
  },
  justchatting: {
    id: "justchatting",
    label: "Just Chatting",
    blurb: "Personal, talky streams. Lonely hearts and whales engage.",
    spawnBias: { lonely: 1, whales: 0.4, cozy: 0.4 },
    baselineAppeal: { lonely: 1, whales: 0.5 },
  },
  spicy: {
    id: "spicy",
    label: "Spicy",
    blurb: "Flirty, bold content. Simps and whales — but cozy folks leave.",
    spawnBias: { simps: 1, whales: 0.6, cozy: -0.8, stalkers: 0.3 },
    baselineAppeal: { simps: 1, whales: 0.5, cozy: -1 },
  },
};

export const NICHE_IDS = Object.keys(NICHES) as NicheId[];

/** Segment spawn-weight bias for a niche, scaled by the global spawnShift. */
export function nicheSpawnBias(id: NicheId): Partial<Record<SegmentId, number>> {
  const def = NICHES[id] ?? NICHES.variety;
  const out: Partial<Record<SegmentId, number>> = {};
  for (const [seg, w] of Object.entries(def.spawnBias) as [SegmentId, number][]) {
    out[seg] = w * BALANCE.niche.spawnShift;
  }
  return out;
}

export function nicheBaselineAppeal(id: NicheId): Partial<Record<SegmentId, number>> {
  return (NICHES[id] ?? NICHES.variety).baselineAppeal;
}
