/**
 * Named viewer characters. Each is seeded from an archetype (deterministic,
 * offline-safe) and optionally enriched by the LLM. They go online/offline over
 * the night, accrue a relationship and interaction memory, and can be talked to
 * directly.
 */

import { ARCHETYPE_BY_ID, ARCHETYPES, type Archetype } from "./archetypes";
import { pick, randInt, uid } from "../rng/rng";
import { isInMinuteWindow, dayPhase } from "./time";
import { BALANCE } from "./balance";

export type RelationshipLevel =
  | "stranger"
  | "familiar"
  | "regular"
  | "friend"
  | "confidant";

export type RelationshipType =
  | "none"
  | "romantic"
  | "sexual"
  | "dominant"
  | "submissive"
  | "married";

export type CharacterGender = "female" | "male" | "nonbinary";

export interface Motive {
  surface: string;
  need: string;
  fear: string;
  boundary: string;
}

export interface BackstoryLayer {
  id: string;
  /** e.g. "familiar" | "regular" | "threat-2" | "seed" */
  trigger: string;
  text: string;
}

export interface CharLogEntry {
  ts: number;
  day: number;
  kind: string;
  text: string;
}

/** Per-instance personality modifiers rolled at seed time. */
export interface TraitModifiers {
  /** Short trait label, e.g. "anxious", "bold". */
  trait: string;
  /** 1–3 intensity of this instance. */
  intensity: number;
  /** Stalker fixation axis — what they obsess over (stalkers only). */
  fixation?: string;
  /** Speech tic injected into mock/LLM voice. */
  speechTic: string;
}

export interface RevealedSheet {
  displayName: string | null;
  vibe: string | null;
  motiveSurface: string | null;
  backstoryLayers: BackstoryLayer[];
  quirks: string | null;
  threat: number | null;
  memory: string | null;
  messages: number | null;
  tipped: number | null;
  affinity: number | null;
  attendance: string | null;
  age: number | null;
  occupation: string | null;
}

export interface CharacterSheet {
  id: string;
  /** Chat handle, e.g. "midnight_mara". */
  handle: string;
  /** Display name once known, else "". */
  displayName: string;
  archetypeId: string;
  gender: CharacterGender;
  /** Approximate age in years. */
  age: number;
  /** Day job / life role — seeded per archetype. */
  occupation: string;
  /** Free-form vibe/personality (seeded, LLM-enriched). */
  vibe: string;
  /** What they want from the streamer (legacy alias for motive.surface). */
  wants: string;
  motive: Motive;
  /** Per-instance trait modifiers. */
  traits: TraitModifiers;
  /** Usual watch window start (minutes since midnight). */
  watchStart: number;
  /** Usual watch window end (minutes since midnight; may wrap past midnight). */
  watchEnd: number;
  /** 0-100 relationship score; level derived from it. */
  affinity: number;
  /** Explicit relationship label used for in-person progression. */
  relationship: RelationshipType;
  /** Condensed running memory of your interactions. */
  memory: string;
  /** Append-only interaction history (capped). */
  interactionLog: CharLogEntry[];
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
  /** metrics.day of the last in-person visit; -1 = never. Gates repeat meetups. */
  lastVisitDay: number;
  /** Distinct stream-days this viewer has shown up for. */
  streamsAttended: number;
  /** metrics.day of the last stream they appeared in (0 = never). */
  lastStreamDay: number;
  /** Consecutive stream-days attended. */
  attendanceStreak: number;
  /** Ordered backstory fragments unlocked over time. */
  backstoryLayers: BackstoryLayer[];
  /** LLM-authored richer bio — concatenation of layers for prompt back-compat. */
  backstory: string;
  /** LLM-authored quirks ("" until generated). */
  quirks: string;
  /** A portrait blob exists for this character in IndexedDB. */
  hasPortrait: boolean;
  /** A full-body T-pose reference blob exists for this character in IndexedDB. */
  hasBody: boolean;
  /** Id of the regular whose word-of-mouth "brought" them, if any. */
  referredBy?: string;

  // ---- affinity ledger bookkeeping (see balance.ts / relationships.applyAffinity) ----
  /** In-world day the daily soft-cap budget belongs to (-1 = none yet). */
  affinityDay: number;
  /** Soft-source affinity already accrued on `affinityDay`. */
  affinityGainedToday: number;
  /** Last in-world day a DM granted the real (once-per-day) bump (-1 = never). */
  lastDmAffinityDay: number;
  /** Last in-world day of any meaningful interaction (gates decay; -1 = never). */
  lastInteractionDay: number;
}

