import { create } from "zustand";
import type { CombatState } from "../rules/combat/tickModel";
import type { TileGrid } from "../grid/tilePrimitives";
import type { TileImageMode } from "../grid/tileImageCache";
import type { PackInfo } from "../world/loader";
import {
  defaultGeminiImageModel,
  defaultGeminiTextModel,
  normalizeGeminiTextModel,
} from "../llm/geminiModelOptions";
import {
  DEFAULT_OPENROUTER_IMAGE_MODEL,
  DEFAULT_OPENROUTER_TEXT_MODEL,
} from "../llm/openRouterDefaults";

/**
 * The single Zustand store for the engine. The store contains the
 * "running game" state — anything the renderer reads to draw a frame, and
 * anything tool calls mutate. Persistent things (Dexie rows, transcripts,
 * tile grids, tile images) live in IndexedDB and are read through their
 * own caches; the store only carries pointers (saveId, currentRegionId)
 * and hot copies of the active grids.
 */

export type Mode = "region" | "location" | "scene";

/** Which HTTP API handles text or image LLM calls (per store; no reload). */
export type LlmBackend = "gemini" | "openrouter";

export type EngagementState = "idle" | "engaged" | "locked";

/**
 * Authored world NPCs are always `character` (one per card, from pack data).
 * LLM-spawned encounters are `party`: alone (1 id), or 2–3 ids, or empty npcIds
 * for an anonymous band (merchants, thieves, guards) named via `name`/`summary`.
 */
export type EngagementKind = "character" | "party";

export type EngagementGroup = {
  /** Stable id used by tool calls (e.g. "bandit-camp-3"). */
  id: string;
  /** Human label for UI cards. */
  name: string;
  /** NPC ids drawn from the world. May be empty for crowd-style groups. */
  npcIds: string[];
  state: EngagementState;
  /** Optional one-line summary the dispatcher shows in the engagement card. */
  summary?: string;
  /** Omitted or `"party"` = procedural party; `"character"` = authored standalone. */
  kind?: EngagementKind;
};

export type Engagement = {
  /** Map of groupId -> group state. */
  groups: Record<string, EngagementGroup>;
  /**
   * If non-empty, no group can be `disengage`d (the player is locked in
   * the scene). The reason is surfaced to the player verbatim.
   */
  lockReason?: string;
};

export type DialogueMessage = {
  role: "player" | "npc" | "system";
  text: string;
  /** Optional NPC id if the line was spoken by a specific NPC. */
  npcId?: string;
};

/**
 * A single entry in the persistent narration log shown on the left rail.
 * Every player action and every narrator response produces one or more
 * StoryEntries in chronological order. The narration panel renders these
 * with per-kind styling so the player can scan back through what just
 * happened — their own intent ("You walk west."), the narrator's prose
 * ("The mud is thick underfoot."), NPC speech, and any system-level
 * notices (failed actions, rate limits).
 */
export type StoryEntry = {
  /** Stable id for React keys + de-duping. Monotonic per session. */
  id: string;
  /** Wall-clock timestamp; primarily used for tooltip "5s ago" hints. */
  ts: number;
  kind: "player" | "narration" | "say" | "system" | "error";
  text: string;
  /** Optional NPC id for "say" entries so the UI can label the line. */
  npcId?: string;
};

export type Currency = { gold: number; silver: number; copper: number };

export type Inventory = {
  items: Record<string, number>;
  currency: Currency;
  /** itemId per equipment slot. Slots match tabs/settings.json itemSettings. */
  equipped: Partial<Record<EquipmentSlot, string>>;
};

export type EquipmentSlot =
  | "head"
  | "body"
  | "legs"
  | "feet"
  | "hands"
  | "mainHand"
  | "offHand"
  | "trinket1"
  | "trinket2";

export type ShopState = {
  /** NPC id whose inventory is being browsed. */
  npcId: string;
  /** Items the merchant offers right now. */
  offers: Array<{ itemId: string; price: number; stock: number }>;
};

export type SceneTileState = {
  x: number;
  y: number;
  /** The kind of the underlying tile (engine primitive or LLM string). */
  kind: string;
  label?: string;
};

