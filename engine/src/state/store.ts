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
import type { LlmCallKind } from "../llm/types";
import type { ImageCallKind } from "../llm/imageAdapter";

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
export type BackendPreference = LlmBackend | "default";

export type ModelSelection = {
  backend: BackendPreference;
  model: string;
};

export type TextModelRegistry = Record<LlmCallKind, ModelSelection>;
export type ImageModelRegistry = Record<ImageCallKind, ModelSelection>;

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

export type PlayerCondition = {
  id: string;
  label: string;
  severity: string;
  effects: string[];
  appliedAt: number;
  expiresAt?: number;
  notes?: string;
};

export type StoryFactScope =
  | { kind: "global" }
  | { kind: "region"; regionId: string }
  | { kind: "location"; locationId: string }
  | { kind: "scene"; locationId: string; x: number; y: number }
  | { kind: "npc"; npcId: string }
  | { kind: "quest"; questId: string };

export type StoryFact = {
  id: string;
  text: string;
  scope: StoryFactScope;
  importance: "minor" | "normal" | "critical";
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
};

export type CanonicalIntentCandidate =
  | { kind: "region.move"; dx: number; dy: number }
  | { kind: "region.travelTo"; x: number; y: number; locationId?: string }
  | { kind: "region.enterLocation"; locationId: string }
  | { kind: "location.move"; dx: number; dy: number }
  | { kind: "location.enterTile"; x: number; y: number }
  | { kind: "location.leave"; direction?: "north" | "south" | "east" | "west" }
  | { kind: "scene.leaveTile" }
  | { kind: "scene.button"; verb: string; groupId?: string };

export type ActionOutcome = {
  interpretation: {
    summary: string;
    confidence: "low" | "medium" | "high";
    canonicalIntent?: CanonicalIntentCandidate;
  };
  verdict: "trivial_success" | "success" | "partial" | "failure" | "refused";
  reason: string;
  blockingConditionIds: string[];
  appliesConditions: Array<{
    id?: string;
    label: string;
    severity?: string;
    effects?: string[];
    notes?: string;
    expiresAt?: number;
  }>;
  interrupt: {
    kind: "encounter" | "ambush" | "event" | "none";
    timing: "before_action" | "after_action" | "replaces_action";
    requiresDialogue: boolean;
    hint?: string;
  };
};

