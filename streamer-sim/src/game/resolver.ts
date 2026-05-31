import { diag } from "../diag/log";
import type { ActionVerdict, StatPressure } from "./actions";
import {
  SEGMENTS,
  SEGMENT_IDS,
  totalViewers,
  type AudienceState,
} from "./segments";
import type { ContentTier, Metrics } from "./types";
import { tierIntensity } from "./content";
import type { Multipliers } from "./shop";
import { clamp } from "../rng/rng";
import { BALANCE } from "./balance";
import { masteryCostMult, type MasteryState } from "./mastery";

/**
 * The DISPOSER. Takes the evaluator's verdict + current state and computes
 * deterministic, clamped changes. The LLM never sets numbers — this does.
 *
 * Division of labour with presence.ts:
 *   - PRESENCE owns who's online → segment POPULATIONS.
 *   - The RESOLVER owns SATISFACTION shifts, tips, comfort pressure, follower
 *     growth, and the streamer's own stat pressure. It does not change
 *     populations (the caller refreshes those from presence each tick).
 */

export interface ResolveInput {
  verdict: ActionVerdict;
  metrics: Metrics;
  audience: AudienceState;
  mult: Multipliers;
  contentTier: ContentTier;
  isLive: boolean;
  /** Mastery XP per domain — reduces the personal cost of matching actions. */
  mastery?: MasteryState;
  /** Passive baseline appeal per segment (gear décor + production quality + niche). */
  baselineAppeal?: Partial<Record<string, number>>;
  /** Content freshness 0..1 — repeats drain it, dulling hype/appeal/follower gain. */
  novelty?: number;
}

export interface ResolveResult {
  metricsPatch: Partial<Metrics>;
  audience: AudienceState;
  earned: number;
  gainedFollowers: number;
  summary: string;
  /** Readiness multiplier applied to positive payoff (1 = full; <1 = gated). */
  readiness: number;
}

const PRESSURE_STEP: Record<Exclude<StatPressure, "none">, number> = { up: 1, down: -1 };

function pressureDelta(p: StatPressure | undefined, base: number, intensity: number): number {
  if (!p || p === "none") return 0;
  return PRESSURE_STEP[p] * base * (0.6 + intensity * 0.18);
}

