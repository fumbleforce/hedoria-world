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
  /** 0-100 wellbeing; trolls/creeps lower it, rest raises it. */
  mood: number;
  /** 0-100 how far inside her comfort zone she is. Pushing boundaries lowers it. */
  comfort: number;
  day: number;
}

export interface StreamSession {
  isLive: boolean;
  /** Turn counter for the current stream. */
  round: number;
  seconds: number;
  earnings: number;
  newFollowers: number;
  peak: number;
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
  /** When this event belongs to a multi-step arc, its id. */
  arcId?: string;
  /** When resolving this event should advance/finish an arc. */
  advancesArc?: { id: string; kind: ArcKind };
  /** Extra context handed to the LLM judge when resolving freeform. */
  stakes?: string;
}

/** Kinds of multi-step story chains that span turns/days. */
export type ArcKind = "sponsorship" | "viral" | "stalker-legal";

/** A live multi-step chain: spawns follow-up events on later days. */
export interface StoryArc {
  id: string;
  kind: ArcKind;
  /** Which stage fires next (0-based index into the arc's stage list). */
  stage: number;
  /** Short label for logs/UI. */
  title: string;
  /** In-world day the next stage becomes eligible. */
  nextDay: number;
  /** Optional bound character (e.g. the stalker, the sponsor contact). */
  characterId?: string;
  /** Free-form per-arc payload (offer size, clip topic, …). */
  data?: Record<string, string | number>;
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

/** Active mini-game sub-state (set when the player starts a game at the desk). */
export interface PlayingState {
  gameId: string;
  roundsPlayed: number;
}

/** A single line in a 1:1 direct-message conversation with a character. */
export interface DmLine {
  role: "me" | "them";
  text: string;
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
    moodPerDay?: number;
    rentPerDay?: number;
  };
}
