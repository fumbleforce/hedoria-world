import { LlmAdapter } from "./llm/adapter";
import { resolveTextProvider } from "./llm/providers";
import { resolveImageBackend } from "./llm/imageProvider";
import { loadRoomImage, migrateLegacyRoomImage } from "./persist/imageStore";
import { migrateLegacy, saveStorageKey, updateActiveMeta } from "./persist/saves";
import { GameController } from "./game/controller";
import { useStore } from "./state/store";
import { diag } from "./diag/log";

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
  diag.configure({ consoleLevel: store.settings.consoleLevel });
  diag.info("boot", "starting");

  // Persisted roster keeps relationships/memories, but nobody is "online" across
  // a reload — reset presence so the next stream rebuilds the room.
  const cleared = Object.fromEntries(
    Object.entries(store.roster).map(([id, c]) => [id, { ...c, online: false }]),
  );
  store.setRoster(cleared);

  // Rehydrate the (large) room image from IndexedDB, not localStorage.
  await migrateLegacyRoomImage(slot.id);
  const savedRoom = await loadRoomImage(slot.id);
  if (savedRoom) store.setRoomImage(savedRoom);

  const geminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() ?? "";
  const openRouterOk = await fetchOpenRouterStatus();
  const provider = resolveTextProvider(geminiKey, openRouterOk);
  const llm = new LlmAdapter(provider);
  const imageBackend = resolveImageBackend(geminiKey, openRouterOk);
  const controller = new GameController(llm, imageBackend);

  // Pull persisted portrait/body/presence ids from IndexedDB into memory so the
  // studio overlay and character UI can render them immediately.
  void controller.hydrateImageCache();

  diag.info("boot", "ready", {
    slot: slot.id,
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