/**
 * The player-authored adventurer: a name, a backstory blurb, and a
 * physical description, plus an optional generated portrait. Stored as
 * a single object because the three text fields are always edited
 * together in the character creator panel. The portrait is a data URL
 * (so localStorage can hold it) — at 512×512 PNG ~700 KB it fits well
 * within the per-origin localStorage quota for a single character.
 */
export type Character = {
  name: string;
  /** Short backstory / motivations / personality. */
  background: string;
  /** Physical description used as the portrait prompt seed. */
  visual: string;
  /** Generated portrait as a data: URL. Optional — present once we've
   *  run the image model at least once for this character. */
  portraitDataUrl?: string;
};

/**
 * Long-running async work that the UI should surface as a "still cooking"
 * indicator. Region/location grid fills set these; the HUD activity strip
 * reads them together with {@link StoreState.backgroundActivities} and
 * {@link StoreState.pendingNarrations}.
 */
export type GeneratingState = {
  /** Region whose grid is currently being generated by `tileFiller`. */
  regionGridFor?: string;
  /** Location whose grid is currently being generated by `tileFiller`. */
  locationGridFor?: string;
};

export type StoreState = {
  // ---------------- session
  saveId: string;
  bootError: string | null;
  /**
   * True when boot could not enter the map because no usable pack was found
   * (typically zero regions everywhere). The UI shows a world picker so the
   * player can switch packs without editing localStorage by hand.
   */
  bootAwaitingPackChoice: boolean;
  /** Optional line explaining why the picker appeared (explicit pack vs all empty). */
  bootAwaitingPackHint: string | null;
  isLlmReady: boolean;
  /**
   * Id of the authored pack the engine booted with (see `packs/<id>/manifest.json`).
   * Null only briefly during boot before the pack has been chosen.
   */
  currentPackId: string | null;
  /**
   * Every pack discovered under `/packs/` at boot. The HUD selector
   * renders this list; switching to a different pack rewrites the URL
   * and reloads the page so boot starts fresh with the new world.
   */
  availablePacks: PackInfo[];

  /**
   * Gemini text / image model ids for API calls. Persisted in localStorage;
   * live providers read the current value for each new request, so changing
   * either does not restart the game session.
   */
  geminiTextModel: string;
  geminiImageModel: string;
  textLlmBackend: LlmBackend;
  imageLlmBackend: LlmBackend;
  /** OpenRouter model slugs (e.g. google/gemini-2.5-flash). */
  openRouterTextModel: string;
  openRouterImageModel: string;

  // ---------------- mode + position
  mode: Mode;
  currentRegionId: string;
  regionPos: [number, number];
  currentLocationId: string | null;
  locationPos: [number, number];
  currentSceneTile: SceneTileState | null;

  // ---------------- grids (live working copies; persisted via tileFiller cache)
  regionGrid: TileGrid | null;
  locationGrid: TileGrid | null;

  // ---------------- background work the UI should surface
  generating: GeneratingState;

  /**
   * In-flight network work keyed by a short stable id (e.g. `text-llm:3:scene-classify`,
   * `image-gen:7`). Values are one-line labels for the HUD activity strip.
   * Cleared by setting the same id with `null` via {@link StoreState.setBackgroundActivity}.
   */
  backgroundActivities: Record<string, string>;

  /**
   * Active tile-image strategy. `mosaic` (default) generates one image per
   * region/location grid and slices it client-side. `per-tile` generates one
   * image per (kind, biome). Persisted in localStorage so the choice survives
   * a reload.
   */
  tileImageMode: TileImageMode;

  // ---------------- engagement + combat
  engagement: Engagement;
  combat: CombatState | null;

  // ---------------- inventory + shop
  inventory: Inventory;
  shop: ShopState | null;

  // ---------------- player character (name + background + portrait)
  character: Character | null;

  /**
   * Companion world-NPC ids traveling with the player. Rendered as rows under
   * the hero in the side rail; persisted per pack (see `playerPartyByPack` LS).
   */
  playerPartyNpcIds: string[];

  // ---------------- dialogue + narration
  dialogue: DialogueMessage[];
  narrationLog: string[];
  /**
   * Unified chronological log of every player intent + narration + NPC
   * line + system notice, rendered by the persistent narration panel on
   * the left rail. `appendNarration` and `appendDialogue` mirror into
   * this list, so legacy callers continue to work and the panel still
   * sees everything.
   */
  storyLog: StoryEntry[];
  /**
   * Number of player intents whose LLM narration round-trip is still in
   * flight. Non-zero means the narrator is composing a response; the
   * panel surfaces this as a "Narrator responding…" pill. Maintained by
   * `WorldNarrator`.
   */
  pendingNarrations: number;

  // ---------------- quests
  activeQuestIds: string[];
  /**
   * Per-quest objective progress. Schema is `{ questId: { key: number } }`
   * so quest archetypes can stash whatever counters they need (e.g.
   * `{ "boar-hunt": { remaining: 3 } }`).
   */
  questProgress: Record<string, Record<string, number>>;

  // ---------------- mutators
  setMode: (mode: Mode) => void;
  setBootError: (error: string | null) => void;
  setBootAwaitingPackChoice: (awaiting: boolean, hint?: string | null) => void;
  setLlmReady: (ready: boolean) => void;
  setSaveId: (saveId: string) => void;
  setCurrentPackId: (packId: string | null) => void;
  setAvailablePacks: (packs: PackInfo[]) => void;
  setGeminiTextModel: (modelId: string) => void;
  setGeminiImageModel: (modelId: string) => void;
  setTextLlmBackend: (backend: LlmBackend) => void;
  setImageLlmBackend: (backend: LlmBackend) => void;
  setOpenRouterTextModel: (modelId: string) => void;
  setOpenRouterImageModel: (modelId: string) => void;

  setCurrentRegionId: (regionId: string) => void;
  setRegionPos: (pos: [number, number]) => void;
  setCurrentLocationId: (locationId: string | null) => void;
  setLocationPos: (pos: [number, number]) => void;
  setCurrentSceneTile: (tile: SceneTileState | null) => void;

  setRegionGrid: (grid: TileGrid | null) => void;
  setLocationGrid: (grid: TileGrid | null) => void;

  setGenerating: (patch: Partial<GeneratingState>) => void;
  setBackgroundActivity: (id: string, label: string | null) => void;

  setTileImageMode: (mode: TileImageMode) => void;

  setEngagement: (engagement: Engagement) => void;
  setEngagementGroup: (group: EngagementGroup) => void;
  removeEngagementGroup: (groupId: string) => void;
  setLockReason: (reason: string | undefined) => void;

  setCombat: (combat: CombatState | null) => void;

  setInventory: (inventory: Inventory) => void;
  adjustItem: (itemId: string, delta: number) => void;
  adjustCurrency: (delta: Partial<Currency>) => void;
  setEquipped: (slot: EquipmentSlot, itemId: string | undefined) => void;

  openShop: (shop: ShopState | null) => void;

  /** Replace the player character wholesale (or clear it with null). */
  setCharacter: (character: Character | null) => void;
  /** Merge a partial update into the existing character, creating an
   *  empty one if none exists yet. */
  updateCharacter: (patch: Partial<Character>) => void;

  /** Replaces the companion list (deduped, capped); persists for the active pack. */
  setPlayerPartyNpcIds: (npcIds: string[]) => void;

  appendDialogue: (msg: DialogueMessage) => void;
  appendNarration: (line: string) => void;
  clearDialogue: () => void;

  /**
   * The canonical writer for the narration panel. Existing
   * `appendNarration` and `appendDialogue` call this internally — direct
   * callers (notably `WorldNarrator`) use it to push player-intent and
   * system entries that don't fit either of the legacy buckets.
   */
  appendStory: (entry: Omit<StoryEntry, "id" | "ts">) => void;

  setPendingNarrations: (delta: number) => void;

  addActiveQuest: (questId: string) => void;
  removeActiveQuest: (questId: string) => void;
  setQuestObjective: (questId: string, key: string, value: number) => void;
};

