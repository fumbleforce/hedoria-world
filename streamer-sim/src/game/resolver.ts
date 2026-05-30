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
}

export interface ResolveResult {
  metricsPatch: Partial<Metrics>;
  audience: AudienceState;
  earned: number;
  gainedFollowers: number;
  summary: string;
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

  const metricsPatch: Partial<Metrics> = {
    hype: metrics.hype + pressureDelta(verdict.pressure.hype, 5, intensity) * mult.hype,
    energy: metrics.energy + pressureDelta(verdict.pressure.energy, 4, intensity),
    mood: metrics.mood + pressureDelta(verdict.pressure.mood, 4, intensity),
    comfort: metrics.comfort + pressureDelta(verdict.pressure.comfort, 5, intensity),
  };

  let earned = 0;
  let satWeightedHappy = 0;
  let comfortFromAudience = 0;

  if (isLive) {
    for (const id of SEGMENT_IDS) {
      const def = SEGMENTS[id];
      const seg = audience[id];
      const appeal = verdict.appeal[id] ?? inferAppeal(def.likes, def.dislikes, verdict.tags);

      // Satisfaction drifts toward an appeal-driven target.
      const satTarget = clamp(50 + appeal * 14, 0, 100);
      seg.satisfaction = clamp(seg.satisfaction + (satTarget - seg.satisfaction) * 0.4, 0, 100);

      // Tips from satisfied heads.
      if (seg.satisfaction > 55 && seg.population > 0) {
        earned +=
          ((seg.satisfaction - 55) / 45) * def.tipFactor * seg.population * 0.12 * mult.income;
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

    const reach = 0.4 + Math.min(1.8, metrics.followers / 500);
    const gainedFollowers = Math.max(0, Math.round(satWeightedHappy * 0.18 * reach));

    metricsPatch.cash = metrics.cash + earned;
    metricsPatch.comfort = (metricsPatch.comfort ?? metrics.comfort) + comfortFromAudience;
    metricsPatch.followers = metrics.followers + gainedFollowers;

    const summary = buildSummary(earned, gainedFollowers, verdict);
    diag.group("resolver", `resolve "${truncate(verdict.narration, 36)}"`, () => {
      diag.info("resolver", "stat patch", roundPatch(metricsPatch));
      diag.info("economy", "tips/follows", { earned: round(earned), gainedFollowers });
    });
    return { metricsPatch, audience, earned, gainedFollowers, summary };
  }

  diag.info("resolver", "resolve (offline)", roundPatch(metricsPatch));
  return { metricsPatch, audience, earned: 0, gainedFollowers: 0, summary: "" };
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
