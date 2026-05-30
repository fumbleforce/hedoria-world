/**
 * Viewer-segment model — the spine of the game.
 *
 * Instead of one `viewers` blob, the audience is a set of archetype segments,
 * each with a population (how many are watching) and satisfaction (0-100, how
 * happy they are right now). Every action emits per-segment appeal; satisfied
 * segments grow & tip, unhappy ones shrink & leave. Follower count, income,
 * chat flavor, comfort risk, and the stalker arc all emerge from this one model.
 */

export type SegmentId =
  | "hype"
  | "lonely"
  | "simps"
  | "trolls"
  | "cozy"
  | "whales"
  | "stalkers";

export interface SegmentDef {
  id: SegmentId;
  label: string;
  blurb: string;
  /** Loves these action tags (satisfaction up). */
  likes: string[];
  /** Hates these (satisfaction down). */
  dislikes: string[];
  /** Relative tip generosity per satisfied head. */
  tipFactor: number;
  /** How much this segment drives raw follower growth when happy. */
  growthFactor: number;
  /** Content intensity at/above which this segment is active at all. */
  minIntensity: number;
  /** Per-point-of-satisfaction comfort pressure on the streamer (negative = drains). */
  comfortFactor: number;
}

export const SEGMENTS: Record<SegmentId, SegmentDef> = {
  hype: {
    id: "hype",
    label: "Hype Beasts",
    blurb: "Here for energy, skill, and big moments.",
    likes: ["energetic", "funny", "skillful", "bold", "hype"],
    dislikes: ["boring", "low-energy"],
    tipFactor: 0.8,
    growthFactor: 1.3,
    minIntensity: 0,
    comfortFactor: 0,
  },
  lonely: {
    id: "lonely",
    label: "Lonely Hearts",
    blurb: "Parasocial. Crave personal attention and vulnerability.",
    likes: ["personal", "vulnerable", "kind", "wholesome", "attention"],
    dislikes: ["dismissive", "cold"],
    tipFactor: 1.1,
    growthFactor: 1.0,
    minIntensity: 0,
    comfortFactor: -0.04,
  },
  simps: {
    id: "simps",
    label: "Simps",
    blurb: "Smitten. Reward flirtation and boldness, drain comfort.",
    likes: ["flirty", "bold", "teasing", "personal", "suggestive"],
    dislikes: ["prudish", "dismissive"],
    tipFactor: 1.6,
    growthFactor: 1.1,
    minIntensity: 1,
    comfortFactor: -0.06,
  },
  trolls: {
    id: "trolls",
    label: "Trolls",
    blurb: "Want reactions and chaos. Ignore them and they wilt.",
    likes: ["chaotic", "edgy", "reactive", "drama"],
    dislikes: ["ignored", "wholesome", "calm"],
    tipFactor: 0.2,
    growthFactor: 0.6,
    minIntensity: 0,
    comfortFactor: -0.05,
  },
  cozy: {
    id: "cozy",
    label: "Cozy Crowd",
    blurb: "Chill vibes only. Edginess sends them out quietly.",
    likes: ["chill", "kind", "wholesome", "cozy", "calm"],
    dislikes: ["edgy", "chaotic", "suggestive", "loud"],
    tipFactor: 0.9,
    growthFactor: 1.0,
    minIntensity: 0,
    comfortFactor: 0.02,
  },
  whales: {
    id: "whales",
    label: "Whales",
    blurb: "Big spenders. Crave acknowledgment and exclusivity.",
    likes: ["personal", "exclusive", "grateful", "bold"],
    dislikes: ["dismissive", "generic"],
    tipFactor: 5.0,
    growthFactor: 0.4,
    minIntensity: 0,
    comfortFactor: -0.02,
  },
  stalkers: {
    id: "stalkers",
    label: "Stalkers",
    blurb: "The dark side of parasocial. Grows from oversharing; ignores boundaries.",
    likes: ["personal", "vulnerable", "suggestive", "boundary-crossing"],
    dislikes: ["boundary-setting", "blocked"],
    tipFactor: 1.2,
    growthFactor: 0.5,
    minIntensity: 1,
    comfortFactor: -0.18,
  },
};

export const SEGMENT_IDS = Object.keys(SEGMENTS) as SegmentId[];

export interface SegmentState {
  /** Headcount currently watching from this segment. */
  population: number;
  /** 0-100 current satisfaction. */
  satisfaction: number;
}

export type AudienceState = Record<SegmentId, SegmentState>;

export function initialAudience(): AudienceState {
  return {
    hype: { population: 2, satisfaction: 60 },
    lonely: { population: 3, satisfaction: 60 },
    simps: { population: 0, satisfaction: 50 },
    trolls: { population: 1, satisfaction: 40 },
    cozy: { population: 4, satisfaction: 65 },
    whales: { population: 0, satisfaction: 50 },
    stalkers: { population: 0, satisfaction: 50 },
  };
}

export function totalViewers(a: AudienceState): number {
  return SEGMENT_IDS.reduce((sum, id) => sum + Math.max(0, a[id].population), 0);
}
