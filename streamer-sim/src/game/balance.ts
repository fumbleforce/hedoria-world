/**
 * BALANCE — the single home for every tunable gameplay constant.
 *
 * The golden rule of the codebase is "the LLM proposes flavour/classification;
 * code owns numbers". This module is where those numbers live, so the whole
 * economy/affinity/progression arc can be tuned in one place instead of hunting
 * magic numbers across resolver.ts / controller.ts / presence.ts / etc.
 *
 * Values here are starting points to be tuned by playtest — keep them grouped by
 * the system they drive. Nothing in here reads game state; it is pure data.
 */

import type { SegmentId } from "./segments";

/** Skill domains tracked by the mastery system (Phase 8). */
export type MasteryDomain = "showmanship" | "composure";

/** Relationship levels, as keys for the decay table. */
type AffinityLevelKey = "stranger" | "familiar" | "regular" | "friend" | "confidant";

/** How an affinity change was earned — governs weighting + cap behaviour. */
export type AffinitySource =
  | "chat"
  | "action"
  | "mention"
  | "dm"
  | "dmRepeat"
  | "tip"
  | "request"
  | "gift"
  | "visit"
  | "referral";

export const BALANCE = {
  affinity: {
    /** gainScale = clamp(1 - affinity/pivot, floor, 1) — higher tiers climb slower. */
    diminishingPivot: 115,
    diminishingFloor: 0.2,
    /** Max affinity a single character can gain per in-world day from soft sources. */
    dailySoftCap: 6,
    /** Base per-event weights (before diminishing + cap). */
    sources: {
      chat: 0.05, // just being in chat barely moves it
      action: 0.8, // per connection-point, appeal-weighted
      mention: 1.0, // targeted @handle bonus (live only)
      dmDaily: 4, // first DM exchange of the in-world day
      dmRepeat: 0.3, // same-day follow-ups
      tip: { perDollar: 0.05, max: 6 }, // reciprocal: genuine investment
      request: 3,
      gift: 2,
      visit: 3,
      referral: 6,
    },
    /** Sources counted against the per-day soft cap (everything else bypasses it). */
    softSources: ["chat", "action", "mention", "dmRepeat"] as AffinitySource[],
    /** Per-stream nth repeat of a connection-tag multiplies the gain by this^n. */
    repeatTagDecay: 0.5,
    /** Affinity lost per idle day, by current relationship level. */
    decayPerIdleDay: {
      confidant: 3,
      friend: 2,
      regular: 1.5,
      familiar: 1,
      stranger: 0.5,
    } as Record<AffinityLevelKey, number>,
    /** Days of neglect tolerated before decay kicks in. */
    decayGraceDays: 1,
  },

  economy: {
    tipConstant: 0.07, // was 0.12
    /** Early tips scale by min(1, followers / ramp) so a tiny audience earns little. */
    monetizationRampFollowers: 150,
    followerGrowth: 0.16, // was 0.18
    reachBase: 0.4,
    reachPerFollower: 1 / 500,
    reachCap: 1.8,
    rentBase: 20,
    /** Recurring utility bill: charged every N days for a flat amount. */
    utilityEveryDays: 7,
    utilityAmount: 18,
  },

  subs: {
    /** Average monthly value per subscriber (× income multiplier). */
    monthlyValue: 3.5,
    /** Recurring sub payout cadence, in in-world days. */
    cadenceDays: 30,
  },

  novelty: {
    drainPerRepeat: 0.18,
    recoverPerRest: 0.25,
    floor: 0.4,
  },

  niche: {
    spawnShift: 0.35,
    switchFollowerCost: 0.03,
    switchNoveltyHit: 0.4,
  },

  readiness: {
    /** Share of positive payoff governed by audience fit (rest is a baseline floor). */
    fitWeight: 0.7,
    /** Intensity at/above which comfort gates the payoff. */
    comfortGateFrom: 2,
    /** Boundary-push comfort cost is amplified up to this factor when comfort is low. */
    comfortCostAmplifyLow: 1.8,
    /** Extra conversion at full hype for big-swing moments. */
    hypeBonusAt100: 0.3,
    /** Below this energy, high-intensity actions underperform. */
    energyPenaltyBelow: 30,
    /** Extra per-beat leave probability per unit of dissatisfaction below 55. */
    leaveOnDislikeBoost: 0.06,
  },

  gear: {
    /** How strongly global production quality lifts appeal/viewer pull. */
    productionQualityToAppeal: 0.5,
  },

  mastery: {
    domains: ["showmanship", "composure"] as MasteryDomain[],
    /** XP gained per matching live action, scaled by intensity. */
    xpPerIntensity: 1.0,
    /** level = floor(sqrt(totalXp / levelCurve)). */
    levelCurve: 50,
    /** Personal-cost reduction per level in that domain. */
    efficiencyPerLevel: 0.04,
    /** A cost never drops below this fraction (never free). */
    efficiencyFloor: 0.5,
  },
} as const;

/** Action tags that build each mastery domain (Phase 8). */
export const MASTERY_TAGS: Record<MasteryDomain, string[]> = {
  showmanship: ["energetic", "skillful", "hype", "funny", "loud", "chaotic"],
  composure: [
    "flirty",
    "teasing",
    "suggestive",
    "bold",
    "vulnerable",
    "personal",
    "boundary-setting",
    "boundary-crossing",
  ],
};

/** Optional per-segment baseline appeal contributed by themed gear/decor. */
export type SegmentAppeal = Partial<Record<SegmentId, number>>;