export type Roster = Record<string, CharacterSheet>;

const INTERACTION_LOG_CAP = 40;

export function relationshipLevel(affinity: number): RelationshipLevel {
  if (affinity >= 85) return "confidant";
  if (affinity >= 60) return "friend";
  if (affinity >= 35) return "regular";
  if (affinity >= 15) return "familiar";
  return "stranger";
}

export function pronouns(gender: CharacterGender): { subj: string; obj: string; poss: string } {
  switch (gender) {
    case "female": return { subj: "she", obj: "her", poss: "her" };
    case "male": return { subj: "he", obj: "him", poss: "his" };
    default: return { subj: "they", obj: "them", poss: "their" };
  }
}

/** Concatenate layers into the legacy `backstory` string for prompts. */
export function syncBackstoryString(layers: BackstoryLayer[]): string {
  return layers.map((l) => l.text).filter(Boolean).join(" ");
}

export function hasBackstoryLayer(c: CharacterSheet, trigger: string): boolean {
  return c.backstoryLayers.some((l) => l.trigger === trigger);
}

/** Append a capped interaction entry. Returns the new log array. */
export function appendInteraction(
  log: CharLogEntry[],
  entry: Omit<CharLogEntry, "ts"> & { ts?: number },
): CharLogEntry[] {
  const next = [...log, { ts: entry.ts ?? Date.now(), day: entry.day, kind: entry.kind, text: entry.text }];
  return next.length > INTERACTION_LOG_CAP ? next.slice(-INTERACTION_LOG_CAP) : next;
}

/** What the player is allowed to see based on relationship + interaction. */
export function revealedSheet(c: CharacterSheet): RevealedSheet {
  const lvl = relationshipLevel(c.affinity);
  const interacted = c.known || c.messageCount > 0 || c.interactionLog.length > 0;

  const unlockedTriggers = new Set<string>();
  if (interacted) unlockedTriggers.add("seed");
  if (lvl !== "stranger" || c.messageCount >= 3) unlockedTriggers.add("familiar");
  if (c.displayName) unlockedTriggers.add("regular");
  if (lvl === "friend" || lvl === "confidant") {
    unlockedTriggers.add("friend");
    unlockedTriggers.add("regular");
    unlockedTriggers.add("familiar");
  }
  if (lvl === "confidant") unlockedTriggers.add("confidant");
  for (let t = 1; t <= c.threat; t += 1) unlockedTriggers.add(`threat-${t}`);

  const visibleLayers = c.backstoryLayers.filter((l) => unlockedTriggers.has(l.trigger));

  return {
    displayName: c.displayName || null,
    vibe: (interacted || lvl !== "stranger") ? c.vibe : null,
    motiveSurface: (lvl !== "stranger" || c.messageCount >= 2) ? c.motive.surface : null,
    backstoryLayers: visibleLayers,
    quirks: (lvl === "friend" || lvl === "confidant" || c.known) ? (c.quirks || null) : null,
    threat: c.threat >= 1 ? c.threat : null,
    memory: interacted ? (c.memory || null) : null,
    messages: interacted ? c.messageCount : null,
    tipped: (c.tipped > 0 || lvl !== "stranger") ? c.tipped : null,
    affinity: interacted ? c.affinity : null,
    attendance: c.attendanceStreak >= 2 ? `${c.attendanceStreak} streams running (${c.streamsAttended} total)` : null,
    age: (lvl !== "stranger" || c.messageCount >= 3) ? c.age : null,
    occupation: (c.displayName || lvl === "regular" || lvl === "friend" || lvl === "confidant") ? c.occupation : null,
  };
}

// ---- handle generation -------------------------------------------------------

const HANDLE_BANK = [
  "fox", "owl", "mint", "neon", "pixel", "retro", "vibe", "mood", "byte", "nova",
  "echo", "frost", "ember", "dusk", "dawn", "star", "moon", "sun", "rain", "cloud",
  "wolf", "bear", "cat", "bee", "frog", "duck", "fish", "bird", "bat", "ant",
  "cool", "warm", "fast", "slow", "tiny", "mega", "ultra", "mini", "max", "pro",
  "gg", "afk", "irl", "ttv", "yt", "og", "alt", "main", "sub", "mod",
  "tea", "coffee", "pizza", "taco", "sushi", "ramen", "cake", "cookie", "snack", "chip",
  "code", "hack", "bug", "lag", "ping", "fps", "kd", "win", "loss", "draw",
];

