import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ChatMessage,
  GameEvent,
  Metrics,
  Settings,
  StreamSession,
  StoryEntry,
  PlayingState,
  DmLine,
  CharacterVisual,
  EventRecord,
  PendingVisit,
  VisitorScene,
  EventScene,
  PendingEventSeed,
  FeedbackBubble,
  FeedbackTone,
  ChangeLogEntry,
} from "../game/types";
import { uid } from "../rng/rng";
import { SPAWN_ZONE, type ZoneId } from "../game/studio";
import { saveRoomImage } from "../persist/imageStore";
import { getActiveSlotId, updateActiveMeta } from "../persist/saves";
import { applyTheme } from "../ui/themes";
import { initialAudience, type AudienceState } from "../game/segments";
import type { CharacterSheet, Roster } from "../game/characters";
import { normalizeCharacter, normalizeRoster } from "../game/characters";
import { initialMastery, normalizeMastery, type MasteryState } from "../game/mastery";
import type { PromptId } from "../game/prompts";
import type { ActionOption } from "../game/actions";
import { WAKE_TIME } from "../game/time";
import type { LlmCallStat } from "../llm/types";

const MAX_CHAT = 140;
const MAX_STORY = 200;
const MAX_FEEDBACK = 30;
const MAX_CHANGELOG = 200;

/** Metrics that surface as floating feedback bubbles when they change. */
const FEEDBACK_METRICS = [
  "cash",
  "followers",
  "subscribers",
  "hype",
  "energy",
  "mood",
  "comfort",
] as const;
type FeedbackMetricKey = (typeof FEEDBACK_METRICS)[number];

/** Smallest change worth surfacing per metric (avoids float noise). */
const FEEDBACK_EPSILON: Record<FeedbackMetricKey, number> = {
  cash: 0.5,
  followers: 1,
  subscribers: 1,
  hype: 1,
  energy: 1,
  mood: 1,
  comfort: 1,
};

/**
 * Short-lived "why" context the controller sets right before a mutation so the
 * auto-diff bubbles/log lines can explain the cause. A plain module variable
 * (not React state) since it's read synchronously inside the store action and
 * cleared immediately after.
 */
let feedbackReason: { text?: string; tone?: FeedbackTone; log?: boolean } | null = null;

/** Set the reason context for the next metric/character mutation(s). */
export function setFeedbackContext(
  text: string | undefined,
  tone?: FeedbackTone,
  log = true,
): void {
  feedbackReason = { text, tone, log };
}
export function clearFeedbackContext(): void {
  feedbackReason = null;
}

function toneForMetric(key: FeedbackMetricKey, delta: number): FeedbackTone {
  // Every tracked metric reads "up = good" except none here invert; large drops
  // in wellbeing stats lean warn.
  if (delta > 0) return "good";
  if (key === "energy" || key === "mood" || key === "comfort") return "warn";
  return "bad";
}

const initialMetrics = (): Metrics => ({
  cash: 250,
  followers: 35,
  subscribers: 1,
  currentViewers: 0,
  peakViewers: 0,
  hype: 20,
  energy: 100,
  mood: 70,
  comfort: 90,
  day: 1,
});

const initialSession = (): StreamSession => ({
  isLive: false,
  round: 0,
  seconds: 0,
  streamStartClock: 0,
  earnings: 0,
  newFollowers: 0,
  peak: 0,
  connectionTagCounts: {},
});

const initialSettings = (): Settings => ({
  streamerName: "Abby",
  streamerPersona:
    "A bubbly variety streamer in her early 20s trying to make rent and go full-time. Quick-witted, a little shy, warms up to chat.",
  gender: "female",
  theme: "limelight",
  contentTier: "flirty",
  customSteering: "",
  niche: "variety",
  outfit: "casual",
  textBackend: "mock",
  geminiModel: "gemini-2.5-flash",
  openRouterModel: "google/gemini-2.5-flash",
  tieredModels: false,
  geminiFastModel: "gemini-2.5-flash-lite",
  openRouterFastModel: "google/gemini-2.5-flash-lite",
  selfConsistency: true,
  streamReplies: true,
  streamerBirthday: "",
  geminiImageModel: "gemini-2.5-flash-image",
  openRouterImageModel: "google/gemini-2.5-flash-image",
  imageStylePreset: "cozy-neon",
  imageStyle: "",
  roomPrompt: "",
  portraitPrompt: "",
  bodyPrompt: "",
  presencePrompt: "",
  scenePrompt: "",
  consoleLevel: "debug",
});

