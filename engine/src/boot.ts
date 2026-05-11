import { LlmAdapter } from "./llm/adapter";
import {
  MockImageProvider,
  StoreBackedGeminiImageProvider,
  type ImageProvider,
} from "./llm/imageAdapter";
import {
  DelegatingImageProvider,
  StoreBackedOpenRouterImageProvider,
} from "./llm/openRouterImageProvider";
import {
  DelegatingTextLlmProvider,
  StoreBackedGeminiTextProvider,
} from "./llm/providers";
import { migrateOpenRouterModelsInStore } from "./llm/openRouterStoreMigration";
import { StoreBackedOpenRouterTextProvider } from "./llm/openRouterTextProvider";
import { MockProvider } from "./llm/mockProvider";
import type { LlmProvider } from "./llm/types";
import { loadPacks, loadWorldFromPack, type PackInfo } from "./world/loader";
import { buildWorldIndex, type IndexedWorld } from "./world/indexer";
import { ensureStoragePersistence, getOrCreateSave } from "./persist/saveLoad";
import { TileImageCache } from "./grid/tileImageCache";
import { SceneBackgroundCache } from "./scene/sceneBackgroundCache";
import { TileFiller } from "./grid/tileFiller";
import { Narrator, ensureRegionGrid } from "./dialogue/narrator";
import { WorldNarrator } from "./dialogue/worldNarrator";
import { readPersistedPlayerParty, useStore } from "./state/store";
import { diag } from "./diag/log";

/**
 * One-shot boot sequence. Resolves to a fully-wired set of services the
 * top-level App component holds onto for the rest of the session:
 *
 *   - `world` — validated config.json + indexed views (npcs by location, etc.)
 *   - `narrator` — tool-call dispatcher (the engine's only mutation point)
 *   - `sceneRunner` — composes prompts + dispatches results for scene mode
 *   - `tileImageCache` — kind+biome -> blob URL, persisted to Dexie
 *   - `saveId` — used by other call sites that touch the persistence layer
 *
 * On failure the function still resolves: it sets `useStore.bootError` so
 * the UI can surface the message instead of leaving the page blank.
 */
export type BootResult = {
  world: IndexedWorld;
  narrator: Narrator;
  worldNarrator: WorldNarrator;
  tileImageCache: TileImageCache;
  /**
   * Direct handle to the tile-grid filler. Exposed so the HUD
   * "Rebuild" action can wipe a region/location's cached grid spec
   * and re-run the LLM (typically when the persisted geography no
   * longer matches the authored prose).
   */
  tileFiller: TileFiller;
  /**
   * Direct handle to the LLM adapter. Forwarded so callers that need
   * to reconstruct a NarratorContext (e.g. to call `ensureRegionGrid`
   * from outside the boot flow) can do so without rewiring the
   * narrator's internals.
   */
  llm: LlmAdapter;
  /**
   * Direct handle to the image provider so UI surfaces outside the
   * tile-cache hot path (e.g. the character portrait generator) can
   * request one-off images without going through the per-tile or
   * mosaic key pipeline.
   */
  imageProvider: ImageProvider;
  /** Cached widescreen backgrounds for per-tile scene mode. */
  sceneBackgroundCache: SceneBackgroundCache;
  saveId: string;
};

const DEFAULT_REGION_ID = "Avenor";
const FALLBACK_PACK_ID = "hedoria";

/**
 * Module-level boot singleton. React 19 StrictMode runs every effect
 * mount-cleanup-mount in dev, which without this guard would fire two
 * concurrent boot sequences against the LLM, IndexedDB, and image cache.
 * Worse, since the first request can succeed and write a cached grid
 * while a parallel second request is still running and may hit a 429,
 * the loser would overwrite the winner with a blank fallback. Returning
 * the same in-flight promise to both callers eliminates the race.
 */
let bootPromise: Promise<BootResult | null> | null = null;

export function boot(): Promise<BootResult | null> {
  if (!bootPromise) {
    bootPromise = runBoot();
  }
  return bootPromise;
}

