import { LlmAdapter } from "./llm/adapter";
import { resolveTextProvider } from "./llm/providers";
import { resolveImageBackend } from "./llm/imageProvider";
import { loadOpenRouterCatalog } from "./llm/openRouterCatalog";
import { loadRoomImage, migrateLegacyRoomImage } from "./persist/imageStore";
import { migrateLegacy, saveStorageKey, updateActiveMeta } from "./persist/saves";
import { GameController } from "./game/controller";
import { useStore } from "./state/store";
import { normalizeCharacter } from "./game/characters";
import type { TextBackend } from "./game/types";
import { diag } from "./diag/log";

/**
 * Resolve the backend the game should actually use, given the persisted choice
 * and which providers are configured. "mock" is treated as a stale default and
 * upgrades to a real provider when one exists (Gemini preferred); an explicit
 * gemini/openrouter that isn't available degrades to whatever is.
 */
function effectiveBackend(
  current: TextBackend,
  hasGemini: boolean,
  hasOpenRouter: boolean,
): TextBackend {
  if (current === "gemini") return hasGemini ? "gemini" : hasOpenRouter ? "openrouter" : "mock";
  if (current === "openrouter") return hasOpenRouter ? "openrouter" : hasGemini ? "gemini" : "mock";
  return hasGemini ? "gemini" : hasOpenRouter ? "openrouter" : "mock";
}

export interface BootResult {
  controller: GameController;
  llm: LlmAdapter;
}

let bootPromise: Promise<BootResult> | null = null;

export function boot(): Promise<BootResult> {
  if (!bootPromise) bootPromise = runBoot();
  return bootPromise;
}

async function runBoot(): Promise<BootResult> {
  const slot = migrateLegacy();
  useStore.persist.setOptions({ name: saveStorageKey(slot.id) });
  await useStore.persist.rehydrate();

  const store = useStore.getState();
  // Drop duplicate narrator ids from older saves (duplicate React keys in NarratorPanel).
  const storyIds = new Set<string>();
  const story = store.story.filter((e) => {
    if (storyIds.has(e.id)) return false;
    storyIds.add(e.id);
    return true;
  });
  if (story.length !== store.story.length) useStore.setState({ story });
  diag.configure({ consoleLevel: store.settings.consoleLevel });
  diag.info("boot", "starting");

  // Persisted roster keeps relationships/memories, but nobody is "online" across
  // a reload — reset presence so the next stream rebuilds the room.
  const cleared = Object.fromEntries(
    Object.entries(store.roster).map(([id, c]) => [
      id,
      { ...normalizeCharacter(c), online: false },
    ]),
  );
  store.setRoster(cleared);

  // Rehydrate the (large) room image from IndexedDB, not localStorage.
  await migrateLegacyRoomImage(slot.id);
  const savedRoom = await loadRoomImage(slot.id);
  if (savedRoom) store.setRoomImage(savedRoom);

  const geminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() ?? "";
  const openRouterOk = await fetchOpenRouterStatus();
  if (openRouterOk) void loadOpenRouterCatalog();

  // Reconcile the persisted backend with what's actually available so the
  // Settings dropdown and HUD chip stop lying. A stale/default "mock" upgrades
  // to a real provider when one exists; an explicit choice that isn't available
  // degrades gracefully instead of silently routing elsewhere.
  const hasGemini = geminiKey.length > 0;
  const effective = effectiveBackend(store.settings.textBackend, hasGemini, openRouterOk);
  if (effective !== store.settings.textBackend) {
    store.setSettings({ textBackend: effective });
  }

  const provider = resolveTextProvider(geminiKey, openRouterOk);
  const llm = new LlmAdapter(provider);
  const imageBackend = resolveImageBackend(geminiKey, openRouterOk);
  const controller = new GameController(llm, imageBackend);

  // Pull persisted portrait/body/presence ids from IndexedDB into memory so the
  // studio overlay and character UI can render them immediately.
  void controller.hydrateImageCache();

  // If the player was mid-stream when they reloaded, rebuild the transient live
  // state (presence, audience, ambient chat) around the persisted session
  // instead of silently dropping them offline.
  if (useStore.getState().session.isLive) controller.resumeLive();

  diag.info("boot", "ready", {
    slot: slot.id,
    backend: effective,
    provider: llm.id,
    mock: llm.isMock,
    image: imageBackend?.id ?? "none",
    geminiKey: geminiKey ? "set" : "absent",
    openRouter: openRouterOk,
  });
  updateActiveMeta({
    characterName: store.settings.streamerName,
    day: store.metrics.day,
    portraitId: store.character.portraitId,
  });
  useStore.getState().setBooted(true);
  return { controller, llm };
}

async function fetchOpenRouterStatus(): Promise<boolean> {
  try {
    const r = await fetch("/__openrouter/status");
    if (!r.ok) return false;
    const j = (await r.json()) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}
