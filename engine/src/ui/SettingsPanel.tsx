import { useEffect } from "react";
import { useStore, type LlmBackend } from "../state/store";
import type { LlmAdapter } from "../llm/adapter";
import {
  imageModelSelectOptions,
  normalizeGeminiTextModel,
  textModelSelectOptions,
} from "../llm/geminiModelOptions";
import type { IndexedWorld } from "../world/indexer";
import type { TileFiller } from "../grid/tileFiller";
import type { TileImageCache } from "../grid/tileImageCache";
import {
  ensureLocationGrid,
  ensureRegionGrid,
  prewarmGridImages,
} from "../dialogue/narrator";
import { OpenRouterModelField } from "./OpenRouterModelField";

type Props = {
  onClose: () => void;
  tileImageCache: TileImageCache;
  tileFiller: TileFiller;
  llm: LlmAdapter;
  world: IndexedWorld;
};

const hasGeminiEnvKey = Boolean(
  (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim(),
);

/**
 * Map / LLM preferences that do not fit in the top HUD strip: LLM backends
 * and models, tile image strategy, and cache recovery actions.
 */
export function SettingsPanel({
  onClose,
  tileImageCache,
  tileFiller,
  llm,
  world,
}: Props) {
  const mode = useStore((s) => s.mode);
  const regionGrid = useStore((s) => s.regionGrid);
  const locationGrid = useStore((s) => s.locationGrid);
  const tileImageMode = useStore((s) => s.tileImageMode);
  const setTileImageMode = useStore((s) => s.setTileImageMode);
  const isLlmReady = useStore((s) => s.isLlmReady);
  const geminiTextModel = useStore((s) => s.geminiTextModel);
  const geminiImageModel = useStore((s) => s.geminiImageModel);
  const setGeminiTextModel = useStore((s) => s.setGeminiTextModel);
  const setGeminiImageModel = useStore((s) => s.setGeminiImageModel);
  const textLlmBackend = useStore((s) => s.textLlmBackend);
  const imageLlmBackend = useStore((s) => s.imageLlmBackend);
  const openRouterTextModel = useStore((s) => s.openRouterTextModel);
  const openRouterImageModel = useStore((s) => s.openRouterImageModel);
  const setTextLlmBackend = useStore((s) => s.setTextLlmBackend);
  const setImageLlmBackend = useStore((s) => s.setImageLlmBackend);
  const setOpenRouterTextModel = useStore((s) => s.setOpenRouterTextModel);
  const setOpenRouterImageModel = useStore((s) => s.setOpenRouterImageModel);

  const activeGrid = mode === "region" ? regionGrid : locationGrid;
  const normalizedGeminiTextModel = normalizeGeminiTextModel(geminiTextModel);

  useEffect(() => {
    if (normalizedGeminiTextModel && normalizedGeminiTextModel !== geminiTextModel) {
      setGeminiTextModel(normalizedGeminiTextModel);
    }
  }, [geminiTextModel, normalizedGeminiTextModel, setGeminiTextModel]);

  const onToggleTileImageMode = () => {
    const next = tileImageMode === "mosaic" ? "per-tile" : "mosaic";
    setTileImageMode(next);
    tileImageCache.setMode(next);
  };

  const onRedraw = () => {
    if (!activeGrid) return;
    void tileImageCache.clearImagesForGrid(activeGrid);
  };

  const onRebuild = async () => {
    if (!activeGrid) return;
    const { scope, ownerId } = activeGrid;
    const regionBiome = activeGrid.biome;
    const ctx = { llm, world, tileFiller, tileImageCache };
    const llmCacheBuster = String(Date.now());
    await tileFiller.clearGrid(scope, ownerId);
    // Drop the live grid from the store so TileGridView does not keep
    // mounting cells for the old layout (which would refetch images while
    // the filler is still building the new spec).
    //
    // If scene-classify (text reclassification) failed and we got a blank
    // fallback grid, skip the image-generation step. Tile art keyed off a
    // deterministic placeholder grid would just be wasted spend, and the
    // next rebuild attempt should start from the live LLM call again.
    const isLlmSourced = (g: { source?: "llm" | "fallback" }): boolean =>
      g.source !== "fallback";

    if (scope === "region") {
      useStore.getState().setRegionGrid(null);
      const newGrid = await ensureRegionGrid(ctx, ownerId, {
        skipPrewarm: true,
        llmCacheBuster,
      });
      if (!isLlmSourced(newGrid)) {
        console.warn(
          "[rebuild] region scene-classify failed; skipping image generation",
        );
        return;
      }
      await tileImageCache.clearImagesForGrid(newGrid);
      prewarmGridImages(tileImageCache, newGrid);
    } else if (scope === "location") {
      useStore.getState().setLocationGrid(null);
      const newGrid = await ensureLocationGrid(ctx, ownerId, regionBiome, {
        skipPrewarm: true,
        llmCacheBuster,
      });
      if (!isLlmSourced(newGrid)) {
        console.warn(
          "[rebuild] location scene-classify failed; skipping image generation",
        );
        return;
      }
      await tileImageCache.clearImagesForGrid(newGrid);
      prewarmGridImages(tileImageCache, newGrid);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal__inner settingsPanel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2>Settings</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="settingsPanel__section">
          <h3 className="settingsPanel__heading">Tile images</h3>
          <p className="settingsPanel__hint">
            Per-tile reuses art by terrain kind; mosaic asks for one large image
            and slices it to the grid. Mosaic mode uses a richer map classifier
            (per-cell painter notes). After switching to mosaic, use Rebuild map
            so existing grids pick that up.
          </p>
          <button
            type="button"
            className="settingsPanel__primaryBtn"
            onClick={onToggleTileImageMode}
            title={
              tileImageMode === "mosaic"
                ? "Switch to one image per (kind, biome)."
                : "Switch to one composite image for the whole grid, sliced locally."
            }
          >
            Tiles: {tileImageMode === "mosaic" ? "mosaic" : "per-tile"} — click
            to toggle
          </button>
          <div className="settingsPanel__btnRow">
            <button
              type="button"
              onClick={() => void onRedraw()}
              disabled={!activeGrid}
              title={
                activeGrid
                  ? `Discard cached images for ${activeGrid.scope} ${activeGrid.ownerId}.`
                  : "No active grid."
              }
            >
              Redraw images
            </button>
            <button
              type="button"
              onClick={() => void onRebuild()}
              disabled={!activeGrid}
              title={
                activeGrid
                  ? `Wipe map spec and images for ${activeGrid.scope} ${activeGrid.ownerId}, then re-ask the LLM.`
                  : "No active grid."
              }
            >
              Rebuild map
            </button>
          </div>
        </section>

        <section className="settingsPanel__section">
          <h3 className="settingsPanel__heading">Text LLM</h3>
          <p className="settingsPanel__hint">
            {isLlmReady
              ? "Backend and model apply on the next request (no reload)."
              : "Set VITE_GEMINI_API_KEY (direct Gemini) and/or OPENROUTER_API_KEY in engine/.env.local. OpenRouter uses the Vite dev proxy only (not in static production builds). The app does not call the OpenAI API directly."}
          </p>
          <label className="settingsPanel__field">
            <span className="settingsPanel__label">Backend</span>
            <select
              className="settingsPanel__select"
              value={textLlmBackend}
              title="Where text completions are sent"
              onChange={(e) => {
                const next = e.target.value as LlmBackend;
                if (next === textLlmBackend) return;
                setTextLlmBackend(next);
              }}
            >
              <option value="gemini">Gemini (browser, API key in bundle)</option>
              <option value="openrouter">OpenRouter (dev proxy)</option>
            </select>
          </label>
          {textLlmBackend === "gemini" ? (
            <label className="settingsPanel__field">
              <span className="settingsPanel__label">Gemini text model</span>
              <select
                className="settingsPanel__select"
                value={normalizedGeminiTextModel}
                disabled={!hasGeminiEnvKey}
                title={normalizedGeminiTextModel}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === normalizedGeminiTextModel) return;
                  setGeminiTextModel(next);
                }}
              >
                {textModelSelectOptions(normalizedGeminiTextModel).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <p className="settingsPanel__hint">
                Auto Router (<code>openrouter/auto</code>) picks a model per
                prompt; see{" "}
                <a
                  href="https://openrouter.ai/docs/guides/routing/routers/auto-router"
                  target="_blank"
                  rel="noreferrer"
                >
                  Auto Router
                </a>
                . Browse the full catalog at{" "}
                <a
                  href="https://openrouter.ai/models"
                  target="_blank"
                  rel="noreferrer"
                >
                  openrouter.ai/models
                </a>
                . Use Custom to paste any id.
              </p>
              <OpenRouterModelField
                kind="text"
                value={openRouterTextModel}
                onChange={setOpenRouterTextModel}
              />
            </>
          )}
        </section>

        <section className="settingsPanel__section">
          <h3 className="settingsPanel__heading">Image LLM</h3>
          <p className="settingsPanel__hint">
            Tile art, portraits, and scene backgrounds use the image backend you
            select. OpenRouter image models use the same chat API with image
            output modalities.
          </p>
          <label className="settingsPanel__field">
            <span className="settingsPanel__label">Backend</span>
            <select
              className="settingsPanel__select"
              value={imageLlmBackend}
              title="Where image generation is sent"
              onChange={(e) => {
                const next = e.target.value as LlmBackend;
                if (next === imageLlmBackend) return;
                setImageLlmBackend(next);
              }}
            >
              <option value="gemini">Gemini (browser)</option>
              <option value="openrouter">OpenRouter (dev proxy)</option>
            </select>
          </label>
          {imageLlmBackend === "gemini" ? (
            <label className="settingsPanel__field">
              <span className="settingsPanel__label">Gemini image model</span>
              <select
                className="settingsPanel__select"
                value={geminiImageModel}
                disabled={!hasGeminiEnvKey}
                title={geminiImageModel}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === geminiImageModel) return;
                  setGeminiImageModel(next);
                }}
              >
                {imageModelSelectOptions(geminiImageModel).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <p className="settingsPanel__hint">
                Image-capable models are listed with image output on{" "}
                <a
                  href="https://openrouter.ai/models?output_modalities=image"
                  target="_blank"
                  rel="noreferrer"
                >
                  openrouter.ai/models
                </a>{" "}
                (filter: image). Use Custom for any id.
              </p>
              <OpenRouterModelField
                kind="image"
                value={openRouterImageModel}
                onChange={setOpenRouterImageModel}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