/**
 * Monotonic counter used to mint StoryEntry ids. Stable React keys for
 * a list that grows by appending need only be unique within the session;
 * a numeric counter is cheaper and easier to debug than `crypto.randomUUID()`.
 */
let storyEntryCounter = 0;
function nextStoryId(): string {
  storyEntryCounter += 1;
  return `s${storyEntryCounter}`;
}

/**
 * Localstorage key + reader for the persisted tile-image mode. Reading
 * is best-effort: on any error (private mode, quota, missing browser
 * APIs in tests) we fall back to the default. Writing is also fire-
 * and-forget — losing the persistence is at worst an annoyance, not a
 * correctness issue.
 */
const TILE_IMAGE_MODE_LS_KEY = "engine.tileImageMode";

function readPersistedTileImageMode(): TileImageMode {
  try {
    const raw = globalThis.localStorage?.getItem(TILE_IMAGE_MODE_LS_KEY);
    if (raw === "mosaic" || raw === "per-tile") return raw;
  } catch {
    // ignore
  }
  return "mosaic";
}

function writePersistedTileImageMode(mode: TileImageMode): void {
  try {
    globalThis.localStorage?.setItem(TILE_IMAGE_MODE_LS_KEY, mode);
  } catch {
    // ignore
  }
}

/**
 * Persisted choice of authored pack (the world the engine loads at
 * boot). The HUD pack selector writes this on switch; boot reads it
 * after the URL `?pack=` override.
 */