async function runBoot(): Promise<BootResult | null> {
  const store = useStore.getState();
  store.setBootError(null);
  store.setBootAwaitingPackChoice(false);
  const startedAt = performance.now();
  const stage = (message: string, data?: Record<string, unknown>) => {
    diag.info("boot", message, {
      elapsedMs: Math.round(performance.now() - startedAt),
      ...(data ?? {}),
    });
  };

  try {
    stage("start");
    void ensureStoragePersistence();

    // ----- Resolve which authored pack to load (must have ≥1 region).
    //
    // If `?pack=<id>` is present and valid, only that pack is tried — so a
    // bookmark stays pinned to one world.
    //
    // Otherwise we probe in order: last persisted choice → `hedoria` → each
    // pack from the server until one defines regions (cold boot can skip an
    // empty stub pack and land on a playable world).
    stage("list packs");
    const packs = await loadPacks();
    store.setAvailablePacks(packs);
    if (packs.length === 0) {
      throw new Error(
        "No packs found under /packs/. Add at least one packs/<id>/manifest.json before booting.",
      );
    }

    const params = new URLSearchParams(window.location.search);
    const persistedPackId = store.currentPackId;
    const urlPackRaw = params.get("pack");
    const urlPackValid =
      urlPackRaw && packs.some((p) => p.packId === urlPackRaw)
        ? urlPackRaw
        : null;

    const probeOrder = buildPackProbeOrder(packs, urlPackValid, persistedPackId);
    stage("pack probe order", {
      packs: probeOrder,
      explicitUrl: urlPackValid,
    });

    let loaded: Awaited<ReturnType<typeof loadWorldFromPack>> | undefined;
    let chosenPackId: string | undefined;
    for (const packId of probeOrder) {
      stage("fetch pack try", { packId });
      const candidate = await loadWorldFromPack(packId);
      if (Object.keys(candidate.data.regions).length > 0) {
        loaded = candidate;
        chosenPackId = packId;
        break;
      }
    }

    if (!loaded || !chosenPackId) {
      const hint = urlPackValid
        ? `Pack "${urlPackValid}" has no regions. Choose another world below, or add regions to that pack's config.`
        : `None of your packs define any regions yet. Choose a world below after adding regions to its config.`;
      store.setBootAwaitingPackChoice(true, hint);
      return null;
    }

    if (persistedPackId !== chosenPackId) {
      store.setCurrentPackId(chosenPackId);
    }
    stage("pack selected", {
      packId: chosenPackId,
      total: packs.length,
      requested: urlPackRaw ?? persistedPackId ?? null,
    });

    stage("config ok", {
      packId: chosenPackId,
      regions: Object.keys(loaded.data.regions).length,
      locations: Object.keys(loaded.data.locations).length,
      quests: Object.keys(loaded.data.quests).length,
      npcs: Object.keys(loaded.data.npcs).length,
    });
    const world = buildWorldIndex(loaded.data, []);

    const partyIds = readPersistedPlayerParty(chosenPackId).filter(
      (id) => loaded.data.npcs[id] !== undefined,
    );
    store.setPlayerPartyNpcIds(partyIds);

    // Each pack gets its own save row so switching worlds doesn't mix
    // tile images, transcripts, or scene specs across canons.
    const configHash = quickHash(JSON.stringify(loaded.data));
    const saveId = `pack-${chosenPackId}`;
    const save = await getOrCreateSave(configHash, configHash, saveId);
    store.setSaveId(save.saveId);
    stage("save resolved", { saveId: save.saveId });

    const openRouterOk = await fetchOpenRouterStatus();
    const geminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim();
    if (openRouterOk) {
      // Pull the live catalog and rewrite any stale persisted ids before any
      // request goes out, so logs / cache keys match what gets sent.
      await migrateOpenRouterModelsInStore();
    }
    const llmProvider = resolveLlmProvider(geminiKey ?? "", openRouterOk);
    store.setLlmReady(llmProvider.id !== "mock-local");
    const imageProvider = resolveImageProvider(geminiKey ?? "", openRouterOk);
    stage("providers resolved", {
      llmProvider: llmProvider.id,
      imageProvider: imageProvider.id,
      live: llmProvider.id !== "mock-local",
      openRouterOk,
      geminiTextModel: useStore.getState().geminiTextModel,
      geminiImageModel: useStore.getState().geminiImageModel,
    });

    const llm = new LlmAdapter(llmProvider, save.saveId);

    const tileImageCache = new TileImageCache({
      saveId: save.saveId,
      imageProvider,
      // Honour the user's last choice on boot. The HUD toggle calls
      // both `setTileImageMode` on the store and `setMode` on the
      // cache, so the two stay in lock-step at runtime; here at boot
      // we seed the cache from the persisted store value.
      initialMode: store.tileImageMode,
    });
    await tileImageCache.hydrateFromSave();
    stage("tileImageCache hydrated");

    const sceneBackgroundCache = new SceneBackgroundCache({
      saveId: save.saveId,
      imageProvider,
    });

    const tileFiller = new TileFiller({
      saveId: save.saveId,
      llm,
      world: loaded.data,
    });

    const narrator = new Narrator({ llm, world, tileFiller, tileImageCache });
    const worldNarrator = new WorldNarrator({ llm, narrator, world });

    // Pick the configured starting region. Falls back to the first available
    // region if Avenor isn't authored in this world. `params` was parsed
    // above for the pack selector — reuse it for the region override.
    const requestedRegion = params.get("region") ?? DEFAULT_REGION_ID;
    const regionId = world.regionsById[requestedRegion]
      ? requestedRegion
      : Object.keys(world.regionsById)[0];
    if (!regionId) {
      throw new Error(
        `Internal error: pack '${chosenPackId}' reported regions but none resolved for start.`,
      );
    }
    store.setCurrentRegionId(regionId);
    stage("starting region", { regionId });

    const grid = await ensureRegionGrid(
      { llm, world, tileFiller, tileImageCache },
      regionId,
    );
    stage("region grid ready", {
      regionId,
      width: grid.width,
      height: grid.height,
      biome: grid.biome,
    });

    // Spawn the player on the central cell so anchors are reachable in <=5 steps.
    store.setRegionPos([
      Math.floor(grid.width / 2),
      Math.floor(grid.height / 2),
    ]);
    store.setMode("region");

    stage("done");
    return {
      world,
      narrator,
      worldNarrator,
      tileImageCache,
      tileFiller,
      llm,
      imageProvider,
      sceneBackgroundCache,
      saveId: save.saveId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diag.error("boot", "boot failed", {
      error: err instanceof Error ? err : message,
    });
    store.setBootError(message);
    return null;
  }
}

/**
 * Order of packs to load when searching for a playable world (non-empty
 * `regions`). With an explicit `?pack=` we only try that id; otherwise we
 * walk persisted → hedoria → discovery order.
 */
function buildPackProbeOrder(
  packs: PackInfo[],
  urlPackValid: string | null,
  persistedPackId: string | null,
): string[] {
  const ids = new Set(packs.map((p) => p.packId));
  const out: string[] = [];
  const add = (id: string | null) => {
    if (id && ids.has(id) && !out.includes(id)) out.push(id);
  };
  if (urlPackValid) {
    add(urlPackValid);
    return out;
  }
  add(persistedPackId);
  add(FALLBACK_PACK_ID);
  for (const p of packs) {
    add(p.packId);
  }
  return out;
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

function resolveLlmProvider(geminiApiKey: string, openRouterOk: boolean): LlmProvider {
  const gemini = geminiApiKey ? new StoreBackedGeminiTextProvider(geminiApiKey) : null;
  const openRouter = openRouterOk ? new StoreBackedOpenRouterTextProvider() : null;
  if (gemini || openRouter) {
    return new DelegatingTextLlmProvider(gemini, openRouter);
  }
  console.warn(
    "[boot] No text LLM: set VITE_GEMINI_API_KEY and/or OPENROUTER_API_KEY (dev proxy) — using MockProvider.",
  );
  return new MockProvider();
}

function resolveImageProvider(geminiApiKey: string, openRouterOk: boolean): ImageProvider {
  const gemini = geminiApiKey ? new StoreBackedGeminiImageProvider(geminiApiKey) : null;
  const openRouter = openRouterOk ? new StoreBackedOpenRouterImageProvider() : null;
  if (gemini || openRouter) {
    return new DelegatingImageProvider(gemini, openRouter);
  }
  return new MockImageProvider();
}

/**
 * Cheap non-cryptographic hash of the loaded canon. Used purely as a
 * "config has changed" smoke signal for the saves table. Not intended
 * to be collision-resistant — any two distinct config.json blobs
 * producing the same hash would just re-use the same save row.
 */
function quickHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `cfg-${(h >>> 0).toString(16)}`;
}