const HANDLE_SUFFIX = ["", "", "_", "_x", "99", "_xx", "23", "_irl", "ttv", "_07", "xo", "420", "777", "_tv"];

function joinHandle(parts: string[], pattern: number): string {
  const [a, b, c] = parts;
  switch (pattern % 5) {
    case 0: return `${a}${b ? "_" + b : ""}`;
    case 1: return `${a}${b ?? ""}`;
    case 2: return `${a}${randInt(10, 9999)}`;
    case 3: return `x${a}x${b ?? ""}x`;
    case 4: return `${a}${b ? b.slice(0, 3) : ""}${randInt(1, 99)}`;
    default: return a;
  }
}

/** Build a unique lowercase handle from archetype flavour + shared bank. */
export function makeHandle(arch: Archetype, taken: Set<string> = new Set()): string {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const a = pick(arch.nameParts);
    const b = pick([...arch.nameParts.filter((p) => p !== a), ...pickN(HANDLE_BANK, 3)]);
    const extra = chance(0.4) ? pick(HANDLE_BANK) : "";
    const parts = [a, b, extra].filter(Boolean);
    const core = joinHandle(parts, attempt);
    const suffix = pick(HANDLE_SUFFIX);
    const handle = `${core}${suffix}`.slice(0, 22).toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (handle.length >= 3 && !taken.has(handle)) return handle;
  }
  return `viewer${randInt(10000, 99999)}`;
}

function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i += 1) out.push(pick(copy));
  return out;
}

function chance(p: number): boolean {
  return Math.random() < p;
}

/** Collect all handles from a roster for de-duplication. */
export function rosterHandles(roster: Roster): Set<string> {
  return new Set(Object.values(roster).map((c) => c.handle.toLowerCase()));
}

// ---- gender / traits / motives -----------------------------------------------

const TRAIT_POOL = ["anxious", "bold", "shy", "witty", "intense", "chill", "needy", "guarded", "warm", "sarcastic"];
const SPEECH_TICS = ["...", "lol", "tbh", "ngl", "fr", "honestly", "anyway", "idk", "haha", "👀"];
const STALKER_FIXATIONS = [
  "your schedule and routines",
  "what you wear on stream",
  "where you live",
  "being your only close viewer",
  "meeting you in person",
  "your offline life details",
  "photos you've posted anywhere",
  "your real name and identity",
];

/** Realistic gender mix, optionally skewed per segment. */
export function rollGender(arch: Archetype): CharacterGender {
  const seg = arch.segment;
  const r = Math.random();
  if (seg === "stalkers" || seg === "simps" || seg === "whales") {
    if (r < 0.72) return "male";
    if (r < 0.88) return "female";
    return "nonbinary";
  }
  if (seg === "cozy" || seg === "lonely") {
    if (r < 0.52) return "female";
    if (r < 0.82) return "male";
    return "nonbinary";
  }
  if (r < 0.45) return "female";
  if (r < 0.85) return "male";
  return "nonbinary";
}

export function rollTraitModifiers(arch: Archetype): TraitModifiers {
  const fixation = arch.segment === "stalkers"
    ? pick(STALKER_FIXATIONS)
    : undefined;
  return {
    trait: pick(TRAIT_POOL),
    intensity: randInt(1, 3),
    fixation,
    speechTic: pick(SPEECH_TICS),
  };
}

const MOTIVE_SURFACES: Record<string, string[]> = {
  hype: ["big entertaining moments to react to", "clips worth sharing", "hype they can ride"],
  lonely: ["to feel personally seen and remembered", "a voice in the quiet hours", "someone who notices when they're there"],
  simps: ["flirty attention and banter", "to feel special in chat", "a little validation"],
  whales: ["to be acknowledged by name for their generosity", "VIP treatment", "recognition for their support"],
  trolls: ["a reaction — any reaction", "to get under your skin", "entertainment from chaos"],
  cozy: ["a calm, kind place to hang out", "background comfort", "low-stress company"],
  stalkers: ["to get closer than is appropriate", "access you shouldn't give", "a bond that crosses lines"],
};

