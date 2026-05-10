import { LlmAdapter } from "./llm/adapter";
import {
  GeminiImageProvider,
  MockImageProvider,
  type ImageProvider,
} from "./llm/imageAdapter";
import {
  createGeminiProvider,
} from "./llm/providers";
import { MockProvider } from "./llm/mockProvider";
import type { LlmProvider } from "./llm/types";
import { loadPacks, loadWorldFromPack, type PackInfo } from "./world/loader";
import {
  buildWorldIndex,
  type IndexedWorld,
} from "./world/indexer";
import { ensureStoragePersistence, getOrCreateSave } from "./persist/saveLoad";
import { TileImageCache } from "./grid/tileImageCache";
import { TileFiller } from "./grid/tileFiller";
import { Narrator, ensureRegionGrid } from "./dialogue/narrator";
import { WorldNarrator } from "./dialogue/worldNarrator";
import { useStore } from "./state/store";
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

    // ----- Resolve which authored pack to load.
    //
    // Precedence:
    //   1. `?pack=<id>` query string (developer override, sticky via step 2)
    //   2. `engine.packId` in localStorage (last user choice)
    //   3. The `hedoria` pack if it exists (canonical default)
    //   4. The first pack returned by the server
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
    const chosenPackId = resolvePackId(packs, {
      fromUrl: params.get("pack"),
      persisted: persistedPackId,
    });
    if (persistedPackId !== chosenPackId) {
      store.setCurrentPackId(chosenPackId);
    }
    stage("pack selected", {
      packId: chosenPackId,
      total: packs.length,
      requested: params.get("pack") ?? persistedPackId ?? null,
    });

    stage("fetch pack");
    const loaded = await loadWorldFromPack(chosenPackId);
    stage("config ok", {
      packId: chosenPackId,
      regions: Object.keys(loaded.data.regions).length,
      locations: Object.keys(loaded.data.locations).length,
      quests: Object.keys(loaded.data.quests).length,
      npcs: Object.keys(loaded.data.npcs).length,
    });
    const world = buildWorldIndex(loaded.data, []);

    // Each pack gets its own save row so switching worlds doesn't mix
    // tile images, transcripts, or scene specs across canons.
    const configHash = quickHash(JSON.stringify(loaded.data));
    const saveId = `pack-${chosenPackId}`;
    const save = await getOrCreateSave(configHash, configHash, saveId);
    store.setSaveId(save.saveId);
    stage("save resolved", { saveId: save.saveId });

    const llmProvider = resolveLlmProvider();
    store.setLlmReady(llmProvider.id !== "mock-local");
    const imageProvider = resolveImageProvider();
    stage("providers resolved", {
      llmProvider: llmProvider.id,
      imageProvider: imageProvider.id,
      live: llmProvider.id !== "mock-local",
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
        `No regions in pack '${chosenPackId}' — populate \`regions\` before launching the engine.`,
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
      saveId: save.saveId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diag.error("boot", "boot failed", { error: err instanceof Error ? err : message });
    store.setBootError(message);
    return null;
  }
}

/**
 * Apply the URL-param / localStorage / fallback precedence and snap the
 * result onto a pack that actually exists. Unknown ids are ignored
 * (and logged in `pack selected.requested`) rather than failing boot
 * outright, so e.g. an old bookmark pointing at a renamed pack still
 * launches into a sensible world.
 */
function resolvePackId(
  packs: PackInfo[],
  prefs: { fromUrl: string | null; persisted: string | null },
): string {
  const ids = new Set(packs.map((p) => p.packId));
  const tryId = (id: string | null): string | null =>
    id && ids.has(id) ? id : null;
  return (
    tryId(prefs.fromUrl) ??
    tryId(prefs.persisted) ??
    tryId(FALLBACK_PACK_ID) ??
    packs[0]!.packId
  );
}

function resolveLlmProvider(): LlmProvider {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (apiKey && apiKey.length > 0) {
    const model =
      (import.meta.env.VITE_GEMINI_TEXT_MODEL as string | undefined) ??
      "gemini-2.5-flash-lite";
    return createGeminiProvider(apiKey, model);
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[boot] VITE_GEMINI_API_KEY is not set — using MockProvider (deterministic stub responses).",
  );
  return new MockProvider();
}

function resolveImageProvider(): ImageProvider {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (apiKey && apiKey.length > 0) {
    const model =
      (import.meta.env.VITE_GEMINI_IMAGE_MODEL as string | undefined) ??
      "gemini-3.1-flash-image-preview";
    return new GeminiImageProvider(apiKey, model);
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
