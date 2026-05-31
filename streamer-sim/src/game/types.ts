/** Core domain types shared by the store, engines, and UI. */

export type ChatMessageKind =
  | "normal"
  | "hype"
  | "question"
  | "troll"
  | "flirty"
  | "creepy"
  | "donation"
  | "follow"
  | "sub"
  | "raid"
  | "mod"
  | "system"
  | "streamer";

export interface ChatMessage {
  id: string;
  user: string;
  text: string;
  kind: ChatMessageKind;
  /** For donation/sub messages: money in dollars. */
  amount?: number;
  /** If this line came from a named character in the roster. */
  characterId?: string;
  /**
   * True if the text is canned/offline filler (archetype sample lines, generic
   * persona pools, mock fallback) rather than LLM-authored. These are NEVER fed
   * back to the chat model as "voice"/"recent chat" context, so the model can't
   * latch onto a scripted line and parrot it across the night.
   */
  scripted?: boolean;
  ts: number;
}

/**
 * Content-intensity dial. This sets the CEILING on how far things can escalate —
 * it does not force content to that level. Even at the maximum tier most chat is
 * ordinary; the tier just removes the cap so the player (and pushy viewers) can
 * drive escalation as far as they choose. `custom` layers the author's own
 * steering on top (see game/content.ts).
 */
export type ContentTier = "wholesome" | "flirty" | "risque" | "unhinged" | "custom";

export type TextBackend = "mock" | "gemini" | "openrouter";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** UI color scheme. */
export type ThemeId = "limelight" | "ocean" | "ember";

export type { ImageStylePresetId } from "../llm/imagePresets";
import type { ImageStylePresetId } from "../llm/imagePresets";
import type { SegmentId } from "./segments";
import type { NicheId } from "./niches";
import type { OutfitId } from "./outfits";

export interface Settings {
  streamerName: string;
  /** A short persona/bio that flavours the chat + storyteller prompts. */
  streamerPersona: string;
  /** "male", "female", or a custom free-text identity. Flavours image gen. */
  gender: string;
  /** Color theme for the app chrome. */
  theme: ThemeId;
  contentTier: ContentTier;
  /** Author-supplied steering appended verbatim when contentTier === "custom". */
  customSteering: string;
  /** Content niche — shapes who shows up + baseline appeal (see game/niches.ts). */
  niche: NicheId;
  /** Currently-worn outfit — a passive live appeal nudge (see game/outfits.ts). */
  outfit: OutfitId;
  textBackend: TextBackend;
  geminiModel: string;
  openRouterModel: string;
  /**
   * Two-tier routing: when on, lightweight chat bursts use the *fast* model
   * below while the evaluator, narration, and DMs use the main model above.
   */
  tieredModels: boolean;
  /** Cheap/fast model used for chat bursts when tiered routing is on. */
  geminiFastModel: string;
  openRouterFastModel: string;
  /** Sample high-impact action verdicts twice and reconcile, for stability. */
  selfConsistency: boolean;
  /** Stream DM replies token-by-token so they type out progressively. */
  streamReplies: boolean;
  /** Streamer's in-world birthday as "MM-DD" (empty = none), for seasonal beats. */
  streamerBirthday: string;
  /** Image models for room generation. */
  geminiImageModel: string;
  openRouterImageModel: string;
  /** Base image-prompt set. Per-field overrides take precedence when non-empty. */
  imageStylePreset: ImageStylePresetId;
  /** Editable image-prompt templates. Empty = use the active preset. */
  imageStyle: string;
  roomPrompt: string;
  portraitPrompt: string;
  bodyPrompt: string;
  presencePrompt: string;
  scenePrompt: string;
  /** Minimum diag level printed to the browser console. */
  consoleLevel: LogLevel;
  /** Show backend/derived numbers in the Stats panel (dev tooling). */
  devMode: boolean;
}

/**
 * One line in the Narrator (DM) sidebar. `dm` is prose, `action` echoes what the
 * player did, `outcome` is the coded summary of effects, `system` is meta.
 */
export interface StoryEntry {
  id: string;
  ts: number;
  kind: "dm" | "action" | "outcome" | "system" | "image" | "quote";
  text: string;
  /** For kind === "image": the StoredImage id to render inline. */
  imageId?: string;
  /** Set when the player has manually edited this line's text. */
  edited?: boolean;
}