const MOTIVE_NEEDS: Record<string, string[]> = {
  hype: ["belong to something exciting", "feel part of a winning moment"],
  lonely: ["not feel invisible", "have someone who remembers them"],
  simps: ["feel desired", "believe there's a real connection"],
  whales: ["status and exclusivity", "to matter to someone successful"],
  trolls: ["power over the mood of the room", "proof they can affect you"],
  cozy: ["stability and warmth", "a routine that feels safe"],
  stalkers: ["control or possession", "to collapse the distance between fan and creator"],
};

const MOTIVE_FEARS: Record<string, string[]> = {
  hype: ["missing the best moment", "the stream getting boring"],
  lonely: ["being forgotten", "reaching out and being ignored"],
  simps: ["being one of many", "humiliation if rejected"],
  whales: ["being treated like any other viewer", "their money not mattering"],
  trolls: ["being banned before the bit lands", "you setting a boundary they can't break"],
  cozy: ["drama ruining the vibe", "the channel changing tone"],
  stalkers: ["you cutting them off", "someone else getting closer than them"],
};

const MOTIVE_BOUNDARIES: Record<string, string[]> = {
  hype: ["doesn't want long personal DMs", "hates when the stream stalls"],
  lonely: ["pulls back if dismissed twice", "won't tip if ignored"],
  simps: ["gets hurt if flirtation feels fake", "won't push past your stated limits"],
  whales: ["expects respect, not pity", "won't stay if publicly embarrassed"],
  trolls: ["retreats if mods clamp down hard", "escalates if you engage angrily"],
  cozy: ["leaves if things get too intense", "dislikes mean-spirited banter"],
  stalkers: ["interprets kindness as invitation", "escalates when boundaries are vague"],
};

export function seedMotive(arch: Archetype): Motive {
  const seg = arch.segment;
  const surface = pick(MOTIVE_SURFACES[seg] ?? MOTIVE_SURFACES.cozy);
  const need = pick(MOTIVE_NEEDS[seg] ?? MOTIVE_NEEDS.cozy);
  const fear = pick(MOTIVE_FEARS[seg] ?? MOTIVE_FEARS.cozy);
  const boundary = pick(MOTIVE_BOUNDARIES[seg] ?? MOTIVE_BOUNDARIES.cozy);
  return { surface, need, fear, boundary };
}

const OCCUPATIONS_BY_SEGMENT: Record<string, string[]> = {
  cozy: ["barista", "librarian", "remote editor", "grad student", "retail clerk", "dog walker"],
  hype: ["delivery driver", "warehouse associate", "college student", "esports coach", "fitness trainer"],
  lonely: ["night-shift cashier", "call-center rep", "freelance illustrator", "care aide", "data entry clerk"],
  simps: ["software dev", "sales associate", "barista", "junior accountant", "gym front desk"],
  whales: ["finance analyst", "consultant", "small-business owner", "real-estate agent", "tech lead"],
  trolls: ["fast-food crew", "forum mod", "unemployed", "part-time streamer", "campus IT"],
  stalkers: ["security guard", "night janitor", "courier", "unemployed", "freelancer"],
};

const AGE_RANGE_BY_SEGMENT: Record<string, [number, number]> = {
  cozy: [22, 48],
  hype: [17, 32],
  lonely: [20, 45],
  simps: [18, 34],
  whales: [28, 55],
  trolls: [16, 28],
  stalkers: [22, 42],
};

/** Roll a plausible age for this archetype. */
export function seedAge(arch: Archetype): number {
  if (arch.id === "hype-mom") return randInt(45, 62);
  if (arch.id === "curious") return randInt(16, 22);
  if (arch.id === "whale") return randInt(30, 58);
  const [lo, hi] = AGE_RANGE_BY_SEGMENT[arch.segment] ?? [20, 40];
  return randInt(lo, hi);
}

/** Roll a day-job / life role for this archetype. */
export function seedOccupation(arch: Archetype): string {
  const pool = OCCUPATIONS_BY_SEGMENT[arch.segment] ?? OCCUPATIONS_BY_SEGMENT.cozy;
  if (arch.id === "mod") return pick(["community mod", "forum admin", "discord mod", "volunteer mod"]);
  if (arch.id === "gamer") return pick(["QA tester", "game-store clerk", "IT support", "indie dev"]);
  if (arch.id === "donator") return pick(["teacher", "nurse aide", "postal worker", "line cook"]);
  return pick(pool);
}