export type TurnResolution = {
  turnId: string;
  startedAt: number;
  completedAt: number;
  rawIntentKind: string;
  rawIntentText: string;
  interpretation: ActionOutcome["interpretation"];
  outcome: ActionOutcome;
  narrativeText: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  toolResults: Array<{ name: string; ok: boolean; message?: string }>;
  committedStoryEntryIds: string[];
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
  textModelRegistry: TextModelRegistry;
  imageModelRegistry: ImageModelRegistry;

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
  activeDialogueGroupId?: string;
  /**
   * `storyLog.length` at the moment the current dialogue group became
   * active. Lets the dialogue overlay render the full conversation
   * (player intents, narrator prose, NPC `say` lines) by slicing the
   * unified `storyLog` from this index forward, instead of relying on
   * the lossy `dialogue` array which only captures NPC speech.
   */
  activeDialogueStartIndex?: number;
  playerConditions: PlayerCondition[];
  storyFacts: Record<string, StoryFact>;
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
  pendingNarrationId: string | null;
  pendingNarrationText: string;
  turnResolutions: TurnResolution[];

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
  setTextModelForKind: (kind: LlmCallKind, selection: ModelSelection) => void;
  setImageModelForKind: (kind: ImageCallKind, selection: ModelSelection) => void;

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
  setActiveDialogueGroup: (groupId: string | null) => void;

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
  applyCondition: (condition: PlayerCondition) => void;
  clearCondition: (conditionId: string) => void;
  tickConditions: (now?: number) => void;
  rememberFact: (fact: StoryFact) => void;
  forgetFact: (factId: string) => void;

  /**
   * The canonical writer for the narration panel. Existing
   * `appendNarration` and `appendDialogue` call this internally — direct
   * callers (notably `WorldNarrator`) use it to push player-intent and
   * system entries that don't fit either of the legacy buckets.
   */
  appendStory: (entry: Omit<StoryEntry, "id" | "ts">) => void;

  setPendingNarrations: (delta: number) => void;
  beginPendingNarration: (id: string) => void;
  appendPendingNarration: (chunk: string) => void;
  /** Replace the in-flight streamed narration text in-place (used to scrub inline tool-call syntax before commit). */
  replacePendingNarration: (text: string) => void;
  commitPendingNarration: (opts?: { asError?: boolean; suffix?: string }) => void;
  clearPendingNarration: () => void;
  addTurnResolution: (resolution: TurnResolution) => void;

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

/**
 * Gemini model ids are simple slugs (`gemini-2.5-flash`); OpenRouter
 * ids are always `provider/model`. If a `/` shows up in the persisted
 * Gemini field it can only be the residue of an earlier bug where a
 * per-kind override wrote an OpenRouter slug back into this slot — and
 * we'd hand it straight to Gemini and 400 out. Reject the value on
 * read and fall back to the default model.
 */
function looksLikeOpenRouterSlug(modelId: string): boolean {
  return modelId.includes("/");
}

function readPersistedGeminiTextModel(): string {
  try {
    const raw = globalThis.localStorage?.getItem(GEMINI_TEXT_MODEL_LS_KEY)?.trim();
    if (raw && !looksLikeOpenRouterSlug(raw)) {
      return normalizeGeminiTextModel(raw);
    }
    if (raw && looksLikeOpenRouterSlug(raw)) {
      // Heal a previously-corrupted slot so we don't re-read the bad
      // value on every boot.
      globalThis.localStorage?.removeItem(GEMINI_TEXT_MODEL_LS_KEY);
    }
  } catch {
    // ignore
  }
  return defaultGeminiTextModel();
}

function readPersistedGeminiImageModel(): string {
  try {
    const raw = globalThis.localStorage?.getItem(GEMINI_IMAGE_MODEL_LS_KEY)?.trim();
    if (raw && !looksLikeOpenRouterSlug(raw)) return raw;
    if (raw && looksLikeOpenRouterSlug(raw)) {
      globalThis.localStorage?.removeItem(GEMINI_IMAGE_MODEL_LS_KEY);
    }
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
const TEXT_MODEL_REGISTRY_LS_KEY = "engine.textModelRegistry";
const IMAGE_MODEL_REGISTRY_LS_KEY = "engine.imageModelRegistry";

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
    if (raw && looksLikeOpenRouterSlug(raw)) return raw;
    if (raw && !looksLikeOpenRouterSlug(raw)) {
      globalThis.localStorage?.removeItem(OPENROUTER_TEXT_MODEL_LS_KEY);
    }
  } catch {
    // ignore
  }
  return DEFAULT_OPENROUTER_TEXT_MODEL;
}

function readPersistedOpenRouterImageModel(): string {
  try {
    const raw = globalThis.localStorage?.getItem(OPENROUTER_IMAGE_MODEL_LS_KEY)?.trim();
    if (raw && looksLikeOpenRouterSlug(raw)) return raw;
    if (raw && !looksLikeOpenRouterSlug(raw)) {
      globalThis.localStorage?.removeItem(OPENROUTER_IMAGE_MODEL_LS_KEY);
    }
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

const TEXT_MODEL_KINDS: LlmCallKind[] = [
  "chat",
  "action-eval",
  "scene-classify",
  "skill-check",
  "expansion",
  "death-recovery",
  "quest-verify",
  "other",
];

const IMAGE_MODEL_KINDS: ImageCallKind[] = [
  "player-portrait",
  "npc-portrait",
  "scene-background",
  "tile",
  "mosaic",
  "mosaic-blueprint",
  "other",
];

/**
 * Seed every kind with `{ backend: "default", model: "" }`. An empty
 * `model` is the canonical "use the backend's current chat/image model"
 * signal — the provider routers fall back to `geminiTextModel` /
 * `openRouterTextModel` (and the image equivalents) at call time. This
 * way the per-kind registry never carries a stale or backend-mismatched
 * model id, which previously meant flipping a row's backend to "Gemini"
 * while it still held an OpenRouter slug like `openai/gpt-4o-mini` would
 * send that slug to Gemini and 400 out. Users who want a different
 * per-kind model pick it explicitly in Settings.
 */
function defaultTextModelRegistry(): TextModelRegistry {
  const out = {} as TextModelRegistry;
  for (const kind of TEXT_MODEL_KINDS) {
    out[kind] = { backend: "default", model: "" };
  }
  return out;
}

function defaultImageModelRegistry(): ImageModelRegistry {
  const out = {} as ImageModelRegistry;
  for (const kind of IMAGE_MODEL_KINDS) {
    out[kind] = { backend: "default", model: "" };
  }
  return out;
}

/**
 * Slugs known to be deprecated and unusable on any backend. These end
 * up here when an earlier version of the UI seeded a row with the now-
 * retired `openai/gpt-4o-mini` default.
 */
const DEPRECATED_PERSISTED_MODEL_IDS = new Set<string>([
  "openai/gpt-4o-mini",
]);

/**
 * Drop a stored model id that doesn't match the row's backend shape.
 * Gemini ids are bare slugs (`gemini-2.5-flash`); OpenRouter ids are
 * always `provider/model`. If a row says `backend: "gemini"` but the
 * model id contains a slash, it was carried over from an OpenRouter
 * row (the old free-text UI made this easy) — keeping it would send
 * an OpenRouter slug to Gemini and 400 out. The inverse is also true
 * for `backend: "openrouter"`. When the shape doesn't match we clear
 * the model so the row falls back to the backend's chat/image model.
 */
function sanitizeStoredModelId(
  model: string,
  backend: BackendPreference,
): string {
  if (!model) return "";
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (DEPRECATED_PERSISTED_MODEL_IDS.has(trimmed)) return "";
  const hasSlash = trimmed.includes("/");
  if (backend === "gemini" && hasSlash) return "";
  if (backend === "openrouter" && !hasSlash) return "";
  return trimmed;
}

function readPersistedTextModelRegistry(): TextModelRegistry {
  const fallback = defaultTextModelRegistry();
  try {
    const raw = globalThis.localStorage?.getItem(TEXT_MODEL_REGISTRY_LS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TextModelRegistry>;
    for (const kind of TEXT_MODEL_KINDS) {
      const sel = parsed[kind];
      if (!sel) continue;
      const backend = sel.backend;
      if (backend !== "gemini" && backend !== "openrouter" && backend !== "default") {
        continue;
      }
      const model =
        typeof sel.model === "string"
          ? sanitizeStoredModelId(sel.model, backend)
          : "";
      fallback[kind] = { backend, model };
    }
  } catch {
    // ignore
  }
  return fallback;
}

function writePersistedTextModelRegistry(registry: TextModelRegistry): void {
  try {
    globalThis.localStorage?.setItem(
      TEXT_MODEL_REGISTRY_LS_KEY,
      JSON.stringify(registry),
    );
  } catch {
    // ignore
  }
}

function readPersistedImageModelRegistry(): ImageModelRegistry {
  const fallback = defaultImageModelRegistry();
  try {
    const raw = globalThis.localStorage?.getItem(IMAGE_MODEL_REGISTRY_LS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ImageModelRegistry>;
    for (const kind of IMAGE_MODEL_KINDS) {
      const sel = parsed[kind];
      if (!sel) continue;
      const backend = sel.backend;
      if (backend !== "gemini" && backend !== "openrouter" && backend !== "default") {
        continue;
      }
      const model =
        typeof sel.model === "string"
          ? sanitizeStoredModelId(sel.model, backend)
          : "";
      fallback[kind] = { backend, model };
    }
  } catch {
    // ignore
  }
  return fallback;
}

function writePersistedImageModelRegistry(registry: ImageModelRegistry): void {
  try {
    globalThis.localStorage?.setItem(
      IMAGE_MODEL_REGISTRY_LS_KEY,
      JSON.stringify(registry),
    );
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

const PLAYER_CONDITIONS_LS_KEY = "engine.playerConditions";
const STORY_FACTS_LS_KEY = "engine.storyFacts";

function readPersistedPlayerConditions(): PlayerCondition[] {
  try {
    const raw = globalThis.localStorage?.getItem(PLAYER_CONDITIONS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: PlayerCondition[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as PlayerCondition).id === "string" &&
        typeof (item as PlayerCondition).label === "string"
      ) {
        const c = item as PlayerCondition;
        out.push({
          id: c.id,
          label: c.label,
          severity: typeof c.severity === "string" ? c.severity : "normal",
          effects: Array.isArray(c.effects)
            ? c.effects.filter((e): e is string => typeof e === "string")
            : [],
          appliedAt: typeof c.appliedAt === "number" ? c.appliedAt : Date.now(),
          expiresAt: typeof c.expiresAt === "number" ? c.expiresAt : undefined,
          notes: typeof c.notes === "string" ? c.notes : undefined,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writePersistedPlayerConditions(conditions: PlayerCondition[]): void {
  try {
    globalThis.localStorage?.setItem(
      PLAYER_CONDITIONS_LS_KEY,
      JSON.stringify(conditions),
    );
  } catch {
    // ignore
  }
}

function readPersistedStoryFacts(): Record<string, StoryFact> {
  try {
    const raw = globalThis.localStorage?.getItem(STORY_FACTS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, StoryFact> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        v &&
        typeof v === "object" &&
        typeof (v as StoryFact).id === "string" &&
        typeof (v as StoryFact).text === "string" &&
        (v as StoryFact).scope
      ) {
        out[k] = v as StoryFact;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writePersistedStoryFacts(facts: Record<string, StoryFact>): void {
  try {
    globalThis.localStorage?.setItem(STORY_FACTS_LS_KEY, JSON.stringify(facts));
  } catch {
    // ignore
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
  textModelRegistry: readPersistedTextModelRegistry(),
  imageModelRegistry: readPersistedImageModelRegistry(),

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
  activeDialogueGroupId: undefined,
  activeDialogueStartIndex: undefined,
  playerConditions: readPersistedPlayerConditions(),
  storyFacts: readPersistedStoryFacts(),
  narrationLog: [],
  storyLog: [],
  pendingNarrations: 0,
  pendingNarrationId: null,
  pendingNarrationText: "",
  turnResolutions: [],

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
  setTextModelForKind: (kind, selection) =>
    set((state) => {
      const next: TextModelRegistry = {
        ...state.textModelRegistry,
        [kind]: {
          backend: selection.backend,
          model: selection.model,
        },
      };
      writePersistedTextModelRegistry(next);
      return { textModelRegistry: next };
    }),
  setImageModelForKind: (kind, selection) =>
    set((state) => {
      const next: ImageModelRegistry = {
        ...state.imageModelRegistry,
        [kind]: {
          backend: selection.backend,
          model: selection.model,
        },
      };
      writePersistedImageModelRegistry(next);
      return { imageModelRegistry: next };
    }),

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

  setEngagement: (engagement) =>
    set((state) => {
      const active =
        state.activeDialogueGroupId &&
        engagement.groups[state.activeDialogueGroupId]
          ? state.activeDialogueGroupId
          : undefined;
      return { engagement, activeDialogueGroupId: active };
    }),
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
      return {
        engagement: { ...state.engagement, groups },
        activeDialogueGroupId:
          state.activeDialogueGroupId === groupId
            ? undefined
            : state.activeDialogueGroupId,
      };
    }),
  setLockReason: (reason) =>
    set((state) => ({ engagement: { ...state.engagement, lockReason: reason } })),
  setActiveDialogueGroup: (groupId) =>
    set((state) => {
      if (!groupId) {
        return {
          activeDialogueGroupId: undefined,
          activeDialogueStartIndex: undefined,
        };
      }
      // Only snapshot the story-log cursor when the active group
      // CHANGES. If the same group is being re-set (e.g. an engage
      // followed by lock_engagement), keep the existing start index so
      // the overlay's view of the conversation doesn't reset mid-turn.
      if (state.activeDialogueGroupId === groupId) {
        return { activeDialogueGroupId: groupId };
      }
      // Backtrack over the immediate trailing player intent so the
      // overlay opens with the click that started the conversation
      // ("You approach Saska Vorin.") instead of the NPC's first line
      // appearing in mid-air. We only walk back across `player` and
      // `narration` entries to avoid pulling in older NPC chatter from
      // a previous engagement.
      let startIdx = state.storyLog.length;
      for (let i = state.storyLog.length - 1; i >= 0; i -= 1) {
        const k = state.storyLog[i].kind;
        if (k === "player" || k === "narration") {
          startIdx = i;
        } else {
          break;
        }
      }
      return {
        activeDialogueGroupId: groupId,
        activeDialogueStartIndex: startIdx,
      };
    }),

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
  clearDialogue: () =>
    set({
      dialogue: [],
      activeDialogueGroupId: undefined,
      activeDialogueStartIndex: undefined,
    }),
  applyCondition: (condition) =>
    set((state) => {
      const next = state.playerConditions.filter((c) => c.id !== condition.id);
      next.push(condition);
      writePersistedPlayerConditions(next);
      return { playerConditions: next };
    }),
  clearCondition: (conditionId) =>
    set((state) => {
      const next = state.playerConditions.filter((c) => c.id !== conditionId);
      writePersistedPlayerConditions(next);
      return { playerConditions: next };
    }),
  tickConditions: (now = Date.now()) =>
    set((state) => {
      const next = state.playerConditions.filter(
        (c) => !c.expiresAt || c.expiresAt > now,
      );
      if (next.length === state.playerConditions.length) return state;
      writePersistedPlayerConditions(next);
      return { playerConditions: next };
    }),
  rememberFact: (fact) =>
    set((state) => {
      const next = { ...state.storyFacts, [fact.id]: fact };
      writePersistedStoryFacts(next);
      return { storyFacts: next };
    }),
  forgetFact: (factId) =>
    set((state) => {
      const next = { ...state.storyFacts };
      delete next[factId];
      writePersistedStoryFacts(next);
      return { storyFacts: next };
    }),

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
  beginPendingNarration: (id) => set({ pendingNarrationId: id, pendingNarrationText: "" }),
  appendPendingNarration: (chunk) =>
    set((state) => ({
      pendingNarrationText: state.pendingNarrationText + chunk,
    })),
  replacePendingNarration: (text) =>
    set({ pendingNarrationText: text }),
  commitPendingNarration: (opts) =>
    set((state) => {
      const text = state.pendingNarrationText.trim();
      if (!text) {
        return { pendingNarrationId: null, pendingNarrationText: "" };
      }
      const suffix = opts?.suffix ?? "";
      const finalText = `${text}${suffix}`;
      const story: StoryEntry = {
        id: nextStoryId(),
        ts: Date.now(),
        kind: opts?.asError ? "error" : "narration",
        text: finalText,
      };
      return {
        narrationLog: [...state.narrationLog, finalText],
        storyLog: [...state.storyLog, story],
        pendingNarrationId: null,
        pendingNarrationText: "",
      };
    }),
  clearPendingNarration: () => set({ pendingNarrationId: null, pendingNarrationText: "" }),
  addTurnResolution: (resolution) =>
    set((state) => ({
      turnResolutions: [...state.turnResolutions.slice(-49), resolution],
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
