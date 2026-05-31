/**
 * Named viewer characters. Each is seeded from an archetype (deterministic,
 * offline-safe) and optionally enriched by the LLM. They go online/offline over
 * the night, accrue a relationship and interaction memory, and can be talked to
 * directly.
 */

import { ARCHETYPE_BY_ID, ARCHETYPES, type Archetype } from "./archetypes";
import type { SegmentId } from "./segments";
import { pick, randInt, uid, clamp } from "../rng/rng";
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

/** Per-instance personality axes rolled at seed time (-5..+5 each). */
export interface Personality {
  warmth: number;
  energy: number;
  formality: number;
  boldness: number;
  humor: number;
  /** -5 platonic/averse … +5 openly flirtatious or suggestive when the vibe allows. */
  horny: number;
  /** Stalker fixation axis — what they obsess over (stalkers only). */
  fixation?: string;
  /** Offline chatEngine mock filler only — never injected into LLM prompts. */
  speechTic: string;
}

/** @deprecated Legacy saves only — migrated to `personality` on normalize. */
export interface TraitModifiers {
  trait: string;
  intensity: number;
  fixation?: string;
  speechTic: string;
}

export interface Origin {
  place: string;
  language: string;
  markers: string[];
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
  origin: string | null;
  personalitySummary: string | null;
  voiceProfile: string | null;
}