const PACK_ID_LS_KEY = "engine.packId";

function readPersistedPackId(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(PACK_ID_LS_KEY);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writePersistedPackId(packId: string | null): void {
  try {
    if (packId === null) {
      globalThis.localStorage?.removeItem(PACK_ID_LS_KEY);
    } else {
      globalThis.localStorage?.setItem(PACK_ID_LS_KEY, packId);
    }
  } catch {
    // ignore
  }
}

const GEMINI_TEXT_MODEL_LS_KEY = "engine.geminiTextModel";
const GEMINI_IMAGE_MODEL_LS_KEY = "engine.geminiImageModel";

function readPersistedGeminiTextModel(): string {
  try {
    const raw = globalThis.localStorage?.getItem(GEMINI_TEXT_MODEL_LS_KEY)?.trim();
    if (raw) return normalizeGeminiTextModel(raw);
  } catch {
    // ignore
  }
  return defaultGeminiTextModel();
}

function readPersistedGeminiImageModel(): string {
  try {
    const raw = globalThis.localStorage?.getItem(GEMINI_IMAGE_MODEL_LS_KEY)?.trim();
    if (raw) return raw;
  } catch {
    // ignore
  }
  return defaultGeminiImageModel();
}

function writePersistedGeminiTextModel(modelId: string): void {
  try {
    globalThis.localStorage?.setItem(GEMINI_TEXT_MODEL_LS_KEY, modelId);
  } catch {
    // ignore
  }
}

function writePersistedGeminiImageModel(modelId: string): void {
  try {
    globalThis.localStorage?.setItem(GEMINI_IMAGE_MODEL_LS_KEY, modelId);
  } catch {
    // ignore
  }
}

const TEXT_LLM_BACKEND_LS_KEY = "engine.textLlmBackend";
const IMAGE_LLM_BACKEND_LS_KEY = "engine.imageLlmBackend";
const OPENROUTER_TEXT_MODEL_LS_KEY = "engine.openRouterTextModel";
const OPENROUTER_IMAGE_MODEL_LS_KEY = "engine.openRouterImageModel";

function readPersistedLlmBackend(
  key: string,
  fallback: LlmBackend,
): LlmBackend {
  try {
    const raw = globalThis.localStorage?.getItem(key)?.trim();
    if (raw === "gemini" || raw === "openrouter") return raw;
  } catch {
    // ignore
  }
  return fallback;
}

function writePersistedLlmBackend(key: string, backend: LlmBackend): void {
  try {
    globalThis.localStorage?.setItem(key, backend);
  } catch {
    // ignore
  }
}

function readPersistedOpenRouterTextModel(): string {
  try {
    const raw = globalThis.localStorage?.getItem(OPENROUTER_TEXT_MODEL_LS_KEY)?.trim();
    if (raw) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_OPENROUTER_TEXT_MODEL;
}

function readPersistedOpenRouterImageModel(): string {
  try {
    const raw = globalThis.localStorage?.getItem(OPENROUTER_IMAGE_MODEL_LS_KEY)?.trim();
    if (raw) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_OPENROUTER_IMAGE_MODEL;
}

function writePersistedOpenRouterTextModel(modelId: string): void {
  try {
    globalThis.localStorage?.setItem(OPENROUTER_TEXT_MODEL_LS_KEY, modelId);
  } catch {
    // ignore
  }
}

function writePersistedOpenRouterImageModel(modelId: string): void {
  try {
    globalThis.localStorage?.setItem(OPENROUTER_IMAGE_MODEL_LS_KEY, modelId);
  } catch {
    // ignore
  }
}

/**
 * Same best-effort persistence pattern for the player character. We
 * keep it in localStorage rather than a Dexie row because a barebones
 * one-character setup doesn't need the schema overhead and the JSON
 * is small enough to comfortably fit (portrait data URL is the only
 * non-trivial field; 512×512 PNG ≈ 700 KB << 5 MB quota).
 */
const CHARACTER_LS_KEY = "engine.character";

function readPersistedCharacter(): Character | null {
  try {
    const raw = globalThis.localStorage?.getItem(CHARACTER_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Character>;
    if (typeof parsed.name !== "string") return null;
    return {
      name: parsed.name,
      background: typeof parsed.background === "string" ? parsed.background : "",
      visual: typeof parsed.visual === "string" ? parsed.visual : "",
      portraitDataUrl:
        typeof parsed.portraitDataUrl === "string"
          ? parsed.portraitDataUrl
          : undefined,
    };
  } catch {
    return null;
  }
}

function writePersistedCharacter(character: Character | null): void {
  try {
    if (character === null) {
      globalThis.localStorage?.removeItem(CHARACTER_LS_KEY);
    } else {
      globalThis.localStorage?.setItem(
        CHARACTER_LS_KEY,
        JSON.stringify(character),
      );
    }
  } catch {
    // ignore: localStorage may be unavailable or full
  }
}

/** Max companions in the player party (hero is separate in the UI). */
export const MAX_PLAYER_PARTY_SIZE = 6;

const PLAYER_PARTY_BY_PACK_LS_KEY = "engine.playerPartyByPack";

export function readPersistedPlayerParty(packId: string | null): string[] {
  if (!packId) return [];
  try {
    const raw = globalThis.localStorage?.getItem(PLAYER_PARTY_BY_PACK_LS_KEY);
    if (!raw) return [];
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const arr = obj[packId];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

function writePersistedPlayerParty(packId: string | null, ids: string[]): void {
  if (!packId) return;
  try {
    const raw = globalThis.localStorage?.getItem(PLAYER_PARTY_BY_PACK_LS_KEY);
    const obj: Record<string, string[]> =
      raw && typeof raw === "string" ? (JSON.parse(raw) as Record<string, string[]>) : {};
    obj[packId] = ids;
    globalThis.localStorage?.setItem(
      PLAYER_PARTY_BY_PACK_LS_KEY,
      JSON.stringify(obj),
    );
  } catch {
    // ignore
  }
}

const initialEngagement = (): Engagement => ({ groups: {}, lockReason: undefined });
const initialInventory = (): Inventory => ({
  items: {},
  currency: { gold: 0, silver: 0, copper: 0 },
  equipped: {},
});

export const useStore = create<StoreState>((set) => ({
  saveId: "",
  bootError: null,
  bootAwaitingPackChoice: false,
  bootAwaitingPackHint: null,
  isLlmReady: false,
  currentPackId: readPersistedPackId(),
  availablePacks: [],
  geminiTextModel: readPersistedGeminiTextModel(),
  geminiImageModel: readPersistedGeminiImageModel(),
  textLlmBackend: readPersistedLlmBackend(TEXT_LLM_BACKEND_LS_KEY, "gemini"),
  imageLlmBackend: readPersistedLlmBackend(IMAGE_LLM_BACKEND_LS_KEY, "gemini"),
  openRouterTextModel: readPersistedOpenRouterTextModel(),
  openRouterImageModel: readPersistedOpenRouterImageModel(),

  mode: "region",
  currentRegionId: "",
  regionPos: [0, 0],
  currentLocationId: null,
  locationPos: [0, 0],
  currentSceneTile: null,

  regionGrid: null,
  locationGrid: null,

  generating: {},
  backgroundActivities: {},
  tileImageMode: readPersistedTileImageMode(),

  engagement: initialEngagement(),
  combat: null,

  inventory: initialInventory(),
  shop: null,

  character: readPersistedCharacter(),
  playerPartyNpcIds: [],

  dialogue: [],
  narrationLog: [],
  storyLog: [],
  pendingNarrations: 0,

  activeQuestIds: [],
  questProgress: {},

  setMode: (mode) => set({ mode }),
  setBootError: (bootError) => set({ bootError }),
  setBootAwaitingPackChoice: (awaiting, hint = null) =>
    set({
      bootAwaitingPackChoice: awaiting,
      bootAwaitingPackHint: awaiting ? hint ?? null : null,
    }),
  setLlmReady: (isLlmReady) => set({ isLlmReady }),
  setSaveId: (saveId) => set({ saveId }),
  setCurrentPackId: (currentPackId) => {
    writePersistedPackId(currentPackId);
    set({ currentPackId });
  },
  setAvailablePacks: (availablePacks) => set({ availablePacks }),
  setGeminiTextModel: (geminiTextModel) => {
    const normalized = normalizeGeminiTextModel(geminiTextModel);
    writePersistedGeminiTextModel(normalized);
    set({ geminiTextModel: normalized });
  },
  setGeminiImageModel: (geminiImageModel) => {
    writePersistedGeminiImageModel(geminiImageModel);
    set({ geminiImageModel });
  },
  setTextLlmBackend: (textLlmBackend) => {
    writePersistedLlmBackend(TEXT_LLM_BACKEND_LS_KEY, textLlmBackend);
    set({ textLlmBackend });
  },
  setImageLlmBackend: (imageLlmBackend) => {
    writePersistedLlmBackend(IMAGE_LLM_BACKEND_LS_KEY, imageLlmBackend);
    set({ imageLlmBackend });
  },
  setOpenRouterTextModel: (openRouterTextModel) => {
    const trimmed = openRouterTextModel.trim() || DEFAULT_OPENROUTER_TEXT_MODEL;
    writePersistedOpenRouterTextModel(trimmed);
    set({ openRouterTextModel: trimmed });
  },
  setOpenRouterImageModel: (openRouterImageModel) => {
    const trimmed = openRouterImageModel.trim() || DEFAULT_OPENROUTER_IMAGE_MODEL;
    writePersistedOpenRouterImageModel(trimmed);
    set({ openRouterImageModel: trimmed });
  },

  setCurrentRegionId: (currentRegionId) => set({ currentRegionId }),
  setRegionPos: (regionPos) => set({ regionPos }),
  setCurrentLocationId: (currentLocationId) => set({ currentLocationId }),
  setLocationPos: (locationPos) => set({ locationPos }),
  setCurrentSceneTile: (currentSceneTile) => set({ currentSceneTile }),

  setRegionGrid: (regionGrid) => set({ regionGrid }),
  setLocationGrid: (locationGrid) => set({ locationGrid }),

  setGenerating: (patch) =>
    set((state) => ({ generating: { ...state.generating, ...patch } })),

  setBackgroundActivity: (id, label) =>
    set((state) => {
      const next = { ...state.backgroundActivities };
      if (label === null || label === "") {
        delete next[id];
      } else {
        next[id] = label;
      }
      return { backgroundActivities: next };
    }),

  setTileImageMode: (tileImageMode) => {
    writePersistedTileImageMode(tileImageMode);
    set({ tileImageMode });
  },

  setEngagement: (engagement) => set({ engagement }),
  setEngagementGroup: (group) =>
    set((state) => ({
      engagement: {
        ...state.engagement,
        groups: { ...state.engagement.groups, [group.id]: group },
      },
    })),
  removeEngagementGroup: (groupId) =>
    set((state) => {
      const groups = { ...state.engagement.groups };
      delete groups[groupId];
      return { engagement: { ...state.engagement, groups } };
    }),
  setLockReason: (reason) =>
    set((state) => ({ engagement: { ...state.engagement, lockReason: reason } })),

  setCombat: (combat) => set({ combat }),

  setInventory: (inventory) => set({ inventory }),
  adjustItem: (itemId, delta) =>
    set((state) => {
      const items = { ...state.inventory.items };
      const next = (items[itemId] ?? 0) + delta;
      if (next <= 0) {
        delete items[itemId];
      } else {
        items[itemId] = next;
      }
      return { inventory: { ...state.inventory, items } };
    }),
  adjustCurrency: (delta) =>
    set((state) => {
      const currency: Currency = {
        gold: state.inventory.currency.gold + (delta.gold ?? 0),
        silver: state.inventory.currency.silver + (delta.silver ?? 0),
        copper: state.inventory.currency.copper + (delta.copper ?? 0),
      };
      return { inventory: { ...state.inventory, currency } };
    }),
  setEquipped: (slot, itemId) =>
    set((state) => {
      const equipped = { ...state.inventory.equipped };
      if (itemId === undefined) {
        delete equipped[slot];
      } else {
        equipped[slot] = itemId;
      }
      return { inventory: { ...state.inventory, equipped } };
    }),

  openShop: (shop) => set({ shop }),

  setCharacter: (character) => {
    writePersistedCharacter(character);
    set({ character });
  },
  updateCharacter: (patch) =>
    set((state) => {
      const base: Character = state.character ?? {
        name: "",
        background: "",
        visual: "",
      };
      const next: Character = { ...base, ...patch };
      writePersistedCharacter(next);
      return { character: next };
    }),

  setPlayerPartyNpcIds: (npcIds) =>
    set((state) => {
      const deduped = [...new Set(npcIds)].slice(0, MAX_PLAYER_PARTY_SIZE);
      writePersistedPlayerParty(state.currentPackId, deduped);
      return { playerPartyNpcIds: deduped };
    }),

  appendDialogue: (msg) =>
    set((state) => {
      // Mirror NPC / system speech into the unified story log so the
      // narration panel reflects everything in one place. `player` lines
      // are pushed separately by WorldNarrator (the intent text it sends
      // to the LLM) so we deliberately skip them here to avoid doubling.
      if (msg.role === "player") {
        return { dialogue: [...state.dialogue, msg] };
      }
      const story: StoryEntry = {
        id: nextStoryId(),
        ts: Date.now(),
        kind: msg.role === "npc" ? "say" : "system",
        text: msg.text,
        npcId: msg.npcId,
      };
      return {
        dialogue: [...state.dialogue, msg],
        storyLog: [...state.storyLog, story],
      };
    }),
  appendNarration: (line) =>
    set((state) => {
      const story: StoryEntry = {
        id: nextStoryId(),
        ts: Date.now(),
        kind: "narration",
        text: line,
      };
      return {
        narrationLog: [...state.narrationLog, line],
        storyLog: [...state.storyLog, story],
      };
    }),
  clearDialogue: () => set({ dialogue: [] }),

  appendStory: (entry) =>
    set((state) => ({
      storyLog: [
        ...state.storyLog,
        { id: nextStoryId(), ts: Date.now(), ...entry },
      ],
    })),

  setPendingNarrations: (delta) =>
    set((state) => ({
      // Clamp at zero so a stray decrement (paired by mistake) can't
      // make the pending counter negative and stick the "responding…"
      // pill in a permanently-on state.
      pendingNarrations: Math.max(0, state.pendingNarrations + delta),
    })),

  addActiveQuest: (questId) =>
    set((state) => {
      if (state.activeQuestIds.includes(questId)) return state;
      return { activeQuestIds: [...state.activeQuestIds, questId] };
    }),
  removeActiveQuest: (questId) =>
    set((state) => ({
      activeQuestIds: state.activeQuestIds.filter((id) => id !== questId),
    })),
  setQuestObjective: (questId, key, value) =>
    set((state) => {
      const cur = state.questProgress[questId] ?? {};
      return {
        questProgress: {
          ...state.questProgress,
          [questId]: { ...cur, [key]: value },
        },
      };
    }),
}));