export interface ActionMenu {
  title: string;
  subtitle?: string;
  options: ActionOption[];
  allowFreeform: boolean;
}

/** Tabs in the unified Settings modal. */
export type SettingsTab = "general" | "prompts" | "room" | "character" | "gallery" | "saves" | "llm" | "dev";

export interface StoreState {
  booted: boolean;
  metrics: Metrics;
  session: StreamSession;
  settings: Settings;
  audience: AudienceState;
  /** All named characters known to the game (persisted). */
  roster: Roster;
  /** In-world clock in minutes since midnight. */
  clock: number;
  chat: ChatMessage[];
  story: StoryEntry[];
  pendingEvent: GameEvent | null;
  actionMenu: ActionMenu | null;
  resolving: boolean;
  /** Active mini-game, or null. */
  playing: PlayingState | null;
  /** Character zone position. */
  zone: ZoneId;
  /** Generated room background (data URL), or null for the SVG default. */
  roomImage: string | null;
  /** True while a room image is being generated. */
  generatingRoom: boolean;

  /** Player character visual identity (description + portrait/body image ids). */
  character: CharacterVisual;
  /** Per-zone presence image ids (the character placed in each zone). */
  presenceImages: Partial<Record<ZoneId, string>>;
  /** In-memory cache of image id -> data URL, hydrated from IndexedDB. */
  imageCache: Record<string, string>;
  /** In-memory style-preset preview thumbnails (presetId -> data URL). */
  stylePreviews: Record<string, string>;
  /** Most recently generated/seen image id — shown center-stage. */
  lastImageId: string | null;
  /** Label of the image job currently running (null = idle). */
  imageBusy: string | null;

  // transient UI
  gamePickerOpen: boolean;
  /** Character id whose detail/DM panel is open. */
  openCharId: string | null;
  /** Persistent 1:1 DM history, keyed by character id. */
  dmThreads: Record<string, DmLine[]>;
  /** Count of unseen inbound DM lines per character id (cleared when opened). */
  unreadDms: Record<string, number>;
  dmBusy: boolean;
  /** Character id whose portrait is currently being generated, or null. */
  portraitBusyId: string | null;
  shopOpen: boolean;
  inventoryOpen: boolean;
  settingsOpen: boolean;
  /** Active tab in the Settings modal. */
  settingsTab: SettingsTab;

  eventLog: string[];
  ownedUpgrades: string[];
  promptOverrides: Partial<Record<PromptId, string>>;
  toast: string | null;
  /** Persisted experience/mastery XP per skill domain (personal progression). */
  mastery: MasteryState;
  /** Per-content freshness 0..1 (drains on repeats, recovers on rest/variety). */
  contentNovelty: Record<string, number>;
  /** Transient floating feedback bubbles (not persisted). */
  feedback: FeedbackBubble[];
  /** Scrollable activity log of every metric/affinity/alert change (not persisted). */
  changeLog: ChangeLogEntry[];

  /** Condensed history of recent events (cooldowns + callback narration). */
  recentEvents: EventRecord[];
  /** Ids of soft objectives the player has already achieved. */
  completedGoals: string[];
  /** Whether the goals panel is open. */
  goalsOpen: boolean;
  /** Whether the calendar modal is open. */
  calendarOpen: boolean;
  /** DM-triggered IRL visits waiting to fire at the door. */
  pendingVisits: PendingVisit[];
  /** Active in-person guest scene, if one is currently playing out. */
  visitor: VisitorScene | null;
  /** Active director-authored interactive event scene. */
  eventScene: EventScene | null;
  /** LLM-scheduled emergent follow-ups waiting for their day. */
  pendingEventSeeds: PendingEventSeed[];
  /** In-memory LLM call telemetry for Settings → LLM (session-only, not saved). */
  llmStats: LlmCallStat[];