export interface CharacterSheet {
  id: string;
  /** Chat handle, e.g. "midnight_mara". */
  handle: string;
  /** Display name once the PLAYER has learned it, else "". */
  displayName: string;
  /**
   * The character's actual given name — self-knowledge, set at creation and known
   * to the NPC from the start. They may choose to share it (which sets
   * `displayName`); the game never forces it. Distinct from `displayName`, which
   * tracks what the *player* has learned.
   */
  realName: string;
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
  /** Home region / city — self-knowledge. */
  origin: string;
  /** First language — self-knowledge. */
  nativeLanguage: string;
  /** Deterministic typing-style guidance for LLM prompts (may be LLM-refined once). */
  voiceProfile: string;
  /** True after hybrid LLM voice enrichment on first contact. */
  voiceRefined?: boolean;
  /** Per-instance personality axes. */
  personality: Personality;
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

/** Gendered first-name pools used to seed each character's real name. */
export const FEMALE_NAMES = [
  "Mara", "June", "Robin", "Quinn", "Iris", "Noa", "Sky", "Wren", "Remy", "Lena",
  "Zoe", "Mia", "Eva", "Nora", "Lily", "Ruby", "Jade", "Cleo", "Tess", "Vera",
  "Hana", "Sage", "Faye", "Elle", "Rosa", "Nina", "Ada", "Bea", "Cora", "Dana",
];
export const MALE_NAMES = [
  "Nico", "Eli", "Theo", "Kai", "Devon", "Casey", "Ash", "Sam", "Alex", "Marc",
  "Leo", "Max", "Ian", "Owen", "Cole", "Dean", "Finn", "Gabe", "Hugo", "Jude",
  "Knox", "Luke", "Miles", "Noah", "Reed", "Sean", "Troy", "Wade", "Zane", "Blake",
];
export const NEUTRAL_NAMES = [
  "Sam", "Alex", "Casey", "Robin", "Quinn", "Remy", "Ash", "Sky", "Noa", "Devon",
  "Rory", "Sage", "River", "Phoenix", "Rowan", "Emery", "Arlo", "Blair", "Drew", "Jules",
];

/** A gender-appropriate first name, avoiding any already in `taken` when possible. */
export function pickName(gender: CharacterGender, taken: Set<string> = new Set()): string {
  const pool =
    gender === "female" ? FEMALE_NAMES
    : gender === "male" ? MALE_NAMES
    : NEUTRAL_NAMES;
  const available = pool.filter((n) => !taken.has(n.toLowerCase()));
  if (available.length) return pick(available);
  return `${pick(pool)}${randInt(2, 9)}`;
}

export function pronouns(gender: CharacterGender): { subj: string; obj: string; poss: string } {
  switch (gender) {
    case "female": return { subj: "she", obj: "her", poss: "her" };
    case "male": return { subj: "he", obj: "him", poss: "his" };
    default: return { subj: "they", obj: "them", poss: "their" };
  }
}

// ---- personality / origin / voice --------------------------------------------

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

type PersonalityBase = Pick<Personality, "warmth" | "energy" | "formality" | "boldness" | "humor" | "horny">;

const PERSONALITY_AXIS_MIN = -5;
const PERSONALITY_AXIS_MAX = 5;
const LEGACY_PERSONALITY_AXIS_MAX = 2;

const PERSONALITY_AXES = ["warmth", "energy", "formality", "boldness", "humor", "horny"] as const;

const SEGMENT_PERSONALITY_BASE: Record<SegmentId, PersonalityBase> = {
  hype: { warmth: 3, energy: 5, formality: -2, boldness: 3, humor: 3, horny: -2 },
  cozy: { warmth: 5, energy: -2, formality: 0, boldness: -2, humor: 0, horny: -2 },
  lonely: { warmth: 5, energy: 0, formality: 0, boldness: -2, humor: -2, horny: 0 },
  simps: { warmth: 3, energy: 3, formality: -2, boldness: 5, humor: 3, horny: 5 },
  whales: { warmth: 0, energy: 0, formality: 3, boldness: 5, humor: 0, horny: 3 },
  trolls: { warmth: -5, energy: 3, formality: -2, boldness: 5, humor: 5, horny: -2 },
  stalkers: { warmth: 3, energy: -2, formality: 0, boldness: 0, humor: -2, horny: 3 },
};

export const ORIGINS: Origin[] = [
  { place: "Manchester, UK", language: "English", markers: ["British regional slang", "dry understatement"] },
  { place: "rural Ohio", language: "English", markers: ["casual Midwest register"] },
  { place: "Los Angeles", language: "English", markers: ["Californian filler-word habit"] },
  { place: "Toronto", language: "English", markers: ["soft Canadian politeness"] },
  { place: "Sydney", language: "English", markers: ["Australian clipped slang"] },
  { place: "São Paulo, Brazil", language: "Portuguese", markers: ["Brazilian-style typed laughter", "drops articles", "warm, emoji-forward"] },
  { place: "Berlin", language: "German", markers: ["literal and blunt phrasing"] },
  { place: "Seoul", language: "Korean", markers: ["polite, slightly formal register"] },
  { place: "Manila", language: "Tagalog", markers: ["politeness particles leak in", "emoji-forward"] },
  { place: "Mexico City", language: "Spanish", markers: ["warm diminutives", "Spanish-style typed laughter"] },
  { place: "Mumbai", language: "Hindi", markers: ["earnest, slightly formal", "Indian-English tag words"] },
  { place: "Stockholm", language: "Swedish", markers: ["understated, near-perfect English"] },
];

function jitterAxis(value: number): number {
  return clamp(value + randInt(-2, 2), PERSONALITY_AXIS_MIN, PERSONALITY_AXIS_MAX);
}

/** Rescale pre-granularity saves that still use the old -2..+2 range. */
function upgradePersonalityScale(p: Personality): Personality {
  const peak = Math.max(...PERSONALITY_AXES.map((k) => Math.abs(p[k])));
  if (peak > LEGACY_PERSONALITY_AXIS_MAX) return p;
  const scale = PERSONALITY_AXIS_MAX / LEGACY_PERSONALITY_AXIS_MAX;
  const next = { ...p };
  for (const key of PERSONALITY_AXES) {
    next[key] = clamp(Math.round(p[key] * scale), PERSONALITY_AXIS_MIN, PERSONALITY_AXIS_MAX);
  }
  return next;
}

export function rollPersonality(arch: Archetype): Personality {
  const base = SEGMENT_PERSONALITY_BASE[arch.segment] ?? SEGMENT_PERSONALITY_BASE.cozy;
  const fixation = arch.segment === "stalkers" ? pick(STALKER_FIXATIONS) : undefined;
  return {
    warmth: jitterAxis(base.warmth),
    energy: jitterAxis(base.energy),
    formality: jitterAxis(base.formality),
    boldness: jitterAxis(base.boldness),
    humor: jitterAxis(base.humor),
    horny: jitterAxis(base.horny),
    fixation,
    speechTic: pick(SPEECH_TICS),
  };
}

/** Pick a home region; cozy/lonely slightly more likely to be non-US English. */
export function seedOrigin(arch: Archetype): Origin {
  const nonUs = ORIGINS.filter((o) => !["rural Ohio", "Los Angeles"].includes(o.place));
  const pool =
    (arch.segment === "cozy" || arch.segment === "lonely") && Math.random() < 0.35
      ? nonUs
      : ORIGINS;
  return pick(pool);
}

type PersonalityAxis = (typeof PERSONALITY_AXES)[number];

interface AxisProse {
  label: string;
  /** Adjective ladder for magnitude 1..5 in the positive direction. */
  pos: [string, string, string, string, string];
  /** Adjective ladder for magnitude 1..5 in the negative direction. */
  neg: [string, string, string, string, string];
  /** Behavioural consequence when this axis leans positive. */
  posEffect: string;
  /** Behavioural consequence when this axis leans negative. */
  negEffect: string;
}

/**
 * Per-axis graduated descriptors. Every nonzero level (±1..±5) maps to a distinct
 * word so the full -5..+5 range is actually expressed, plus a behavioural
 * consequence used in the dev table and prompts.
 */
const AXIS_PROSE: Record<PersonalityAxis, AxisProse> = {
  warmth: {
    label: "Warmth",
    pos: ["cordial", "warm", "very warm", "deeply caring", "radiantly affectionate"],
    neg: ["a little cool", "distant", "cold", "frosty", "openly hostile"],
    posEffect: "leads with kindness, reassurance, and personal interest",
    negEffect: "keeps people at arm's length and can turn cutting",
  },
  energy: {
    label: "Energy",
    pos: ["lively", "upbeat", "high-energy", "hyper", "manic"],
    neg: ["mellow", "low-key", "reserved", "withdrawn", "nearly silent"],
    posEffect: "fires off fast, exclamation-heavy bursts",
    negEffect: "slow to warm up; long pauses, easily drained",
  },
  formality: {
    label: "Formality",
    pos: ["tidy", "articulate", "polished", "formal", "stiffly proper"],
    neg: ["casual", "slangy", "very slangy", "sloppy", "barely punctuated"],
    posEffect: "writes clean, complete, capitalised sentences",
    negEffect: "lowercase, abbreviations, loose grammar",
  },
  boldness: {
    label: "Boldness",
    pos: ["forthright", "forward", "bold", "brazen", "shameless"],
    neg: ["soft-spoken", "timid", "meek", "skittish", "painfully shy"],
    posEffect: "states wants directly and pushes for more",
    negEffect: "hedges, waits for permission, retreats if rebuffed",
  },
  humor: {
    label: "Humor",
    pos: ["dryly amused", "jokey", "playful", "relentlessly funny", "incorrigible clown"],
    neg: ["plain-spoken", "earnest", "serious", "grave", "humorless"],
    posEffect: "turns most things into a bit",
    negEffect: "takes things at face value; jokes can land flat",
  },
  horny: {
    label: "Horny",
    pos: ["faintly flirty", "flirty", "forward", "suggestive", "explicitly horny"],
    neg: ["platonic", "strictly platonic", "sex-averse", "prudish", "repulsed by it"],
    posEffect: "lets flirtation creep in when she invites it",
    negEffect: "keeps things clean; flirting backfires",
  },
};

/** Word for a single axis at its current value (empty string at 0). */
function axisWord(axis: PersonalityAxis, value: number): string {
  if (value === 0) return "";
  const mag = Math.min(5, Math.abs(value));
  const ladder = value > 0 ? AXIS_PROSE[axis].pos : AXIS_PROSE[axis].neg;
  return ladder[mag - 1];
}

/**
 * Short prose summary across all axes. Includes every nonzero axis so the full
 * granular range is reflected (not just the strong extremes).
 */
export function personalityProse(p: Personality): string {
  const parts = PERSONALITY_AXES.map((k) => axisWord(k, p[k])).filter(Boolean);
  return parts.length ? parts.join(", ") : "even-keeled";
}

/** Per-axis table for dev surfaces: value, prose word, behavioural consequence. */
export interface AxisRow {
  axis: string;
  value: number;
  word: string;
  effect: string;
}

export function personalityTable(p: Personality): AxisRow[] {
  return PERSONALITY_AXES.map((k) => {
    const value = p[k];
    const spec = AXIS_PROSE[k];
    const word = value === 0 ? "neutral" : axisWord(k, value);
    const effect = value === 0 ? "—" : value > 0 ? spec.posEffect : spec.negEffect;
    return { axis: spec.label, value, word, effect };
  });
}

/** Raw axis readout for compact dev/debug surfaces (signed values). */
export function personalityAxes(p: Personality): string {
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
  return PERSONALITY_AXES.map((k) => `${k} ${fmt(p[k])}`).join(", ");
}

/**
 * Deterministic typing-style guidance as a SHORT list of key phrases (tags),
 * not prose. Tendencies only — never literal tokens to copy. Kept to the few
 * most salient tags so "Types like" reads as quick descriptors.
 */
export function seedVoiceProfile(personality: Personality, origin: Origin): string {
  const tags: string[] = [];

  // Casing
  if (personality.formality >= 3) tags.push("proper capitalization");
  else if (personality.formality <= -3) tags.push("all-lowercase");
  else tags.push("casual casing");

  // Pace / punctuation
  if (personality.energy >= 3) tags.push("short bursts, lots of !!");
  else if (personality.warmth >= 3 && personality.energy <= 0) tags.push("gentle, trailing …");
  else if (personality.energy <= -3) tags.push("terse, sparse punctuation");

  // Emoji
  if (personality.warmth >= 3 || personality.energy >= 3) tags.push("emoji-heavy");
  else if (personality.humor >= 3) tags.push("meme-y reactions");
  else if (personality.formality >= 3 || personality.warmth <= -3) tags.push("rarely emoji");

  // Length
  tags.push(personality.energy >= 2 ? "one-liners" : personality.energy <= -2 ? "few words" : "short messages");

  // Manner from the loudest non-style axis
  if (personality.boldness >= 3) tags.push("blunt/direct");
  else if (personality.boldness <= -3) tags.push("hedging/shy");
  if (personality.humor >= 4) tags.push("constantly joking");
  if (personality.horny >= 3) tags.push("flirty undertone");

  // Origin colour (first marker only) + non-native flag
  if (origin.markers.length) tags.push(origin.markers[0]);
  if (origin.language !== "English") tags.push(`${origin.language}-native (minor slips)`);

  // De-dupe and cap to keep it scannable.
  return [...new Set(tags)].slice(0, 6).join(" · ");
}

/** Migrate legacy `traits` field from old saves. */
export function migrateLegacyTraits(legacy: TraitModifiers | undefined, arch: Archetype): Personality {
  if (!legacy) return rollPersonality(arch);
  const p = rollPersonality(arch);
  return {
    ...p,
    fixation: legacy.fixation ?? p.fixation,
    speechTic: legacy.speechTic || p.speechTic,
  };
}

/** Concatenate layers into the legacy `backstory` string for prompts. */
export function syncBackstoryString(layers: BackstoryLayer[]): string {
  return layers.map((l) => l.text).filter(Boolean).join(" ");
}

export function hasBackstoryLayer(c: CharacterSheet, trigger: string): boolean {
  return c.backstoryLayers.some((l) => l.trigger === trigger);
}

/** Human-facing heading for a backstory layer, so multiple rows aren't all "Backstory". */
export function backstoryLayerLabel(trigger: string): string {
  if (trigger.startsWith("threat-")) return "⚠ What you've uncovered";
  switch (trigger) {
    case "seed": return "Background";
    case "familiar": return "Getting to know them";
    case "regular": return "Opening up";
    case "friend": return "Closer now";
    case "confidant": return "What they've trusted you with";
    default:
      return trigger
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

/** Append a capped interaction entry. Returns the new log array. */
export function appendInteraction(
  log: CharLogEntry[],
  entry: Omit<CharLogEntry, "ts"> & { ts?: number },
): CharLogEntry[] {
  const next = [...log, { ts: entry.ts ?? Date.now(), day: entry.day, kind: entry.kind, text: entry.text }];
  return next.length > INTERACTION_LOG_CAP ? next.slice(-INTERACTION_LOG_CAP) : next;
}

/**
 * What the player is allowed to see, gated by the RELATIONSHIP (affinity), which
 * is the only thing that reflects genuinely getting to know someone.
 *
 * Deliberately NOT gated on:
 *  - `c.known` — set the instant a sheet is opened, so it would leak everything.
 *  - `c.messageCount` — counts the NPC's *passive* chat spam during streams, so a
 *    chatty stranger would expose their age/personality without any real bond.
 *
 * Engagement stats the player already owns (their own message/tip/affinity tallies
 * and condensed memory) show as soon as there's been any contact at all.
 *
 * Progression ladder:
 *   stranger (<15)  — nothing personal
 *   familiar (15+)  — first read: vibe, broad personality
 *   regular  (35+)  — age, origin, occupation, wants, quirk
 *   friend   (60+)  — typing voice, deeper backstory
 *   confidant(85+)  — the deepest layers
 */
export function revealedSheet(c: CharacterSheet): RevealedSheet {
  const lvl = relationshipLevel(c.affinity);
  const contacted = c.interactionLog.length > 0 || c.tipped > 0 || c.displayName !== "" || c.memory !== "";
  const isFamiliar = lvl !== "stranger"; // affinity >= 15
  const isRegularPlus = lvl === "regular" || lvl === "friend" || lvl === "confidant"; // >= 35
  const isFriendPlus = lvl === "friend" || lvl === "confidant"; // >= 60

  const unlockedTriggers = new Set<string>();
  if (isFamiliar) unlockedTriggers.add("seed");
  if (isFamiliar) unlockedTriggers.add("familiar");
  if (isRegularPlus || c.displayName) unlockedTriggers.add("regular");
  if (isFriendPlus) unlockedTriggers.add("friend");
  if (lvl === "confidant") unlockedTriggers.add("confidant");
  for (let t = 1; t <= c.threat; t += 1) unlockedTriggers.add(`threat-${t}`);

  const visibleLayers = c.backstoryLayers.filter((l) => unlockedTriggers.has(l.trigger));

  return {
    displayName: c.displayName || null,
    vibe: isFamiliar ? c.vibe : null,
    motiveSurface: isRegularPlus ? c.motive.surface : null,
    backstoryLayers: visibleLayers,
    quirks: isRegularPlus ? (c.quirks || null) : null,
    threat: c.threat >= 1 ? c.threat : null,
    memory: contacted ? (c.memory || null) : null,
    messages: contacted ? c.messageCount : null,
    tipped: c.tipped > 0 ? c.tipped : null,
    affinity: contacted ? c.affinity : null,
    attendance: c.attendanceStreak >= 2 ? `${c.attendanceStreak} streams running (${c.streamsAttended} total)` : null,
    age: isRegularPlus ? c.age : null,
    occupation: isRegularPlus ? c.occupation : null,
    origin: isRegularPlus ? (c.origin || null) : null,
    personalitySummary: isFamiliar ? personalityProse(c.personality) : null,
    voiceProfile: isFriendPlus ? (c.voiceProfile || null) : null,
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

// ---- gender / motives --------------------------------------------------------

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

const MOTIVE_SURFACES: Record<string, string[]> = {
  hype: ["big entertaining moments to react to", "clips worth sharing", "hype they can ride", "a crew to celebrate wins with", "loud, chaotic fun", "to be first on the best moments"],
  lonely: ["a voice in the quiet hours", "someone who notices when they're there", "company while they wind down", "a low-pressure place to just be around people", "to feel personally seen", "a familiar face at the end of the day"],
  simps: ["flirty attention and banter", "to feel special in chat", "a little validation", "to make you laugh on purpose", "to be your favorite regular", "a private inside joke with you"],
  whales: ["to be acknowledged by name for their generosity", "VIP treatment", "recognition for their support", "to visibly shape the stream with money", "first-name familiarity", "to feel like a patron, not a viewer"],
  trolls: ["a reaction — any reaction", "to get under your skin", "entertainment from chaos", "to test where your limits really are", "an audience for the bit", "to feel clever at your expense"],
  cozy: ["a calm, kind place to hang out", "background comfort", "low-stress company", "a gentle routine to follow", "soft conversation, nothing heavy", "a pleasant corner of the internet"],
  stalkers: ["to get closer than is appropriate", "access you shouldn't give", "a bond that crosses lines", "to learn things you didn't share", "to be the one who truly 'gets' you", "to close the gap between fan and creator"],
};

const MOTIVE_NEEDS: Record<string, string[]> = {
  hype: ["to belong to something exciting", "to be part of a winning moment", "an outlet for restless energy", "to feel the room move together", "a reason to show up loud"],
  lonely: ["to not feel invisible", "to be remembered between visits", "proof that someone would notice their absence", "a thread of human contact", "to matter to one specific person"],
  simps: ["to feel desired", "to believe there's a real connection", "to be chosen over the crowd", "tenderness they don't get offline", "to be wanted, not just tolerated"],
  whales: ["status and exclusivity", "to matter to someone they admire", "to convert money into being seen", "control over something that feels premium", "to outrank the ordinary fans"],
  trolls: ["power over the mood of the room", "proof they can affect you", "to feel sharper than everyone watching", "to puncture something earnest", "to be impossible to ignore"],
  cozy: ["stability and warmth", "a routine that feels safe", "to lower their guard somewhere", "quiet belonging without demands", "a soft landing after hard days"],
  stalkers: ["control or possession", "to collapse the distance between fan and creator", "to be the exception to your rules", "certainty that you're 'theirs'", "to be irreplaceable to you"],
};

const MOTIVE_FEARS: Record<string, string[]> = {
  hype: ["missing the best moment", "the stream going flat", "being the only one not in on it", "the energy dying"],
  lonely: ["being forgotten", "reaching out and getting silence", "being just another handle in chat", "going a whole day unnoticed"],
  simps: ["being one of many", "humiliation if rejected", "discovering the warmth was an act", "being seen as pathetic"],
  whales: ["being treated like any other viewer", "their money not mattering", "being thanked and then ignored", "looking like a mark"],
  trolls: ["being banned before the bit lands", "a boundary they can't break", "being boring", "being ignored instead of engaged"],
  cozy: ["drama ruining the vibe", "the channel changing tone", "conflict they can't escape", "being put on the spot"],
  stalkers: ["you cutting them off", "someone else getting closer first", "being seen as just a fan", "losing the access they've gained"],
};

const MOTIVE_BOUNDARIES: Record<string, string[]> = {
  hype: ["bored by long personal DMs", "hates when the stream stalls", "checks out if it gets too quiet", "won't sit through slow segments"],
  lonely: ["pulls back if dismissed twice", "won't tip if ignored", "goes quiet rather than fight for attention", "fades out if it feels one-sided"],
  simps: ["gets hurt if flirtation feels fake", "won't push past your stated limits", "sulks if a joke lands wrong", "withdraws if it feels transactional"],
  whales: ["expects respect, not pity", "won't stay if publicly embarrassed", "stops spending if taken for granted", "dislikes being lumped in with freeloaders"],
  trolls: ["retreats if mods clamp down hard", "escalates if you engage angrily", "loses interest once it's not a game", "backs off if you stay genuinely calm"],
  cozy: ["leaves if things get too intense", "dislikes mean-spirited banter", "won't be dragged into drama", "logs off when it gets loud"],
  stalkers: ["reads kindness as invitation", "escalates when boundaries are vague", "ignores soft no's", "tests rules to see which ones hold"],
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
  const personality = rollPersonality(arch);
  const origin = seedOrigin(arch);
  const gender = rollGender(arch);
  const age = seedAge(arch);
  const occupation = seedOccupation(arch);
  const { watchStart, watchEnd } = seedWatchWindow(arch);
  const voiceProfile = seedVoiceProfile(personality, origin);
  const vibe = personality.fixation
    ? `${arch.blurb} Fixated on ${personality.fixation}.`
    : `${arch.blurb} ${personalityProse(personality)}.`;

  return {
    id: uid("char"),
    handle: makeHandle(arch, taken),
    displayName: "",
    realName: pickName(gender),
    archetypeId: arch.id,
    gender,
    age,
    occupation,
    origin: origin.place,
    nativeLanguage: origin.language,
    voiceProfile,
    vibe,
    wants: motive.surface,
    motive,
    personality,
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
    quirks: personality.speechTic,
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
  const legacyTraits = (c as CharacterSheet & { traits?: TraitModifiers }).traits;
  let personality = c.personality ?? migrateLegacyTraits(legacyTraits, fallback);
  if (typeof personality.horny !== "number") {
    const base = SEGMENT_PERSONALITY_BASE[fallback.segment] ?? SEGMENT_PERSONALITY_BASE.cozy;
    personality = { ...personality, horny: jitterAxis(base.horny) };
  }
  personality = upgradePersonalityScale(personality);
  const watch = c.watchStart !== undefined && c.watchEnd !== undefined
    ? { watchStart: c.watchStart, watchEnd: c.watchEnd }
    : seedWatchWindow(fallback);
  let backstoryLayers = c.backstoryLayers ?? [];
  if (!backstoryLayers.length && c.backstory) {
    backstoryLayers = [{ id: uid("layer"), trigger: "seed", text: c.backstory }];
  }
  const backstory = syncBackstoryString(backstoryLayers) || (c.backstory ?? "");

  const gender = c.gender ?? rollGender(fallback);
  const originEntry =
    c.origin && ORIGINS.some((o) => o.place === c.origin)
      ? ORIGINS.find((o) => o.place === c.origin)!
      : seedOrigin(fallback);
  const origin = c.origin || originEntry.place;
  const nativeLanguage = c.nativeLanguage || originEntry.language;
  const voiceProfile = c.voiceProfile || seedVoiceProfile(personality, originEntry);

  return {
    ...c,
    gender,
    realName: c.realName || c.displayName || pickName(gender),
    age: needsSeedAge(c) ? seedAge(fallback) : c.age,
    occupation: needsSeedOccupation(c) ? seedOccupation(fallback) : c.occupation,
    origin,
    nativeLanguage,
    voiceProfile,
    motive,
    personality,
    watchStart: watch.watchStart,
    watchEnd: watch.watchEnd,
    wants: c.wants ?? motive.surface,
    interactionLog: c.interactionLog ?? [],
    backstoryLayers,
    backstory,
    quirks: c.quirks ?? personality.speechTic,
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

/** Reflexive pronoun ("himself"/"herself"/"themselves") from a subject pronoun. */
function reflexive(subj: string): string {
  return subj === "she" ? "herself" : subj === "he" ? "himself" : "themselves";
}

/**
 * Build a prompt-friendly character block for LLM paths.
 *
 * IMPORTANT — perspective: this is written in the THIRD PERSON and refers to the
 * character by name/pronoun and to the streamer by name. We never use "you"/"your"
 * inside the character data, because the stored backstory/memory also refer to the
 * streamer, and a mix of "you = the NPC" (framing) with "your = the streamer"
 * (backstory) produces the classic perspective flip. Keeping everything in third
 * person with explicit names removes that ambiguity entirely.
 *
 * The character knows everything about themselves and decides what to share; we
 * never censor — if something wouldn't come up yet, they simply don't mention it.
 */
export function characterVoiceBlock(c: CharacterSheet, streamerName: string): string {
  const arch = ARCHETYPE_BY_ID[c.archetypeId];
  const p = pronouns(c.gender);
  const name = c.realName || c.handle;
  const Subj = p.subj.charAt(0).toUpperCase() + p.subj.slice(1);
  const refl = reflexive(p.subj);
  const lines = [
    `Voice this character: ${name} (@${c.handle}) — a ${arch?.label ?? "viewer"}, ${c.age}yo ${c.occupation} from ${c.origin}, ${p.subj}/${p.obj}. ${Subj} is a fan who watches the streamer ${streamerName}; ${p.subj} is the fan, never ${streamerName}.`,
    `Personality: ${personalityProse(c.personality)}.`,
    c.personality.fixation ? `Fixation: ${c.personality.fixation}.` : "",
    `Typing style (guidance, not a script): ${c.voiceProfile}.`,
    `What ${p.subj} wants from ${streamerName}: ${c.motive.surface}. Deeper need: ${c.motive.need}.`,
    `Fear: ${c.motive.fear}. Boundary: ${c.motive.boundary}.`,
    c.backstory ? `Background (${p.subj} lives this, never recites it): ${c.backstory}` : "",
    `${Subj} knows ${refl} completely and reveals personal details (real name, job, past) only when it fits how close ${p.subj} and ${streamerName} are — a stranger earns less than a confidant.`,
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
