import { useStore } from "../state/store";
import type { LlmAdapter } from "../llm/adapter";
import {
  imageModelSelectOptions,
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

type Props = {
  onClose: () => void;
  tileImageCache: TileImageCache;
  tileFiller: TileFiller;
  llm: LlmAdapter;
  world: IndexedWorld;
};

/**
 * Map / LLM preferences that do not fit in the top HUD strip: Gemini model
 * ids, tile image strategy, and cache recovery actions.
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

  const activeGrid = mode === "region" ? regionGrid : locationGrid;

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
    if (scope === "region") {
      useStore.getState().setRegionGrid(null);
      const newGrid = await ensureRegionGrid(ctx, ownerId, {
        skipPrewarm: true,
        llmCacheBuster,
      });
      await tileImageCache.clearImagesForGrid(newGrid);
      prewarmGridImages(tileImageCache, newGrid);
    } else if (scope === "location") {
      useStore.getState().setLocationGrid(null);
      const newGrid = await ensureLocationGrid(ctx, ownerId, regionBiome, {
        skipPrewarm: true,
        llmCacheBuster,
      });
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
            and slices it to the grid.
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
          <h3 className="settingsPanel__heading">Gemini models</h3>
          <p className="settingsPanel__hint">
            {isLlmReady
              ? "Changing a model reloads the page so text and image clients reconnect with the new id."
              : "Set VITE_GEMINI_API_KEY in engine/.env to enable live Gemini."}
          </p>
          <label className="settingsPanel__field">
            <span className="settingsPanel__label">Text model</span>
            <select
              className="settingsPanel__select"
              value={geminiTextModel}
              disabled={!isLlmReady}
              title={geminiTextModel}
              onChange={(e) => {
                const next = e.target.value;
                if (next === geminiTextModel) return;
                setGeminiTextModel(next);
                window.location.reload();
              }}
            >
              {textModelSelectOptions(geminiTextModel).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="settingsPanel__field">
            <span className="settingsPanel__label">Image model</span>
            <select
              className="settingsPanel__select"
              value={geminiImageModel}
              disabled={!isLlmReady}
              title={geminiImageModel}
              onChange={(e) => {
                const next = e.target.value;
                if (next === geminiImageModel) return;
                setGeminiImageModel(next);
                window.location.reload();
              }}
            >
              {imageModelSelectOptions(geminiImageModel).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        </section>
      </div>
    </div>
  );
}