  setBooted: (b: boolean) => void;
  patchMetrics: (patch: Partial<Metrics>) => void;
  setAudience: (a: AudienceState) => void;
  setClock: (minutes: number) => void;
  setSession: (patch: Partial<StreamSession>) => void;
  resetSession: () => void;
  pushChat: (msgs: ChatMessage[]) => void;
  clearChat: () => void;
  pushStory: (entry: Omit<StoryEntry, "id" | "ts">) => void;
  editStory: (id: string, text: string) => void;
  deleteStory: (id: string) => void;
  setPendingEvent: (e: GameEvent | null) => void;
  setActionMenu: (m: ActionMenu | null) => void;
  setResolving: (b: boolean) => void;
  setPlaying: (p: PlayingState | null) => void;
  setZone: (z: ZoneId) => void;
  setRoomImage: (url: string | null) => void;
  setGeneratingRoom: (b: boolean) => void;

  setCharacter: (patch: Partial<CharacterVisual>) => void;
  setPresenceImage: (zone: ZoneId, imageId: string | null) => void;
  clearPresenceImages: () => void;
  cacheImage: (id: string, dataUrl: string) => void;
  uncacheImage: (id: string) => void;
  setStylePreview: (presetId: string, dataUrl: string) => void;
  setLastImage: (id: string | null) => void;
  setImageBusy: (label: string | null) => void;

  upsertCharacter: (c: CharacterSheet) => void;
  patchCharacter: (id: string, patch: Partial<CharacterSheet>) => void;
  setRoster: (r: Roster) => void;