/** The player character's visual identity for image generation. */
export interface CharacterVisual {
  /** Free-form description of how the streamer looks. */
  description: string;
  /** StoredImage id of the head-and-shoulders portrait. */
  portraitId: string | null;
  /** StoredImage id of the full-body T-pose template. */
  bodyId: string | null;
}

export interface Metrics {
  cash: number;
  followers: number;
  subscribers: number;
  currentViewers: number;
  peakViewers: number;
  /** 0-100 momentum of the stream; drives viewer growth. */
  hype: number;
  /** 0-100 stamina; drains live, regenerates on sleep. */
  energy: number;
  /** 0-100 wellbeing + boundaries; trolls/creeps lower it, rest raises it. */
  comfort: number;
  /** 0-100 fed (100 = full); drains over time. */
  hunger: number;
  /** 0-100 relieved (100 = empty); drains over time. */
  bladder: number;
  /** 0-100 clean (100 = fresh); drains over time. */
  hygiene: number;
  /** 0-100 arousal; only active in No Limits / custom tiers. */
  horny: number;
  day: number;
}

/** Tone for feedback bubbles / event-log lines. */
export type FeedbackTone = "good" | "bad" | "warn" | "neutral";

/**
 * A transient "what just changed" signal surfaced as a floating bubble (and,
 * when it carries a reason, an event-log line). Auto-captured from metric/
 * character mutations so every state change is legible.
 */
export interface FeedbackBubble {
  id: string;
  channel: "metric" | "character" | "alert";
  /** metric name | character id | alert kind. */
  key: string;
  /** Signed numeric change (+N / -N), when applicable. */
  delta?: number;
  /** Free text for alerts (e.g. "New follower"). */
  text?: string;
  tone: FeedbackTone;
  /** The "why" — also written to the event log when present. */
  reason?: string;
  ts: number;
}

/**
 * A persisted-for-the-session line in the activity log (the panel under the
 * studio map). Every metric/affinity/alert change is recorded here so the player
 * has a scrollable "what changed, and why" history, not just transient bubbles.
 */
export interface ChangeLogEntry {
  id: string;
  ts: number;
  channel: "metric" | "character" | "alert";
  /** Human label: metric name, character name, or alert title. */
  label: string;
  /** Signed numeric change, when applicable. */
  delta?: number;
  /** How to render the delta. */
  unit?: "cash" | "count" | "affinity";
  /** Free text for alerts / non-numeric entries. */
  text?: string;
  tone: FeedbackTone;
  reason?: string;
  /** In-world day the change happened, for grouping/labeling. */
  day: number;
}

export interface StreamSession {
  isLive: boolean;
  /** Turn counter for the current stream. */
  round: number;
  /** Minutes elapsed this stream (derived from clock − streamStartClock). */
  seconds: number;
  /** In-world clock when this stream went live (minutes since midnight). */
  streamStartClock: number;
  earnings: number;
  newFollowers: number;
  peak: number;
  /**
   * Per-stream repeat tracker for the dominant connection-tag of each action,
   * so spamming the same crowd-pleaser yields diminishing affinity. Reset every
   * stream (see resetSession).
   */
  connectionTagCounts: Record<string, number>;
  /** Extra anonymous viewers from raids this stream; folded into presence anon floor. */
  viewerSurge: number;
}

export interface EventChoice {
  label: string;
  /** Plain-language outcome shown after the choice resolves. */
  resolution: string;
  /** Metric deltas applied on choose. */
  effects: Partial<Metrics>;
}

