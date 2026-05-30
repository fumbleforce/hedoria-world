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
} from "../game/types";
import { SPAWN_ZONE, type ZoneId } from "../game/studio";
import { saveRoomImage } from "../persist/imageStore";
import { getActiveSlotId, updateActiveMeta } from "../persist/saves";
import { applyTheme } from "../ui/themes";
import { initialAudience, type AudienceState } from "../game/segments";
import type { CharacterSheet, Roster } from "../game/characters";
import type { PromptId } from "../game/prompts";
import type { ActionOption } from "../game/actions";
import { STREAM_START } from "../game/time";

const MAX_CHAT = 140;
const MAX_STORY = 200;

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
  earnings: 0,
  newFollowers: 0,
  peak: 0,
});

const initialSettings = (): Settings => ({
  streamerName: "Abby",
  streamerPersona:
    "A bubbly variety streamer in her early 20s trying to make rent and go full-time. Quick-witted, a little shy, warms up to chat.",
  gender: "female",
  theme: "limelight",
  contentTier: "flirty",
  customSteering: "",
  textBackend: "mock",
  geminiModel: "gemini-2.5-flash",
  openRouterModel: "google/gemini-2.5-flash",
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
export type SettingsTab = "general" | "prompts" | "room" | "character" | "gallery" | "saves";

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
  dmBusy: boolean;
  /** Character id whose portrait is currently being generated, or null. */
  portraitBusyId: string | null;
  shopOpen: boolean;
  settingsOpen: boolean;
  /** Active tab in the Settings modal. */
  settingsTab: SettingsTab;

  eventLog: string[];
  ownedUpgrades: string[];
  promptOverrides: Partial<Record<PromptId, string>>;
  toast: string | null;

  setBooted: (b: boolean) => void;
  patchMetrics: (patch: Partial<Metrics>) => void;
  setAudience: (a: AudienceState) => void;
  setClock: (minutes: number) => void;
  setSession: (patch: Partial<StreamSession>) => void;
  resetSession: () => void;
  pushChat: (msgs: ChatMessage[]) => void;
  clearChat: () => void;
  pushStory: (entry: Omit<StoryEntry, "id" | "ts">) => void;
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
  setLastImage: (id: string | null) => void;
  setImageBusy: (label: string | null) => void;

  upsertCharacter: (c: CharacterSheet) => void;
  patchCharacter: (id: string, patch: Partial<CharacterSheet>) => void;
  setRoster: (r: Roster) => void;

  setGamePickerOpen: (b: boolean) => void;
  openCharacter: (id: string | null) => void;
  pushDm: (charId: string, line: DmLine) => void;
  setDmBusy: (b: boolean) => void;
  setPortraitBusy: (id: string | null) => void;
  setShopOpen: (b: boolean) => void;
  setSettingsOpen: (b: boolean) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  /** Open the Settings modal directly on a given tab. */
  openSettings: (tab?: SettingsTab) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setPromptOverride: (id: PromptId, body: string | null) => void;
  logEvent: (line: string) => void;
  addUpgrade: (id: string) => void;
  setToast: (t: string | null) => void;
}

let storySeq = 0;
const nextStoryId = () => `st-${(storySeq += 1)}`;

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      booted: false,
      metrics: initialMetrics(),
      session: initialSession(),
      settings: initialSettings(),
      audience: initialAudience(),
      roster: {},
      clock: STREAM_START,
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
      lastImageId: null,
      imageBusy: null,

      gamePickerOpen: false,
      openCharId: null,
      dmThreads: {},
      dmBusy: false,
      portraitBusyId: null,
      shopOpen: false,
      settingsOpen: false,
      settingsTab: "general",

      eventLog: [],
      ownedUpgrades: [],
      promptOverrides: {},
      toast: null,

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
          return { metrics: m };
        }),
      setAudience: (audience) => set({ audience }),
      setClock: (clock) => set({ clock }),
      setSession: (patch) => set((s) => ({ session: { ...s.session, ...patch } })),
      resetSession: () => set({ session: initialSession() }),
      pushChat: (msgs) =>
        set((s) => {
          // Drop consecutive duplicates (same user + text) — overlapping ambient
          // bursts and the go-live burst can otherwise echo the same greeting.
          const next = [...s.chat];
          for (const m of msgs) {
            const last = next[next.length - 1];
            if (last && last.user === m.user && last.text === m.text && m.kind !== "system") continue;
            next.push(m);
          }
          return { chat: next.length > MAX_CHAT ? next.slice(next.length - MAX_CHAT) : next };
        }),
      clearChat: () => set({ chat: [] }),
      pushStory: (entry) =>
        set((s) => {
          const next = [...s.story, { id: nextStoryId(), ts: Date.now(), ...entry }];
          return { story: next.length > MAX_STORY ? next.slice(next.length - MAX_STORY) : next };
        }),
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

      upsertCharacter: (c) => set((s) => ({ roster: { ...s.roster, [c.id]: c } })),
      patchCharacter: (id, patch) =>
        set((s) => {
          const cur = s.roster[id];
          if (!cur) return s;
          return { roster: { ...s.roster, [id]: { ...cur, ...patch } } };
        }),
      setRoster: (roster) => set({ roster }),

      setGamePickerOpen: (gamePickerOpen) => set({ gamePickerOpen }),
      openCharacter: (openCharId) => set({ openCharId }),
      pushDm: (charId, line) =>
        set((s) => ({
          dmThreads: { ...s.dmThreads, [charId]: [...(s.dmThreads[charId] ?? []), line] },
        })),
      setDmBusy: (dmBusy) => set({ dmBusy }),
      setPortraitBusy: (portraitBusyId) => set({ portraitBusyId }),
      setShopOpen: (shopOpen) => set({ shopOpen }),
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
    }),
    {
      name: "limelight-save-v3",
      skipHydration: true,
      // Deep-merge `settings` so saves made before a new setting existed still
      // get its default (otherwise the persisted object replaces the defaults
      // wholesale and new fields come back `undefined`).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StoreState>;
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
        };
      },
      partialize: (s) => ({
        metrics: s.metrics,
        settings: s.settings,
        ownedUpgrades: s.ownedUpgrades,
        promptOverrides: s.promptOverrides,
        eventLog: s.eventLog,
        roomImage: s.roomImage,
        dmThreads: s.dmThreads,
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
      },
    },
  ),
);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