  setGamePickerOpen: (b: boolean) => void;
  openCharacter: (id: string | null) => void;
  pushDm: (charId: string, line: DmLine) => void;
  /** Replace the text of the most recent line in a thread (for streaming). */
  updateLastDm: (charId: string, text: string) => void;
  /** Flag a thread as having a new unseen inbound message. */
  markDmUnread: (charId: string) => void;
  /** Clear the unseen flag for a thread (called when the panel is opened). */
  clearDmUnread: (charId: string) => void;
  setDmBusy: (b: boolean) => void;
  setPortraitBusy: (id: string | null) => void;
  setShopOpen: (b: boolean) => void;
  setInventoryOpen: (b: boolean) => void;
  setSettingsOpen: (b: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  /** Open the Settings modal directly on a given tab. */
  openSettings: (tab?: SettingsTab) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setPromptOverride: (id: PromptId, body: string | null) => void;
  logEvent: (line: string) => void;
  addUpgrade: (id: string) => void;
  setToast: (t: string | null) => void;
  /** Add XP to one or more mastery domains. */
  addMasteryXp: (delta: Partial<MasteryState>) => void;
  /** Set the freshness (0..1) of a content key. */
  setNovelty: (key: string, value: number) => void;
  /** Push one or more feedback bubbles (coalesces same channel+key within a beat). */
  pushFeedback: (bubbles: FeedbackBubble[]) => void;
  /** Remove expired bubbles by id. */
  expireFeedback: (ids: string[]) => void;

  pushEventRecord: (rec: EventRecord) => void;
  completeGoal: (id: string) => void;
  setGoalsOpen: (b: boolean) => void;
  setCalendarOpen: (b: boolean) => void;
  addPendingVisit: (visit: PendingVisit) => void;
  clearPendingVisit: (charId: string) => void;
  startVisitor: (scene: VisitorScene) => void;
  pushVisitorLine: (line: VisitorScene["lines"][number]) => void;
  patchVisitor: (patch: Partial<VisitorScene>) => void;
  endVisitor: () => void;
  startEventScene: (scene: EventScene) => void;
  pushEventSceneLine: (line: EventScene["lines"][number]) => void;
  patchEventScene: (patch: Partial<EventScene>) => void;
  endEventScene: () => void;
  addPendingEventSeed: (seed: PendingEventSeed) => void;
  removePendingEventSeed: (id: string) => void;
}

const MAX_EVENT_MEMORY = 14;

let storySeq = 0;

function parseStorySeq(id: string): number {
  const n = Number.parseInt(id.replace(/^st-/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function maxStorySeqFromEntries(story: StoryEntry[]): number {
  return story.reduce((max, e) => Math.max(max, parseStorySeq(e.id)), 0);
}

/** Keep the module counter in sync with persisted / in-memory story ids. */
function syncStorySeq(story: StoryEntry[]): void {
  const max = maxStorySeqFromEntries(story);
  if (max > storySeq) storySeq = max;
}

/** Next id always clears the highest existing st-N (survives HMR and rehydrate races). */
function nextStoryIdFromStory(story: StoryEntry[]): string {
  const next = Math.max(storySeq, maxStorySeqFromEntries(story)) + 1;
  storySeq = next;
  return `st-${next}`;
}

/** Drop duplicate ids from older saves or a reset storySeq counter. */
function dedupeStoryEntries(story: StoryEntry[]): StoryEntry[] {
  const seen = new Set<string>();
  return story.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      booted: false,
      metrics: initialMetrics(),
      session: initialSession(),
      settings: initialSettings(),
      audience: initialAudience(),
      roster: {},
      clock: WAKE_TIME,
      chat: [],
      story: [],
      pendingEvent: null,
      actionMenu: null,
      resolving: false,
      playing: null,
      zone: SPAWN_ZONE,
      roomImage: null,
      generatingRoom: false,

      character: { description: "", portraitId: null, bodyId: null },
      presenceImages: {},
      imageCache: {},
      stylePreviews: {},
      lastImageId: null,
      imageBusy: null,

      gamePickerOpen: false,
      openCharId: null,
      dmThreads: {},
      unreadDms: {},
      dmBusy: false,
      portraitBusyId: null,
      shopOpen: false,
      inventoryOpen: false,
      settingsOpen: false,
      settingsTab: "general",

      eventLog: [],
      ownedUpgrades: [],
      promptOverrides: {},
      toast: null,
      mastery: initialMastery(),
      contentNovelty: {},
      feedback: [],
      changeLog: [],

      recentEvents: [],
      completedGoals: [],
      goalsOpen: false,
      calendarOpen: false,
      pendingVisits: [],
      visitor: null,
      eventScene: null,
      pendingEventSeeds: [],
      llmStats: [],

      setBooted: (booted) => set({ booted }),
      patchMetrics: (patch) =>
        set((s) => {
          const m = { ...s.metrics, ...patch };
          m.cash = Math.round(m.cash * 100) / 100;
          m.hype = clamp(m.hype, 0, 100);
          m.energy = clamp(m.energy, 0, 100);
          m.mood = clamp(m.mood, 0, 100);
          m.comfort = clamp(m.comfort, 0, 100);
          m.followers = Math.max(0, Math.round(m.followers));
          m.subscribers = Math.max(0, Math.round(m.subscribers));
          m.currentViewers = Math.max(0, Math.round(m.currentViewers));
          m.peakViewers = Math.max(m.peakViewers, m.currentViewers);
          if (m.day !== s.metrics.day) updateActiveMeta({ day: m.day });
          // Auto-capture: surface every meaningful metric change as a bubble.
          const bubbles = diffMetricBubbles(s.metrics, m);
          const next: Partial<StoreState> = { metrics: m };
          if (bubbles.length) {
            next.feedback = mergeFeedback(s.feedback, bubbles);
            const log = feedbackReason?.log !== false ? logLinesFor(bubbles) : [];
            if (log.length) next.eventLog = [...log, ...s.eventLog].slice(0, 50);
            next.changeLog = appendChangeLog(
              s.changeLog,
              bubbles.map((b) => metricChangeEntry(b, m.day)),
            );
          }
          return next;
        }),
      setAudience: (audience) => set({ audience }),
      setClock: (clock) => set({ clock }),
      setSession: (patch) => set((s) => ({ session: { ...s.session, ...patch } })),
      resetSession: () => set({ session: initialSession() }),
      pushChat: (msgs) =>
        set((s) => {
          // Drop near-duplicates (same user + text) seen anywhere in the recent
          // window, not just the immediately preceding line — the chat model
          // tends to re-echo earlier reactions a beat or two later, so a simple
          // consecutive check misses "here we go" bouncing back after one line.
          const next = [...s.chat];
          const DEDUP_WINDOW = 16;
          const seen = new Set<string>(
            next.slice(-DEDUP_WINDOW).map((m) => `${m.user}\u0000${m.text}`),
          );
          for (const m of msgs) {
            const key = `${m.user}\u0000${m.text}`;
            if (m.kind !== "system" && seen.has(key)) continue;
            if (m.kind !== "system") seen.add(key);
            next.push(m);
          }
          return { chat: next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next };
        }),
      clearChat: () => set({ chat: [] }),
      pushStory: (entry) =>
        set((s) => {
          const base = dedupeStoryEntries(s.story);
          const id = nextStoryIdFromStory(base);
          const next = [...base, { id, ts: Date.now(), ...entry }];
          return { story: next.length > MAX_STORY ? next.slice(next.length - MAX_STORY) : next };
        }),
      editStory: (id, text) =>
        set((s) => ({
          story: s.story.map((e) => (e.id === id ? { ...e, text, edited: true } : e)),
        })),
      deleteStory: (id) => set((s) => ({ story: s.story.filter((e) => e.id !== id) })),
      setPendingEvent: (pendingEvent) => set({ pendingEvent }),
      setActionMenu: (actionMenu) => set({ actionMenu }),
      setResolving: (resolving) => set({ resolving }),
      setPlaying: (playing) => set({ playing }),
      setZone: (zone) => set({ zone }),
      setRoomImage: (roomImage) => {
        set({ roomImage });
        void saveRoomImage(getActiveSlotId(), roomImage); // large blob → IndexedDB, not localStorage
      },
      setGeneratingRoom: (generatingRoom) => set({ generatingRoom }),

      setCharacter: (patch) =>
        set((s) => {
          if ("portraitId" in patch) updateActiveMeta({ portraitId: patch.portraitId ?? null });
          return { character: { ...s.character, ...patch } };
        }),
      setPresenceImage: (zone, imageId) =>
        set((s) => {
          const next = { ...s.presenceImages };
          if (imageId) next[zone] = imageId;
          else delete next[zone];
          return { presenceImages: next };
        }),
      clearPresenceImages: () => set({ presenceImages: {} }),
      cacheImage: (id, dataUrl) => set((s) => ({ imageCache: { ...s.imageCache, [id]: dataUrl } })),
      setStylePreview: (presetId, dataUrl) =>
        set((s) => ({ stylePreviews: { ...s.stylePreviews, [presetId]: dataUrl } })),
      uncacheImage: (id) =>
        set((s) => {
          const patch: Partial<StoreState> = {};
          if (id in s.imageCache) {
            const next = { ...s.imageCache };
            delete next[id];
            patch.imageCache = next;
          }
          if (s.lastImageId === id) patch.lastImageId = null;
          return patch;
        }),
      setLastImage: (lastImageId) => set({ lastImageId }),
      setImageBusy: (imageBusy) => set({ imageBusy }),

      upsertCharacter: (c) => set((s) => ({ roster: { ...s.roster, [c.id]: normalizeCharacter(c) } })),
      patchCharacter: (id, patch) =>
        set((s) => {
          const cur = s.roster[id];
          if (!cur) return s;
          const updated = normalizeCharacter({ ...cur, ...patch });
          const out: Partial<StoreState> = { roster: { ...s.roster, [id]: updated } };
          // Auto-capture affinity changes as a character-channel bubble.
          if (typeof patch.affinity === "number") {
            const delta = updated.affinity - cur.affinity;
            if (Math.abs(delta) >= 0.05) {
              const bubble: FeedbackBubble = {
                id: uid("fb"),
                channel: "character",
                key: id,
                delta,
                tone: delta >= 0 ? "good" : "warn",
                reason: feedbackReason?.text,
                ts: Date.now(),
              };
              out.feedback = mergeFeedback(s.feedback, [bubble]);
              const who = updated.displayName || updated.handle;
              out.changeLog = appendChangeLog(s.changeLog, [
                {
                  id: uid("cl"),
                  ts: bubble.ts,
                  channel: "character",
                  label: who,
                  delta,
                  unit: "affinity",
                  tone: bubble.tone,
                  reason: bubble.reason,
                  day: s.metrics.day,
                },
              ]);
              if (feedbackReason?.text && feedbackReason.log !== false) {
                out.eventLog = [`${who}: ${feedbackReason.text}`, ...s.eventLog].slice(0, 50);
              }
            }
          }
          return out;
        }),
      setRoster: (roster) => set({ roster }),

      setGamePickerOpen: (gamePickerOpen) => set({ gamePickerOpen }),
      openCharacter: (openCharId) => set({ openCharId }),
      pushDm: (charId, line) =>
        set((s) => ({
          dmThreads: { ...s.dmThreads, [charId]: [...(s.dmThreads[charId] ?? []), line] },
        })),
      updateLastDm: (charId, text) =>
        set((s) => {
          const thread = s.dmThreads[charId];
          if (!thread?.length) return s;
          const next = thread.slice();
          next[next.length - 1] = { ...next[next.length - 1], text };
          return { dmThreads: { ...s.dmThreads, [charId]: next } };
        }),
      markDmUnread: (charId) =>
        set((s) => ({ unreadDms: { ...s.unreadDms, [charId]: (s.unreadDms[charId] ?? 0) + 1 } })),
      clearDmUnread: (charId) =>
        set((s) => {
          if (!(charId in s.unreadDms)) return s;
          const next = { ...s.unreadDms };
          delete next[charId];
          return { unreadDms: next };
        }),
      setDmBusy: (dmBusy) => set({ dmBusy }),
      setPortraitBusy: (portraitBusyId) => set({ portraitBusyId }),
      setShopOpen: (shopOpen) => set({ shopOpen }),
      setInventoryOpen: (inventoryOpen) => set({ inventoryOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSettingsTab: (settingsTab) => set({ settingsTab }),
      openSettings: (tab) => set(tab ? { settingsOpen: true, settingsTab: tab } : { settingsOpen: true }),
      setSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
        if (patch.theme) applyTheme(patch.theme);
        if (patch.streamerName !== undefined) updateActiveMeta({ characterName: patch.streamerName });
      },
      setPromptOverride: (id, body) =>
        set((s) => {
          const next = { ...s.promptOverrides };
          if (body === null || body.trim() === "") delete next[id];
          else next[id] = body;
          return { promptOverrides: next };
        }),
      logEvent: (line) => set((s) => ({ eventLog: [line, ...s.eventLog].slice(0, 50) })),
      addUpgrade: (id) =>
        set((s) => (s.ownedUpgrades.includes(id) ? s : { ownedUpgrades: [...s.ownedUpgrades, id] })),
      setToast: (toast) => set({ toast }),
      addMasteryXp: (delta) =>
        set((s) => {
          const next = { ...s.mastery };
          let changed = false;
          for (const [k, v] of Object.entries(delta) as [keyof MasteryState, number][]) {
            if (v) {
              next[k] = (next[k] ?? 0) + v;
              changed = true;
            }
          }
          return changed ? { mastery: next } : s;
        }),
      setNovelty: (key, value) =>
        set((s) => ({ contentNovelty: { ...s.contentNovelty, [key]: clamp(value, 0, 1) } })),
      pushFeedback: (bubbles) =>
        set((s) =>
          bubbles.length
            ? {
                feedback: mergeFeedback(s.feedback, bubbles),
                changeLog: appendChangeLog(
                  s.changeLog,
                  bubbles.map((b) => ({
                    id: uid("cl"),
                    ts: b.ts,
                    channel: b.channel,
                    label: b.text ?? b.key,
                    delta: b.delta,
                    unit: b.key === "cash" ? "cash" : "count",
                    text: b.text,
                    tone: b.tone,
                    reason: b.reason,
                    day: s.metrics.day,
                  })),
                ),
              }
            : s,
        ),
      expireFeedback: (ids) =>
        set((s) => {
          if (!ids.length) return s;
          const drop = new Set(ids);
          return { feedback: s.feedback.filter((b) => !drop.has(b.id)) };
        }),

      pushEventRecord: (rec) =>
        set((s) => ({ recentEvents: [...s.recentEvents, rec].slice(-MAX_EVENT_MEMORY) })),
      completeGoal: (id) =>
        set((s) => (s.completedGoals.includes(id) ? s : { completedGoals: [...s.completedGoals, id] })),
      setGoalsOpen: (goalsOpen) => set({ goalsOpen }),
      setCalendarOpen: (calendarOpen) => set({ calendarOpen }),
      addPendingVisit: (visit) =>
        set((s) => {
          const next = [...s.pendingVisits.filter((v) => v.charId !== visit.charId), visit];
          return { pendingVisits: next };
        }),
      clearPendingVisit: (charId) =>
        set((s) => ({ pendingVisits: s.pendingVisits.filter((v) => v.charId !== charId) })),
      startVisitor: (visitor) => set({ visitor }),
      pushVisitorLine: (line) =>
        set((s) =>
          s.visitor
            ? { visitor: { ...s.visitor, lines: [...s.visitor.lines, line] } }
            : s,
        ),
      patchVisitor: (patch) =>
        set((s) => (s.visitor ? { visitor: { ...s.visitor, ...patch } } : s)),
      endVisitor: () => set({ visitor: null }),
      startEventScene: (eventScene) => set({ eventScene }),
      pushEventSceneLine: (line) =>
        set((s) =>
          s.eventScene
            ? { eventScene: { ...s.eventScene, lines: [...s.eventScene.lines, line] } }
            : s,
        ),
      patchEventScene: (patch) =>
        set((s) => (s.eventScene ? { eventScene: { ...s.eventScene, ...patch } } : s)),
      endEventScene: () => set({ eventScene: null }),
      addPendingEventSeed: (seed) =>
        set((s) => ({ pendingEventSeeds: [...s.pendingEventSeeds, seed] })),
      removePendingEventSeed: (id) =>
        set((s) => ({ pendingEventSeeds: s.pendingEventSeeds.filter((p) => p.id !== id) })),
    }),
    {
      name: "limelight-save-v3",
      skipHydration: true,
      // Deep-merge `settings` so saves made before a new setting existed still
      // get its default (otherwise the persisted object replaces the defaults
      // wholesale and new fields come back `undefined`).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StoreState>;
        const story = Array.isArray(p.story) ? dedupeStoryEntries(p.story) : current.story;
        const roster = p.roster ? normalizeRoster(p.roster) : current.roster;
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
          mastery: normalizeMastery(p.mastery),
          contentNovelty: p.contentNovelty ?? {},
          story,
          roster,
        };
      },
      partialize: (s) => ({
        metrics: s.metrics,
        // The live session (isLive flag + round/earnings/peak totals) must
        // survive a reload — boot calls controller.resumeLive() to rebuild the
        // transient audience/presence/ambient loop around it.
        session: s.session,
        settings: s.settings,
        ownedUpgrades: s.ownedUpgrades,
        promptOverrides: s.promptOverrides,
        mastery: s.mastery,
        contentNovelty: s.contentNovelty,
        eventLog: s.eventLog,
        recentEvents: s.recentEvents,
        completedGoals: s.completedGoals,
        pendingVisits: s.pendingVisits,
        visitor: s.visitor,
        eventScene: s.eventScene,
        pendingEventSeeds: s.pendingEventSeeds,
        roomImage: s.roomImage,
        dmThreads: s.dmThreads,
        unreadDms: s.unreadDms,
        // Visible logs: the stream chat and the story/narrator feed (with the
        // player's actions and their outcomes) must survive a reload.
        chat: s.chat,
        story: s.story,
        clock: s.clock,
        zone: s.zone,
        // Only the small ids persist here; the large blobs live in IndexedDB.
        character: s.character,
        presenceImages: s.presenceImages,
        lastImageId: s.lastImageId,
        // Persist the roster so relationships/memories survive — but strip
        // transient online flags on rehydrate (handled at boot).
        roster: s.roster,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.settings?.theme) applyTheme(state.settings.theme);
        if (state?.story?.length) syncStorySeq(state.story);
      },
    },
  ),
);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Build feedback bubbles from a metric change, honoring the reason context. */
function diffMetricBubbles(prev: Metrics, next: Metrics): FeedbackBubble[] {
  const out: FeedbackBubble[] = [];
  for (const key of FEEDBACK_METRICS) {
    const delta = next[key] - prev[key];
    if (Math.abs(delta) < FEEDBACK_EPSILON[key]) continue;
    out.push({
      id: uid("fb"),
      channel: "metric",
      key,
      delta,
      tone: feedbackReason?.tone ?? toneForMetric(key, delta),
      reason: feedbackReason?.text,
      ts: Date.now(),
    });
  }
  return out;
}

