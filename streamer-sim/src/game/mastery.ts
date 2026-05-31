/**
 * Mastery — the personal-progression layer. As the streamer performs, she gains
 * experience in skill *domains* (driven by the action tags she actually does,
 * never per-action-id), and a veteran spends *less* energy/comfort on the same
 * act. Pure math, parallel to shop.multipliersFor; balance.ts owns the curve.
 */

import { clamp } from "../rng/rng";
import { BALANCE, MASTERY_TAGS, type MasteryDomain } from "./balance";

export type MasteryState = Record<MasteryDomain, number>;

export function initialMastery(): MasteryState {
  const out = {} as MasteryState;
  for (const d of BALANCE.mastery.domains) out[d] = 0;
  return out;
}

/** Backfill any missing domains on a rehydrated save. */
export function normalizeMastery(m: Partial<MasteryState> | undefined): MasteryState {
  const out = initialMastery();
  if (m) for (const d of BALANCE.mastery.domains) out[d] = m[d] ?? 0;
  return out;
}

/** Level from accumulated XP: a sqrt curve, so each level costs more XP. */
export function masteryLevel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / BALANCE.mastery.levelCurve));
}

export interface MasteryProgress {
  level: number;
  /** XP earned toward the next level (within current level band). */
  into: number;
  /** XP needed to reach the next level from current level start. */
  need: number;
  /** 0..1 progress within the current level band. */
  pct: number;
}

/** Progress toward the next level for UI readouts. */
export function masteryProgress(xp: number): MasteryProgress {
  const level = masteryLevel(xp);
  const levelStart = level * level * BALANCE.mastery.levelCurve;
  const nextStart = (level + 1) * (level + 1) * BALANCE.mastery.levelCurve;
  const into = Math.max(0, xp - levelStart);
  const need = nextStart - levelStart;
  const pct = need > 0 ? clamp(into / need, 0, 1) : 1;
  return { level, into, need, pct };
}

/**
 * Cost multiplier for a domain (≤ 1). Each level shaves `efficiencyPerLevel`
 * off the personal cost of matching actions, floored so it's never free.
 */
export function masteryCostMult(xp: number): number {
  const level = masteryLevel(xp);
  return clamp(
    1 - level * BALANCE.mastery.efficiencyPerLevel,
    BALANCE.mastery.efficiencyFloor,
    1,
  );
}

/** XP to add per domain for an action with these tags at this intensity. */
export function masteryXpForAction(tags: readonly string[], intensity: number): Partial<MasteryState> {
  const gain = BALANCE.mastery.xpPerIntensity * Math.max(1, intensity);
  const out: Partial<MasteryState> = {};
  for (const domain of BALANCE.mastery.domains) {
    if (tags.some((t) => MASTERY_TAGS[domain].includes(t))) out[domain] = gain;
  }
  return out;
}