/** Base watch windows by segment (minutes since midnight). */
const WATCH_BY_SEGMENT: Record<string, { start: number; end: number }> = {
  cozy: { start: 10 * 60, end: 16 * 60 },
  hype: { start: 18 * 60, end: 25 * 60 },
  lonely: { start: 20 * 60, end: 27 * 60 },
  simps: { start: 19 * 60, end: 24 * 60 },
  whales: { start: 20 * 60, end: 25 * 60 },
  trolls: { start: 14 * 60, end: 22 * 60 },
  stalkers: { start: 22 * 60, end: 28 * 60 },
};

/** Roll a character's usual viewing hours with small jitter. */
export function seedWatchWindow(arch: Archetype): { watchStart: number; watchEnd: number } {
  const base = WATCH_BY_SEGMENT[arch.segment] ?? { start: 17 * 60, end: 23 * 60 };
  const jitter = () => randInt(-25, 25);
  return {
    watchStart: base.start + jitter(),
    watchEnd: base.end + jitter(),
  };
}

/** Affinity widens the window — up to `affinityExtendMax` minutes each side. */
export function extendedWatchWindow(c: CharacterSheet): { start: number; end: number } {
  const ext = Math.round((c.affinity / 100) * BALANCE.watch.affinityExtendMax);
  return { start: c.watchStart - ext, end: c.watchEnd + ext };
}

/** Whether this viewer would normally be watching at `clock`. */
export function isWatchingNow(c: CharacterSheet, clock: number): boolean {
  const { start, end } = extendedWatchWindow(c);
  return isInMinuteWindow(clock, start, end);
}

/** How strongly this archetype fits the current time of day (0..1). */
export function archetypeTimeFit(arch: Archetype, clock: number): number {
  const base = WATCH_BY_SEGMENT[arch.segment] ?? { start: 17 * 60, end: 23 * 60 };
  if (isInMinuteWindow(clock, base.start, base.end)) return 1;
  const phase = dayPhase(clock);
  const seg = arch.segment;
  if (phase === "morning" && (seg === "cozy" || arch.id === "hype-mom" || arch.id === "lurker")) return 0.85;
  if (phase === "afternoon" && (seg === "cozy" || seg === "trolls" || arch.id === "curious")) return 0.8;
  if (phase === "evening" && (seg === "hype" || seg === "simps" || seg === "whales" || seg === "lonely")) return 0.85;
  if (phase === "late" && (seg === "stalkers" || seg === "lonely")) return 0.9;
  return 0.35;
}

/** Pick an archetype weighted by content intensity and who's usually up at this hour. */
export function rollArchetypeForTime(
  intensity: number,
  clock: number,
  weightStalkers = false,
): Archetype {
  let pool = ARCHETYPES.filter((a) => a.minIntensity <= intensity);
  if (weightStalkers) {
    const stalkers = pool.filter((a) => a.segment === "stalkers");
    if (stalkers.length && Math.random() < 0.6) return pick(stalkers);
  }
  // Weighted pick by time fit so day streams skew cozy/morning, nights skew hype.
  const weights = pool.map((a) => Math.max(0.15, archetypeTimeFit(a, clock)));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pick(pool);
}

/** Seed a fresh character from an archetype (no LLM). */
export function seedCharacter(arch: Archetype, clock: number, taken: Set<string> = new Set()): CharacterSheet {
  const motive = seedMotive(arch);
  const traits = rollTraitModifiers(arch);
  const gender = rollGender(arch);
  const age = seedAge(arch);
  const occupation = seedOccupation(arch);
  const { watchStart, watchEnd } = seedWatchWindow(arch);
  const vibe = traits.fixation
    ? `${arch.blurb} Fixated on ${traits.fixation}.`
    : `${arch.blurb} ${traits.trait.charAt(0).toUpperCase()}${traits.trait.slice(1)} energy.`;

  return {
    id: uid("char"),
    handle: makeHandle(arch, taken),
    displayName: "",
    archetypeId: arch.id,
    gender,
    age,
    occupation,
    vibe,
    wants: motive.surface,
    motive,
    traits,
    watchStart,
    watchEnd,
    affinity: randInt(2, 12),
    relationship: "none",
    memory: "",
    interactionLog: [],
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
    lastVisitDay: -1,
    streamsAttended: 0,
    lastStreamDay: 0,
    attendanceStreak: 0,
    backstoryLayers: [],
    backstory: "",
    quirks: traits.speechTic,
    hasPortrait: false,
    hasBody: false,
    affinityDay: -1,
    affinityGainedToday: 0,
    lastDmAffinityDay: -1,
    lastInteractionDay: -1,
  };
}

