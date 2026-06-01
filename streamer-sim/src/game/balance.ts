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
  | "referral"
  | "event";

export const BALANCE = {
  watch: {
    /** Max minutes affinity adds to each side of a viewer's watch window (at 100 bond). */
    affinityExtendMax: 90,
    /** Return probability multiplier when outside the extended window. */
    outsideWindowMult: 0.12,
    /** Leave probability boost when outside their window. */
    outsideLeaveBoost: 0.14,
  },
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
      event: 2,
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

  request: {
    /** Max bonus affinity the fulfillment judge may add on top of the base payout. */
    fulfillmentBonusMax: 2,
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
    /** Passive discovery while live: viewers × happyNorm × rate × reach per beat. */
    passiveFollowerRate: 0.012,
  },

  subs: {
    /** Average monthly value per subscriber (× income multiplier). */
    monthlyValue: 3.5,
    /** Recurring sub payout cadence, in in-world days. */
    cadenceDays: 30,
    /** Daily sub conversion at sleep: fraction of followers. */
    subDailyRate: 0.002,
    /** Per friend+ regular per day. */
    subRegularBonus: 0.15,
    /** Fraction of subs that churn per day. */
    subChurnRate: 0.01,
    /** Typical live beats per active day — spreads daily sub gain across the stream. */
    liveBeatsPerDay: 48,
  },

  needs: {
    /** ~5h stream should push bladder toward warn; hunger/hygiene creep over a long day. */
    drainPerMin: { hunger: 0.08, bladder: 0.21, hygiene: 0.06 },
    warnBelow: 35,
    criticalBelow: 15,
    strainFloor: 0.6,
    criticalComfortDrainPerBeat: 1.5,
    criticalEnergyDrainPerBeat: 1.0,
    nagCooldownBeats: 6,
    cueHornyMedium: 40,
    cueHornyHigh: 70,
    cueHungerBelow: 30,
    cueBladderBelow: 30,
    cueHygieneBelow: 25,
  },

  horny: {
    buildPerIntensity: 3,
    buildPerSpicyChat: 0.8,
    sleepHalve: 0.5,
    reliefMasturbation: 65,
    /** Max fraction intimate comfort cost is reduced at horny 100 (0 = off). */
    comfortEaseMax: 0.2,
    /** Scene relief scales with intensity (min..max reduction). */
    reliefSceneMin: 25,
    reliefSceneMax: 55,
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

  /** Code-owned personal stat costs — the LLM only nudges via pressure up/down. */
  cost: {
    /** Active performance always spends energy (× intensity). */
    energyPerIntensity: 2.2,
    /** Intimate/edgy beats always spend comfort (× intensity). */
    comfortPerIntensity: 1.8,
    energyTags: [
      "energetic",
      "skillful",
      "hype",
      "loud",
      "chaotic",
      "funny",
      "drama",
      "bold",
    ] as const,
    comfortTags: [
      "flirty",
      "teasing",
      "suggestive",
      "bold",
      "vulnerable",
      "personal",
      "boundary-crossing",
    ] as const,
    restfulTags: ["chill", "cozy", "calm", "low-energy", "boring"] as const,
    /** A deliberately chill beat gives a little energy back (× intensity). */
    recoverEnergyPerIntensity: 1.2,
    /** LLM pressure "down" => deeper cost. */
    pressureAmplify: 1.5,
    /** LLM pressure "up" => softened cost. */
    pressureRelief: 0.5,
  },

  /** Effortful recovery — nights no longer fully top you off. */
  recovery: {
    /** Nightly energy restored, capped at 100 (was hard reset to 100). */
    sleepEnergy: 70,
    sleepComfort: 5,
    /** Small overnight bumps — needs still drain for the full sleep window in sleep(). */
    sleepHygiene: 8,
    sleepHunger: -5,
    /** Asserting a boundary restores comfort. */
    boundaryComfort: 6,
  },

  events: {
    /** Minimum live beats between director-authored scenes. */
    minBeatsBetweenLive: 4,
    /** Minimum in-world days between offline director scenes. */
    minDaysBetweenOffline: 1,
    /** Max queued follow-up seeds at once. */
    maxPendingFollowups: 5,
    followupDaysMin: 1,
    followupDaysMax: 14,
    /** Per-effect metric delta clamp (hype/energy/comfort/needs). */
    metricDeltaBand: 25,
    cashMin: -500,
    cashMax: 500,
    followersMin: -150,
    followersMax: 400,
    subscribersMin: -20,
    subscribersMax: 40,
    affinityMin: -12,
    affinityMax: 12,
    threatMin: -3,
    threatMax: 3,
    masteryXpMin: 1,
    masteryXpMax: 30,
    /** Max raid multiplier (× base followers/hype bump). */
    raidSizeMax: 3,
    onlineCap: 16,
    /** Per-beat scene judge clamps (smaller than resolve). */
    beatMetricBand: 12,
    beatFollowersMax: 40,
    beatCashMax: 200,
    /** In-world minutes that elapse per scene beat — far slower than a normal
     * turn (TIME_COST.continue = 15) so an event can breathe. */
    beatMinutes: 2,
  },

  mastery: {
    domains: ["showmanship", "composure"] as MasteryDomain[],
    /** XP gained per matching live action, scaled by intensity. */
    xpPerIntensity: 1.5,
    /** level = floor(sqrt(totalXp / levelCurve)). */
    levelCurve: 24,
    /** Personal-cost reduction per level in that domain. */
    efficiencyPerLevel: 0.04,
    /** A cost never drops below this fraction (never free). */
    efficiencyFloor: 0.5,
  },

  /** Live chat volume — hype is the main engagement driver; viewers add a nudge. */
  chat: {
    actionMin: 1,
    actionMax: 12,
    /** Burst ≈ (hype/100)^exp × scale + viewers/div (then clamped). */
    actionHypeExp: 1.5,
    actionHypeScale: 9,
    actionViewerDiv: 20,
    /** Continue burst = action burst × mult (clamped separately). */
    continueMult: 0.5,
    continueMin: 1,
    continueMax: 7,
    /** Ambient filler between beats — off when hype is below this. */
    ambientMinHype: 12,
    ambientMinTicks: 0,
    ambientMaxTicks: 8,
    ambientTicksAt100: 7,
    /** Ms between ambient ticks — fast when hyped, sluggish when flat. */
    ambientGapMinMs: 450,
    ambientGapMaxMs: 1600,
    /** Per ambient tick ≈ action burst × this (clamped 1..3). */
    ambientTickMult: 0.35,
    ambientTickMax: 3,
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

/** Gameplay difficulty — tunes economy, bills, and survival pressure (not content tone). */
export type DifficultyLevel = "easy" | "normal" | "hard";

export type BalanceConfig = typeof BALANCE;

export type DifficultyOption = {
  id: DifficultyLevel;
  label: string;
  blurb: string;
};

export const DIFFICULTY_LEVELS: DifficultyOption[] = [
  { id: "easy", label: "Easy", blurb: "More income, lighter bills, gentler needs." },
  { id: "normal", label: "Normal", blurb: "The default Limelight experience." },
  { id: "hard", label: "Hard", blurb: "Tighter money, faster burnout, slower growth." },
];

type BalancePatch = {
  economy?: {
    tipConstant?: number;
    followerGrowth?: number;
    passiveFollowerRate?: number;
    rentBase?: number;
    utilityAmount?: number;
    monetizationRampFollowers?: number;
  };
  subs?: {
    subDailyRate?: number;
    subChurnRate?: number;
  };
  needs?: {
    drainPerMin?: Partial<Record<"hunger" | "bladder" | "hygiene", number>>;
    criticalComfortDrainPerBeat?: number;
    criticalEnergyDrainPerBeat?: number;
  };
  recovery?: {
    sleepEnergy?: number;
    sleepComfort?: number;
  };
  affinity?: {
    decayPerIdleDay?: Partial<Record<AffinityLevelKey, number>>;
  };
};

const DIFFICULTY_PATCHES: Record<Exclude<DifficultyLevel, "normal">, BalancePatch> = {
  easy: {
    economy: {
      tipConstant: 0.09,
      followerGrowth: 0.2,
      passiveFollowerRate: 0.016,
      rentBase: 16,
      utilityAmount: 14,
      monetizationRampFollowers: 120,
    },
    subs: { subDailyRate: 0.0026, subChurnRate: 0.008 },
    needs: {
      drainPerMin: { hunger: 0.06, bladder: 0.17, hygiene: 0.05 },
      criticalComfortDrainPerBeat: 1.2,
      criticalEnergyDrainPerBeat: 0.8,
    },
    recovery: { sleepEnergy: 80, sleepComfort: 8 },
    affinity: {
      decayPerIdleDay: { confidant: 2.4, friend: 1.6, regular: 1.2, familiar: 0.8, stranger: 0.4 },
    },
  },
  hard: {
    economy: {
      tipConstant: 0.055,
      followerGrowth: 0.12,
      passiveFollowerRate: 0.009,
      rentBase: 24,
      utilityAmount: 22,
      monetizationRampFollowers: 180,
    },
    subs: { subDailyRate: 0.0015, subChurnRate: 0.013 },
    needs: {
      drainPerMin: { hunger: 0.1, bladder: 0.25, hygiene: 0.07 },
      criticalComfortDrainPerBeat: 1.8,
      criticalEnergyDrainPerBeat: 1.2,
    },
    recovery: { sleepEnergy: 58, sleepComfort: 3 },
    affinity: {
      decayPerIdleDay: { confidant: 3.6, friend: 2.4, regular: 1.8, familiar: 1.2, stranger: 0.6 },
    },
  },
};

const STARTING_METRICS: Record<DifficultyLevel, { cash: number; followers: number }> = {
  easy: { cash: 550, followers: 80 },
  normal: { cash: 250, followers: 35 },
  hard: { cash: 90, followers: 10 },
};

function mergeBalance(base: BalanceConfig, patch: BalancePatch): BalanceConfig {
  return {
    ...base,
    economy: { ...base.economy, ...patch.economy },
    subs: { ...base.subs, ...patch.subs },
    needs: {
      ...base.needs,
      ...patch.needs,
      drainPerMin: { ...base.needs.drainPerMin, ...patch.needs?.drainPerMin },
    },
    recovery: { ...base.recovery, ...patch.recovery },
    affinity: {
      ...base.affinity,
      ...patch.affinity,
      decayPerIdleDay: { ...base.affinity.decayPerIdleDay, ...patch.affinity?.decayPerIdleDay },
    },
  } as BalanceConfig;
}

/** Active balance preset for the chosen difficulty. Normal returns the baseline `BALANCE`. */
export function getBalance(level: DifficultyLevel = "normal"): BalanceConfig {
  if (level === "normal") return BALANCE;
  return mergeBalance(BALANCE, DIFFICULTY_PATCHES[level]);
}

/** Starting cash and followers for a new game at the given difficulty. */
export function startingMetrics(level: DifficultyLevel = "normal"): { cash: number; followers: number } {
  return STARTING_METRICS[level];
}