export interface GameEvent {
  id: string;
  title: string;
  /** Player-facing body — starts as the seed, replaced by LLM narration. */
  description: string;
  /** The raw mechanical seed the LLM rewrites into bespoke prose. */
  narrationSeed: string;
  /** Visual accent for the modal. */
  tone: "neutral" | "good" | "creepy" | "danger";
  choices: EventChoice[];
  /** Optional bound character this event is about. */
  characterId?: string;
  /** Catalogue id of the trigger, for cooldowns + event memory. */
  triggerId?: string;
  /** When set, the player can also type a freeform response (LLM-judged). */
  allowFreeform?: boolean;
  /** Placeholder/hint shown in the freeform box. */
  freeformHint?: string;
  /**
   * When set, this "event" is not shown as a modal interrupt at all — it is
   * delivered as a real incoming DM into the sender's thread (plus a
   * notification). The string seeds, in plain language, what prompted the
   * message so the sender's opener can be written in-voice. The player then
   * replies in the DM panel, where the DM director owns any consequences.
   */
  deliverAsDm?: string;
  /**
   * When set, this "event" is not a modal — it's a passive donation. The amount
   * lands through the shared tip pipeline, a 💸 line shows in chat, and a toast
   * "dings". The player can follow up with the existing "Thank a supporter" action.
   */
  deliverAsTip?: number;
  /** Extra context handed to the LLM judge when resolving freeform. */
  stakes?: string;
}

/** A condensed record of a past event, for cooldowns + callback narration. */
export interface EventRecord {
  triggerId: string;
  title: string;
  day: number;
  /** The choice label the player picked (or "freeform"). */
  choice?: string;
  /** The resolution text shown. */
  resolution?: string;
}

/** Active activity sub-state (games, performances, custom streams, etc.). */
export type ActivityCategory = "game" | "performance" | "creative" | "chill" | "intimate";

export interface ActivityState {
  activityId: string;
  label: string;
  customText?: string;
  pleases: SegmentId[];
  narrationHint: string;
  chatHint: string;
  roundsPlayed: number;
  startedClock: number;
  category?: ActivityCategory;
}

/** A single line in a 1:1 direct-message conversation with a character. */
export interface DmLine {
  role: "me" | "them";
  text: string;
  kind?: "text" | "image" | "gift" | "system";
  imageId?: string;
  amount?: number;
  /** Links a system request line to structured ViewerRequest state. */
  requestId?: string;
}

export type RequestStatus = "open" | "fulfilled" | "dismissed";
export type RequestRewardType = "affinity" | "cash";

/** Structured viewer content request from a DM exchange. */
export interface ViewerRequest {
  id: string;
  charId: string;
  ask: string;
  status: RequestStatus;
  rewardType: RequestRewardType;
  rewardAmount?: number;
  createdDay: number;
  fulfilledDay?: number;
  evidence?: string;
}

export interface PendingVisit {
  charId: string;
  hint: string;
  day: number;
}

export interface VisitorSceneLine {
  role: "me" | "them" | "narrator" | "system";
  text: string;
}

export interface VisitorScene {
  charId: string;
  beats: number;
  transcript: string;
  relationshipScore: number;
  threatDelta: number;
  suggestedRelationship: "none" | "romantic" | "sexual" | "dominant" | "submissive" | "married";
  lines: VisitorSceneLine[];
}

export interface EventSceneLine {
  role: "me" | "narrator" | "system";
  text: string;
}

/** Active director-authored interactive event scene. */
export interface EventScene {
  title: string;
  tone: string;
  charId?: string;
  stakes?: string;
  beats: number;
  transcript: string;
  /** Record-only rollup for event memory; player-facing deltas use the feedback layer. */
  netEffects: Partial<Metrics>;
  lines: EventSceneLine[];
  imageId?: string;
  seed?: string;
}

/** LLM-scheduled emergent follow-up queued for a future day. */
export interface PendingEventSeed {
  id: string;
  day: number;
  seed: string;
  charId?: string;
}

export type UpgradeCategory = "gear" | "furniture" | "apartment";

export interface Upgrade {
  id: string;
  name: string;
  category: UpgradeCategory;
  cost: number;
  description: string;
  /** Multiplier/flat effects folded into the live model (see game/shop.ts). */
  effects: {
    viewerMult?: number;
    hypeMult?: number;
    incomeMult?: number;
    comfortPerDay?: number;
    rentPerDay?: number;
    /** Global production quality: lifts appeal for ALL segments (camera/mic/lighting). */
    productionQuality?: number;
    /** Targeted décor: passive baseline appeal for specific segments (lavalamp→cozy). */
    segmentAppeal?: Partial<Record<SegmentId, number>>;
  };
}
