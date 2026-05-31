/**
 * Legible derived formulas — shared by controller and Stats panel.
 */

import { BALANCE } from "./balance";
import { needsStrain } from "./needs";
import { relationshipLevel, type Roster } from "./characters";
import type { AudienceState } from "./segments";
import { SEGMENT_IDS } from "./segments";
import type { Metrics } from "./types";
import type { Multipliers } from "./shop";

export interface ViewerDrivers {
  targetNamed: number;
  anonFloor: number;
  viewerMult: number;
  reputation: number;
  needsFactor: number;
  projectedViewers: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function targetNamed(metrics: Metrics): number {
  return clamp(Math.round(metrics.followers / 22) + 2, 2, 14);
}

export function anonFloor(metrics: Metrics): number {
  return Math.round(metrics.followers * 0.02 * (0.5 + metrics.hype / 100));
}

export function reputation(metrics: Metrics): number {
  return Math.min(1, metrics.followers / 300);
}

export function reach(metrics: Metrics): number {
  return (
    BALANCE.economy.reachBase +
    Math.min(BALANCE.economy.reachCap, metrics.followers * BALANCE.economy.reachPerFollower)
  );
}

export function monetizationRamp(metrics: Metrics): number {
  return Math.min(1, metrics.followers / BALANCE.economy.monetizationRampFollowers);
}

/** Average satisfaction-weighted happiness 0..1 over populated segments. */
export function happyNorm(audience: AudienceState): number {
  let sum = 0;
  let pop = 0;
  for (const id of SEGMENT_IDS) {
    const seg = audience[id];
    if (seg.population <= 0) continue;
    pop += seg.population;
    if (seg.satisfaction > 55) {
      sum += ((seg.satisfaction - 55) / 45) * seg.population;
    }
  }
  if (pop <= 0) return 0;
  return clamp(sum / pop, 0, 1);
}

export function viewerDrivers(metrics: Metrics, mult: Multipliers): ViewerDrivers {
  const { factor: needsFactor } = needsStrain(metrics);
  const baseTarget = Math.round(targetNamed(metrics) * mult.viewer * needsFactor);
  const baseAnon = Math.round(anonFloor(metrics) * mult.viewer * needsFactor);
  return {
    targetNamed: baseTarget,
    anonFloor: baseAnon,
    viewerMult: mult.viewer,
    reputation: reputation(metrics),
    needsFactor,
    projectedViewers: baseTarget + baseAnon,
  };
}

export interface GrowthProjection {
  reach: number;
  monetizationRamp: number;
  passiveFollowersPerBeat: number;
}

export function growthProjection(
  metrics: Metrics,
  audience: AudienceState,
  currentViewers: number,
): GrowthProjection {
  const r = reach(metrics);
  const ramp = monetizationRamp(metrics);
  const hn = happyNorm(audience);
  const passive = Math.max(
    0,
    Math.round(currentViewers * hn * BALANCE.economy.passiveFollowerRate * r),
  );
  return {
    reach: r,
    monetizationRamp: ramp,
    passiveFollowersPerBeat: passive,
  };
}

export interface SubProjection {
  subDailyRate: number;
  regularCount: number;
  estimatedGain: number;
  estimatedChurn: number;
  netPerDay: number;
}

/** Friend+ regulars for sub bonus (affinity at friend tier or above). */
export function countFriendPlusRegulars(roster: Roster): number {
  let n = 0;
  for (const c of Object.values(roster)) {
    const lvl = relationshipLevel(c.affinity);
    if (lvl === "friend" || lvl === "confidant" || lvl === "regular") n += 1;
  }
  return n;
}

export function subProjection(metrics: Metrics, roster: Roster): SubProjection {
  const regulars = countFriendPlusRegulars(roster);
  const gain = Math.round(
    metrics.followers * BALANCE.subs.subDailyRate + regulars * BALANCE.subs.subRegularBonus,
  );
  const churn = Math.round(metrics.subscribers * BALANCE.subs.subChurnRate);
  return {
    subDailyRate: BALANCE.subs.subDailyRate,
    regularCount: regulars,
    estimatedGain: gain,
    estimatedChurn: churn,
    netPerDay: Math.max(0, gain - churn),
  };
}

/** Fractional subs accrued per live beat (applied while streaming, not at sleep). */
export function liveSubFractionPerBeat(
  metrics: Metrics,
  roster: Roster,
  audience: AudienceState,
): number {
  const { estimatedGain } = subProjection(metrics, roster);
  if (estimatedGain <= 0) return 0;
  const hn = happyNorm(audience);
  const perBeat = estimatedGain / BALANCE.subs.liveBeatsPerDay;
  const mood = 0.45 + hn * 0.55;
  const hypeBoost = 0.65 + metrics.hype / 200;
  return perBeat * mood * hypeBoost;
}