export function resolveAction(input: ResolveInput): ResolveResult {
  const { verdict, metrics, mult, isLive } = input;
  const intensity = verdict.intensity;
  const audience = cloneAudience(input.audience);
  const tierMax = tierIntensity(input.contentTier);

  // Mastery cost-efficiency: a veteran spends less on the same act. Showmanship
  // shaves energy cost; Composure shaves the comfort cost of escalation. Floored
  // so it's never free (see balance.mastery.efficiencyFloor).
  const showmanshipMult = input.mastery ? masteryCostMult(input.mastery.showmanship) : 1;
  const composureMult = input.mastery ? masteryCostMult(input.mastery.composure) : 1;

  const cost = BALANCE.cost;
  const tags = verdict.tags;

  // ENERGY — code owns the sign; performing spends, resting restores.
  const active =
    tags.some((t) => (cost.energyTags as readonly string[]).includes(t)) ||
    verdict.pressure.energy === "down";
  const restful =
    tags.some((t) => (cost.restfulTags as readonly string[]).includes(t)) && !active;
  let energyDelta = 0;
  if (active) {
    let c = cost.energyPerIntensity * intensity;
    if (verdict.pressure.energy === "up") c *= cost.pressureRelief;
    else if (verdict.pressure.energy === "down") c *= cost.pressureAmplify;
    energyDelta = -c * showmanshipMult;
  } else if (restful) {
    energyDelta = cost.recoverEnergyPerIntensity * intensity;
  }

  // COMFORT — boundary restores; exposing/edgy content spends (low-comfort amplified).
  const boundary = verdict.setsBoundary || tags.includes("boundary-setting");
  const exposes =
    tags.some((t) => (cost.comfortTags as readonly string[]).includes(t)) ||
    verdict.pressure.comfort === "down";
  let comfortDelta = 0;
  if (boundary) {
    comfortDelta = BALANCE.recovery.boundaryComfort;
  } else if (exposes) {
    let c = cost.comfortPerIntensity * intensity;
    if (intensity >= BALANCE.readiness.comfortGateFrom) {
      c *= 1 + (BALANCE.readiness.comfortCostAmplifyLow - 1) * (1 - metrics.comfort / 100);
    }
    if (verdict.pressure.comfort === "up") c *= cost.pressureRelief;
    else if (verdict.pressure.comfort === "down") c *= cost.pressureAmplify;
    comfortDelta = -c * composureMult;
  }

  // Content freshness: a stale, repeated format gives less of a hype lift.
  const novelty = clamp(input.novelty ?? 1, 0, 1);
  let hypeDelta = pressureDelta(verdict.pressure.hype, 5, intensity) * mult.hype;
  if (hypeDelta > 0) hypeDelta *= novelty;

  const metricsPatch: Partial<Metrics> = {
    hype: metrics.hype + hypeDelta,
    energy: metrics.energy + energyDelta,
    mood: metrics.mood + pressureDelta(verdict.pressure.mood, 4, intensity),
    comfort: metrics.comfort + comfortDelta,
  };

  let earned = 0;
  let satWeightedHappy = 0;
  let comfortFromAudience = 0;
  let fitNumerator = 0;
  let popSum = 0;

  if (isLive) {
    for (const id of SEGMENT_IDS) {
      const def = SEGMENTS[id];
      const seg = audience[id];
      const base = verdict.appeal[id] ?? inferAppeal(def.likes, def.dislikes, verdict.tags);
      // Layer in the passive baseline appeal from gear/décor/niche/production
      // quality so investment literally shapes how content lands per segment.
      const appeal = clamp(base + (input.baselineAppeal?.[id] ?? 0), -3, 3);

      // Audience-fit accumulators: positive payoff only materializes against the
      // segments actually present that liked the action.
      fitNumerator += Math.max(0, appeal) * seg.population;
      popSum += seg.population;

      // Satisfaction drifts toward an appeal-driven target.
      const satTarget = clamp(50 + appeal * 14, 0, 100);
      seg.satisfaction = clamp(seg.satisfaction + (satTarget - seg.satisfaction) * 0.4, 0, 100);

      // Tips from satisfied heads.
      if (seg.satisfaction > 55 && seg.population > 0) {
        earned +=
          ((seg.satisfaction - 55) / 45) *
          def.tipFactor *
          seg.population *
          BALANCE.economy.tipConstant *
          mult.income;
      }

      // Comfort pressure from segment nature × engagement.
      comfortFromAudience += def.comfortFactor * seg.population * (seg.satisfaction / 100);

      // Followers grow from happy, active segments.
      if (seg.satisfaction > 55) {
        satWeightedHappy +=
          ((seg.satisfaction - 55) / 45) * def.growthFactor * seg.population;
      }
    }

    // Stalker satisfaction reacts to oversharing vs boundary-setting (population
    // itself is presence-driven, but happy stalkers stick / multiply via presence).
    if (verdict.setsBoundary) {
      audience.stalkers.satisfaction = clamp(audience.stalkers.satisfaction - 25, 0, 100);
    } else if (
      tierMax >= SEGMENTS.stalkers.minIntensity &&
      verdict.tags.some((t) => t === "vulnerable" || t === "suggestive" || t === "boundary-crossing")
    ) {
      audience.stalkers.satisfaction = clamp(audience.stalkers.satisfaction + 12, 0, 100);
    }

    // Readiness gates the positive payoff: how well the action fit the room,
    // plus escalation gates (comfort/energy/hype) for higher-intensity beats.
    const readiness = readinessFactor(verdict, metrics, fitNumerator, popSum);
    earned *= readiness;
    satWeightedHappy *= readiness;

    // Early monetization ramp: a tiny new audience barely tips, so the first
    // streams are lean and whales/subs are the real lever out of precarity.
    const monetizationRamp = Math.min(1, metrics.followers / BALANCE.economy.monetizationRampFollowers);
    earned *= monetizationRamp;

    // Stale content also dulls tips + follower growth.
    earned *= novelty;
    satWeightedHappy *= novelty;

    const reach =
      BALANCE.economy.reachBase +
      Math.min(BALANCE.economy.reachCap, metrics.followers * BALANCE.economy.reachPerFollower);
    const gainedFollowers = Math.max(
      0,
      Math.round(satWeightedHappy * BALANCE.economy.followerGrowth * reach),
    );

    metricsPatch.cash = metrics.cash + earned;
    metricsPatch.comfort = (metricsPatch.comfort ?? metrics.comfort) + comfortFromAudience;
    metricsPatch.followers = metrics.followers + gainedFollowers;

    const summary = buildSummary(earned, gainedFollowers, verdict);
    diag.group("resolver", `resolve "${truncate(verdict.narration, 36)}"`, () => {
      diag.info("resolver", "stat patch", roundPatch(metricsPatch));
      diag.info("economy", "tips/follows", {
        earned: round(earned),
        gainedFollowers,
        readiness: round(readiness),
      });
    });
    return { metricsPatch, audience, earned, gainedFollowers, summary, readiness };
  }

  diag.info("resolver", "resolve (offline)", roundPatch(metricsPatch));
  return { metricsPatch, audience, earned: 0, gainedFollowers: 0, summary: "", readiness: 1 };
}

