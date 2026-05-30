/**
 * Named viewer characters. Each is seeded from an archetype (deterministic,
 * offline-safe) and optionally enriched by the LLM. They go online/offline over
 * the night, accrue a relationship and a one-line condensed memory, and can be
 * talked to directly.
 */

import { ARCHETYPE_BY_ID, ARCHETYPES, type Archetype } from "./archetypes";
import { pick, randInt, uid } from "../rng/rng";

export type RelationshipLevel =
  | "stranger"
  | "familiar"
  | "regular"
  | "friend"
  | "confidant";

export interface CharacterSheet {
  id: string;
  /** Chat handle, e.g. "midnight_mara". */
  handle: string;
  /** Display name once known, else "". */
  displayName: string;
  archetypeId: string;
  /** Free-form vibe/personality (seeded, LLM-enriched). */
  vibe: string;
  /** What they want from the streamer. */
  wants: string;
  /** 0-100 relationship score; level derived from it. */
  affinity: number;
  /** Condensed running memory of your interactions (one or two lines). */
  memory: string;
  /** Lifetime tips in dollars. */
  tipped: number;
  /** Messages they've sent. */
  messageCount: number;
  /** Currently watching? */
  online: boolean;
  /** Has the player opened their sheet / talked directly? */
  known: boolean;
  isMod: boolean;
  /** Stalker escalation 0..3 (0 = not a stalker). */
  threat: number;
  firstSeenClock: number;
  lastSeenClock: number;

  /** Relationship-milestone ids already fired, so a beat never repeats. */
  milestones: string[];
  /** Day the stalker threat last advanced; -1 = never. Paces the arc to ≤1/day. */
  escalationDay: number;
  /** Distinct stream-days this viewer has shown up for. */
  streamsAttended: number;
  /** metrics.day of the last stream they appeared in (0 = never). */
  lastStreamDay: number;
  /** Consecutive stream-days attended. */
  attendanceStreak: number;
  /** LLM-authored richer bio ("" until generated). */
  backstory: string;
  /** LLM-authored quirks ("" until generated). */
  quirks: string;
  /** A portrait blob exists for this character in IndexedDB. */
  hasPortrait: boolean;
  /** Id of the regular whose word-of-mouth "brought" them, if any. */
  referredBy?: string;
}

export type Roster = Record<string, CharacterSheet>;

export function relationshipLevel(affinity: number): RelationshipLevel {
  if (affinity >= 85) return "confidant";
  if (affinity >= 60) return "friend";
  if (affinity >= 35) return "regular";
  if (affinity >= 15) return "familiar";
  return "stranger";
}

const HANDLE_SUFFIX = ["", "", "_", "_x", "99", "_xx", "23", "_irl", "ttv", "_07", "xo"];

export function makeHandle(arch: Archetype): string {
  const a = pick(arch.nameParts);
  const b = pick(["", "_", ...arch.nameParts.filter((p) => p !== a)]);
  const suffix = pick(HANDLE_SUFFIX);
  const core = b ? `${a}${b === "_" ? "_" : "_" + b}` : a;
  return `${core}${suffix}`.slice(0, 22).toLowerCase();
}

/** Seed a fresh character from an archetype (no LLM). */
export function seedCharacter(arch: Archetype, clock: number): CharacterSheet {
  return {
    id: uid("char"),
    handle: makeHandle(arch),
    displayName: "",
    archetypeId: arch.id,
    vibe: arch.blurb,
    wants: wantsForArchetype(arch),
    affinity: randInt(2, 12),
    memory: "",
    tipped: 0,
    messageCount: 0,
    online: true,
    known: false,
    isMod: arch.id === "mod",
    threat: arch.segment === "stalkers" ? 1 : 0,
    firstSeenClock: clock,
    lastSeenClock: clock,
    milestones: [],
    escalationDay: -1,
    streamsAttended: 0,
    lastStreamDay: 0,
    attendanceStreak: 0,
    backstory: "",
    quirks: "",
    hasPortrait: false,
  };
}

/**
 * Fill in any fields a rehydrated sheet is missing. Saves from before these
 * fields existed lack them; this keeps `.push`/numeric math from hitting
 * `undefined`. No save-version bump needed — defaults are inert.
 */
export function normalizeCharacter(c: CharacterSheet): CharacterSheet {
  return {
    ...c,
    milestones: c.milestones ?? [],
    escalationDay: c.escalationDay ?? -1,
    streamsAttended: c.streamsAttended ?? 0,
    lastStreamDay: c.lastStreamDay ?? 0,
    attendanceStreak: c.attendanceStreak ?? 0,
    backstory: c.backstory ?? "",
    quirks: c.quirks ?? "",
    hasPortrait: c.hasPortrait ?? false,
  };
}

function wantsForArchetype(arch: Archetype): string {
  switch (arch.segment) {
    case "hype": return "big entertaining moments to react to";
    case "lonely": return "to feel personally seen and remembered";
    case "simps": return "flirty attention and banter";
    case "whales": return "to be acknowledged by name for their generosity";
    case "trolls": return "a reaction — any reaction";
    case "cozy": return "a calm, kind place to hang out";
    case "stalkers": return "to get closer than is appropriate";
  }
}

/** Pick an archetype weighted by which are allowed at this intensity. */
export function rollArchetype(intensity: number, weightStalkers = false): Archetype {
  const pool = ARCHETYPES.filter((a) => a.minIntensity <= intensity);
  if (weightStalkers) {
    const stalkers = pool.filter((a) => a.segment === "stalkers");
    if (stalkers.length && Math.random() < 0.6) return pick(stalkers);
  }
  return pick(pool);
}

export function describeRelationship(c: CharacterSheet): string {
  const lvl = relationshipLevel(c.affinity);
  const arch = ARCHETYPE_BY_ID[c.archetypeId];
  return `${lvl} · ${arch?.label ?? "viewer"}`;
}

/** Avatar glyph by archetype segment (used until/if real portraits exist). */
export function avatarFor(c: CharacterSheet): string {
  if (c.threat >= 2) return "🩸";
  if (c.isMod) return "🛡️";
  const seg = ARCHETYPE_BY_ID[c.archetypeId]?.segment;
  switch (seg) {
    case "hype": return "🔥";
    case "lonely": return "🫶";
    case "simps": return "😍";
    case "whales": return "💎";
    case "trolls": return "😈";
    case "cozy": return "🌙";
    case "stalkers": return "👁️";
    default: return "🙂";
  }
}
