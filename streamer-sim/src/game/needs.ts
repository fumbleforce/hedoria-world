/**
 * Survival needs + horny helpers — pure functions over Metrics + BALANCE.
 */

import { BALANCE } from "./balance";
import { isNoLimits } from "./content";
import type { ContentTier, Metrics } from "./types";
import type { ActionVerdict } from "./actions";

export type NeedKey = "hunger" | "bladder" | "hygiene";

const INTIMATE_TAGS = new Set([
  "flirty",
  "teasing",
  "suggestive",
  "bold",
  "vulnerable",
  "boundary-crossing",
]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function needFactor(v: number): number {
  const { warnBelow, strainFloor } = BALANCE.needs;
  if (v >= warnBelow) return 1;
  return strainFloor + (1 - strainFloor) * (v / warnBelow);
}

/** Multiplier for viewer pull when needs are low; worst = lowest need below warn. */
export function needsStrain(metrics: Metrics): { factor: number; worst: NeedKey | null } {
  const hunger = needFactor(metrics.hunger);
  const bladder = needFactor(metrics.bladder);
  const hygiene = needFactor(metrics.hygiene);
  const factor = Math.min(hunger, bladder, hygiene);
  const { warnBelow } = BALANCE.needs;
  let worst: NeedKey | null = null;
  let lowest = Infinity;
  for (const k of ["hunger", "bladder", "hygiene"] as const) {
    const v = metrics[k];
    if (v < warnBelow && v < lowest) {
      lowest = v;
      worst = k;
    }
  }
  return { factor, worst };
}

/** Extra drains when a need is critical (live beats only). */
export function needsPenaltyPerBeat(metrics: Metrics): Partial<Metrics> {
  const { criticalBelow, criticalComfortDrainPerBeat, criticalEnergyDrainPerBeat } = BALANCE.needs;
  let comfort = 0;
  let energy = 0;
  for (const k of ["hunger", "bladder", "hygiene"] as const) {
    if (metrics[k] <= criticalBelow) {
      comfort -= criticalComfortDrainPerBeat;
      energy -= criticalEnergyDrainPerBeat;
    }
  }
  if (!comfort && !energy) return {};
  return { comfort, energy };
}

/** Drain hunger/bladder/hygiene over elapsed minutes. */
export function drainNeeds(metrics: Metrics, minutes: number): Partial<Metrics> {
  const d = BALANCE.needs.drainPerMin;
  return {
    hunger: metrics.hunger - d.hunger * minutes,
    bladder: metrics.bladder - d.bladder * minutes,
    hygiene: metrics.hygiene - d.hygiene * minutes,
  };
}

export type NagNeed = NeedKey | "hygiene_gross";

const NAG_TEXT: Record<NeedKey, string> = {
  hunger: "Your stomach growls — you should eat soon.",
  bladder: "You really need the bathroom.",
  hygiene: "You feel gross and need a shower.",
};

/** Which need just crossed into critical (for throttled nags). */
export function nagForNeed(metrics: Metrics, prev: Metrics): NeedKey | null {
  const { criticalBelow } = BALANCE.needs;
  for (const k of ["hunger", "bladder", "hygiene"] as const) {
    if (prev[k] > criticalBelow && metrics[k] <= criticalBelow) return k;
  }
  return null;
}

export function nagMessage(need: NeedKey): string {
  return NAG_TEXT[need];
}

export interface PhysicalCues {
  public: string[];
  private: string[];
}

/** In-fiction body-state phrases for LLM context (public vs private). */
export function physicalCues(metrics: Metrics, tier: ContentTier): PhysicalCues {
  const pub: string[] = [];
  const priv: string[] = [];
  const c = BALANCE.needs;

  if (isNoLimits(tier)) {
    if (metrics.horny >= c.cueHornyHigh) {
      pub.push("flushed and panting, blushing very easily");
    } else if (metrics.horny >= c.cueHornyMedium) {
      pub.push("lightly hot and bothered");
    }
  }

  if (metrics.hunger <= c.cueHungerBelow) {
    pub.push("stomach rumbles now and then");
  }
  if (metrics.hygiene <= c.cueHygieneBelow) {
    pub.push("feeling sweaty and a bit gross");
  }
  if (metrics.bladder <= c.cueBladderBelow) {
    priv.push("increasingly needs the bathroom");
  }

  return { public: pub, private: priv };
}

function intimateTagCount(tags: string[]): number {
  return tags.filter((t) => INTIMATE_TAGS.has(t)).length;
}

/** Horny gain from a live beat (No Limits only). */
export function hornyBuild(
  verdict: Pick<ActionVerdict, "tags" | "intensity">,
  spicyChatCount: number,
  tier: ContentTier,
): number {
  if (!isNoLimits(tier)) return 0;
  const h = BALANCE.horny;
  let gain = 0;
  if (intimateTagCount(verdict.tags) > 0) {
    gain += h.buildPerIntensity * verdict.intensity;
  }
  gain += Math.min(3, spicyChatCount) * h.buildPerSpicyChat;
  return gain;
}

/** Comfort-cost multiplier for intimate tags (1 = full cost, lower = eased). */
export function hornyComfortEase(horny: number, tier: ContentTier): number {
  const max = BALANCE.horny.comfortEaseMax;
  if (!max || !isNoLimits(tier)) return 1;
  return 1 - (horny / 100) * max;
}

/** Scene horny relief scaled by intensity 1–5. */
export function hornySceneRelief(intensity: number, tier: ContentTier): number {
  if (!isNoLimits(tier)) return 0;
  const { reliefSceneMin, reliefSceneMax } = BALANCE.horny;
  const t = clamp(intensity, 1, 5);
  const frac = (t - 1) / 4;
  return Math.round(reliefSceneMin + (reliefSceneMax - reliefSceneMin) * frac);
}

/** Force horny to 0 when not in No Limits. */
export function clampHornyForTier(horny: number, tier: ContentTier): number {
  return isNoLimits(tier) ? clamp(horny, 0, 100) : 0;
}