/**
 * Compute the readiness multiplier for positive payoff. Audience fit always
 * applies (well-targeted content pays, poorly-targeted content doesn't); the
 * comfort/energy/hype gates only bite for escalation (intensity >= gate / 4),
 * so a new streamer who immediately goes spicy with no matching audience and
 * low comfort earns almost nothing, while a built-up one cashes in.
 */
function readinessFactor(
  verdict: ActionVerdict,
  metrics: Metrics,
  fitNumerator: number,
  popSum: number,
): number {
  const cfg = BALANCE.readiness;
  const intensity = verdict.intensity;

  // fit ~ average positive appeal across the present audience (0..3); normalize
  // so an average appeal of ~1.5 across the room counts as a full fit.
  const fit = popSum > 0 ? fitNumerator / popSum : 0;
  const fitNorm = clamp(fit / 1.5, 0, 1);
  let factor = (1 - cfg.fitWeight) + cfg.fitWeight * fitNorm;

  if (intensity >= cfg.comfortGateFrom) {
    // Comfort headroom gates escalation payoff.
    factor *= 0.4 + 0.6 * (metrics.comfort / 100);
    // Exhaustion shows on camera for demanding beats.
    if (metrics.energy < cfg.energyPenaltyBelow) {
      factor *= 0.5 + 0.5 * (metrics.energy / cfg.energyPenaltyBelow);
    }
  }
  // Big swings convert better when the room is already hot.
  if (intensity >= 4) {
    factor *= 1 + cfg.hypeBonusAt100 * (metrics.hype / 100);
  }

  return clamp(factor, 0, 1.5);
}

function inferAppeal(likes: string[], dislikes: string[], tags: string[]): number {
  let a = 0;
  for (const t of tags) {
    if (likes.includes(t)) a += 1;
    if (dislikes.includes(t)) a -= 1;
  }
  return clamp(a, -3, 3);
}

function cloneAudience(a: AudienceState): AudienceState {
  const out = {} as AudienceState;
  for (const id of SEGMENT_IDS) out[id] = { ...a[id] };
  return out;
}

function buildSummary(earned: number, follows: number, verdict: ActionVerdict): string {
  const bits: string[] = [];
  if (follows > 0) bits.push(`+${follows} followers`);
  if (earned > 0.5) bits.push(`$${earned.toFixed(0)} in tips`);
  if (verdict.setsBoundary) bits.push("boundary set");
  return bits.join(" · ");
}

function roundPatch(p: Partial<Metrics>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === "number") out[k] = round(v);
  return out;
}
function round(n: number): number {
  return Math.round(n * 10) / 10;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export { totalViewers };