/**
 * Fill in any fields a rehydrated sheet is missing. Saves from before these
 * fields existed lack them; this keeps `.push`/numeric math from hitting
 * `undefined`. No save-version bump needed — defaults are inert.
 */
function needsSeedAge(c: CharacterSheet): boolean {
  return typeof c.age !== "number" || !Number.isFinite(c.age) || c.age < 1;
}

function needsSeedOccupation(c: CharacterSheet): boolean {
  return typeof c.occupation !== "string" || !c.occupation.trim();
}

/** Normalize every character in a persisted roster (rehydrate / boot). */
export function normalizeRoster(roster: Roster): Roster {
  return Object.fromEntries(
    Object.entries(roster).map(([id, c]) => [id, normalizeCharacter(c)]),
  );
}

export function normalizeCharacter(c: CharacterSheet): CharacterSheet {
  const arch = ARCHETYPE_BY_ID[c.archetypeId];
  const fallback = arch ?? ARCHETYPES[0];
  const motive = c.motive ?? seedMotive(fallback);
  const traits = c.traits ?? rollTraitModifiers(fallback);
  const watch = c.watchStart !== undefined && c.watchEnd !== undefined
    ? { watchStart: c.watchStart, watchEnd: c.watchEnd }
    : seedWatchWindow(fallback);
  let backstoryLayers = c.backstoryLayers ?? [];
  if (!backstoryLayers.length && c.backstory) {
    backstoryLayers = [{ id: uid("layer"), trigger: "seed", text: c.backstory }];
  }
  const backstory = syncBackstoryString(backstoryLayers) || (c.backstory ?? "");

  return {
    ...c,
    gender: c.gender ?? rollGender(fallback),
    age: needsSeedAge(c) ? seedAge(fallback) : c.age,
    occupation: needsSeedOccupation(c) ? seedOccupation(fallback) : c.occupation,
    motive,
    traits,
    watchStart: watch.watchStart,
    watchEnd: watch.watchEnd,
    wants: c.wants ?? motive.surface,
    interactionLog: c.interactionLog ?? [],
    backstoryLayers,
    backstory,
    quirks: c.quirks ?? traits.speechTic,
    milestones: c.milestones ?? [],
    relationship: c.relationship ?? "none",
    escalationDay: c.escalationDay ?? -1,
    lastVisitDay: c.lastVisitDay ?? -1,
    streamsAttended: c.streamsAttended ?? 0,
    lastStreamDay: c.lastStreamDay ?? 0,
    attendanceStreak: c.attendanceStreak ?? 0,
    hasPortrait: c.hasPortrait ?? false,
    hasBody: c.hasBody ?? false,
    affinityDay: c.affinityDay ?? -1,
    affinityGainedToday: c.affinityGainedToday ?? 0,
    lastDmAffinityDay: c.lastDmAffinityDay ?? -1,
    lastInteractionDay: c.lastInteractionDay ?? -1,
  };
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

/** Build a prompt-friendly personality block for LLM/mock paths. */
export function characterVoiceBlock(c: CharacterSheet): string {
  const arch = ARCHETYPE_BY_ID[c.archetypeId];
  const p = pronouns(c.gender);
  const lines = [
    `${c.handle} (${arch?.label ?? "viewer"}, ${c.age}, ${c.occupation}, ${p.subj}/${p.obj})`,
    `Vibe: ${c.vibe}`,
    `Wants: ${c.motive.surface}. Deeper need: ${c.motive.need}.`,
    `Fear: ${c.motive.fear}. Boundary: ${c.motive.boundary}.`,
    c.traits.fixation ? `Fixation: ${c.traits.fixation}.` : "",
    `Trait: ${c.traits.trait} (intensity ${c.traits.intensity}). Speech tic: "${c.traits.speechTic}".`,
  ];
  return lines.filter(Boolean).join("\n");
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