const FEEDBACK_LABEL: Record<FeedbackMetricKey, string> = {
  cash: "Cash",
  followers: "Followers",
  subscribers: "Subs",
  hype: "Hype",
  energy: "Energy",
  mood: "Mood",
  comfort: "Comfort",
};

/** Turn a metric bubble into a structured activity-log entry. */
function metricChangeEntry(b: FeedbackBubble, day: number): ChangeLogEntry {
  return {
    id: uid("cl"),
    ts: b.ts,
    channel: "metric",
    label: FEEDBACK_LABEL[b.key as FeedbackMetricKey] ?? b.key,
    delta: b.delta,
    unit: b.key === "cash" ? "cash" : "count",
    tone: b.tone,
    reason: b.reason,
    day,
  };
}

/** Prepend new entries (newest first) and cap the activity log. */
function appendChangeLog(current: ChangeLogEntry[], incoming: ChangeLogEntry[]): ChangeLogEntry[] {
  if (!incoming.length) return current;
  const next = [...incoming.reverse(), ...current];
  return next.length > MAX_CHANGELOG ? next.slice(0, MAX_CHANGELOG) : next;
}

/** Event-log lines for reasoned metric bubbles ("Cash +$12 · sub payout"). */
function logLinesFor(bubbles: FeedbackBubble[]): string[] {
  const out: string[] = [];
  for (const b of bubbles) {
    if (!b.reason || b.channel !== "metric" || b.delta == null) continue;
    const label = FEEDBACK_LABEL[b.key as FeedbackMetricKey] ?? b.key;
    const sign = b.delta >= 0 ? "+" : "";
    const amount = b.key === "cash" ? `${sign}$${Math.abs(b.delta).toFixed(0)}` : `${sign}${Math.round(b.delta)}`;
    out.push(`${label} ${amount} · ${b.reason}`);
  }
  return out;
}

/**
 * Append bubbles, coalescing with a recent bubble of the same channel+key (so a
 * beat that nudges cash five times shows one running total, not five fragments).
 */
function mergeFeedback(current: FeedbackBubble[], incoming: FeedbackBubble[]): FeedbackBubble[] {
  const COALESCE_MS = 700;
  const next = [...current];
  for (const b of incoming) {
    const idx = next.findIndex(
      (e) => e.channel === b.channel && e.key === b.key && b.ts - e.ts < COALESCE_MS,
    );
    if (idx >= 0 && b.delta != null && next[idx].delta != null) {
      const merged = { ...next[idx], delta: next[idx].delta! + b.delta, ts: b.ts };
      if (b.reason) merged.reason = b.reason;
      merged.tone = b.tone;
      next[idx] = merged;
    } else {
      next.push(b);
    }
  }
  return next.length > MAX_FEEDBACK ? next.slice(next.length - MAX_FEEDBACK) : next;
}
