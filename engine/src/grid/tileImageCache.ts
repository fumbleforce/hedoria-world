import {
  deleteTileImageRow,
  getTileImageRow,
  listTileImageRows,
  putTileImageRow,
} from "../persist/saveLoad";
import type { ImageProvider } from "../llm/imageAdapter";
import { diag } from "../diag/log";
import type { Tile, TileGrid } from "./tilePrimitives";
import {
  composeMosaicPrompt,
  sliceMosaic,
  type MosaicSlice,
} from "./mosaicImage";

/**
 * Tile illustration cache with two interchangeable strategies.
 *
 *   - `per-tile` (default): one image per `(kind, biome, style)` tuple.
 *     The same kind reuses the same image across regions; changing the
 *     global style rolls every cached image. Exactly ONE image-LLM
 *     call per cache miss, and many cells in many regions hit the
 *     same key. This is the cheapest strategy when an LLM picks a
 *     small palette (the same `grain-field` reuses across dozens of
 *     cells).
 *
 *   - `mosaic`: ONE image per region/location grid. The cache asks the
 *     image model for the whole composition described as a strict
 *     N×M grid, then slices the returned PNG locally into per-cell
 *     PNGs. Each slice is cached under a per-position key
 *     `mosaic|<ownerId>|<x>|<y>|<style>`, so there is no cross-region
 *     reuse but neighbouring tiles can blend at their borders.
 *
 * Both strategies share the same IDB table (`tileImages`) and the same
 * in-memory blob-URL map. The strategy switch is live: `setMode()`
 * notifies subscribers, the renderer re-asks for URLs under the new
 * key scheme, and any missing keys are filled lazily.
 *
 * Crucially, the per-tile and mosaic key spaces don't overlap, so
 * toggling the mode does NOT invalidate the OTHER mode's cached
 * imagery. Switching from per-tile to mosaic and back is free after
 * the first generation in each mode.
 */

export type TileImageMode = "per-tile" | "mosaic";

export type TileImageCacheOptions = {
  saveId: string;
  imageProvider: ImageProvider;
  /**
   * Stable token that participates in the cache key. Bumping it
   * (e.g. via a version constant) invalidates every existing image.
   */
  style?: string;
  /** Output image edge length in pixels (per-tile mode). */
  size?: number;
  /**
   * Per-slice pixel size when the cache asks the image provider for a
   * mosaic. Total request size is `mosaicSliceSize * gridWidth` by
   * `mosaicSliceSize * gridHeight`. The default is large enough that
   * a 5x5 location image fits in 640×640 and a 10x10 region image fits
   * in 1280×1280 — both within typical image-model output limits, and
   * still ≥ TILE_PX after slicing.
   */
  mosaicSliceSize?: number;
  /** Initial mode; can be flipped at runtime via setMode(). */
  initialMode?: TileImageMode;
};

const DEFAULT_STYLE = "painterly-top-down";
const DEFAULT_SIZE = 256;
const DEFAULT_MOSAIC_SLICE_SIZE = 128;

/**
 * Stable, sync per-tile cache key. We URL-encode `kind` + `biome` so
 * the `|` delimiter cannot collide with anything the LLM invents.
 */
export function tileImageKey(
  kind: string,
  biome: string,
  style: string = DEFAULT_STYLE,
): string {
  return `${encodeURIComponent(kind)}|${encodeURIComponent(biome)}|${style}`;
}

/**
 * Cache-busting suffix for mosaic keys. Bump this whenever a change to
 * `composeMosaicPrompt` would otherwise leave stale slices visible.
 *
 *   v1 -> v2: prompt now anonymises named-location anchors (no proper
 *             nouns), so previously-cached v1 slices contained place
 *             names painted across the image and need regeneration.
 *   v2 -> v3: keys now include the grid `scope` ("region" / "location")
 *             so a region and a location sharing a name (e.g. the city
 *             of Avenor inside the region of Avenor) no longer collide
 *             on the same per-position slot. Previously the second
 *             grid to populate would silently overwrite the first.
 */
const MOSAIC_PROMPT_VERSION = "v3";

/**
 * Per-cell mosaic cache key. The first segment `mosaic` is a literal
 * sentinel that cannot appear in a `tileImageKey()` (which always
 * starts with an URL-encoded kind), so the two key spaces are
 * permanently disjoint.
 *
 * `scope` is part of the key because a region and a location are
 * allowed to share a name (capital-city-and-region pairs are common —
 * e.g. Avenor the city sits inside Avenor the region) and the slices
 * for the two are completely different images. Without the scope
 * segment, the second grid to be populated would overwrite the
 * first's slices, and the player would see e.g. city imagery
 * rendered into the region map.
 */
export function mosaicTileKey(
  scope: "region" | "location",
  ownerId: string,
  x: number,
  y: number,
  style: string = DEFAULT_STYLE,
): string {
  return `mosaic|${MOSAIC_PROMPT_VERSION}|${scope}|${encodeURIComponent(ownerId)}|${x}|${y}|${style}`;
}

type Listener = (key: string) => void;

export class TileImageCache {
  private readonly saveId: string;
  private readonly imageProvider: ImageProvider;
  private readonly style: string;
  private readonly size: number;
  private readonly mosaicSliceSize: number;
  private mode: TileImageMode;

  /** key -> blob URL (resolved). Both per-tile and mosaic keys live here. */
  private readonly memUrls = new Map<string, string>();
  /** key -> in-flight resolution promise; deduplicates concurrent callers. */
  private readonly inFlight = new Map<string, Promise<string>>();
  /**
   * One in-flight promise per mosaic owner so concurrent calls for
   * different slices of the same grid share a single big image
   * request. Resolves once every slice has been persisted + memoised.
   */
  private readonly mosaicInFlight = new Map<string, Promise<void>>();
  private readonly listeners = new Set<Listener>();

  constructor(opts: TileImageCacheOptions) {
    this.saveId = opts.saveId;
    this.imageProvider = opts.imageProvider;
    this.style = opts.style ?? DEFAULT_STYLE;
    this.size = opts.size ?? DEFAULT_SIZE;
    this.mosaicSliceSize = opts.mosaicSliceSize ?? DEFAULT_MOSAIC_SLICE_SIZE;
    this.mode = opts.initialMode ?? "per-tile";
  }

  getMode(): TileImageMode {
    return this.mode;
  }

  /**
   * Switch the active strategy. Existing in-memory URLs for the OTHER
   * mode are preserved, so toggling back and forth is essentially free
   * after both modes have generated at least once. Subscribers are
   * notified with the sentinel key `__mode__` so a listening renderer
   * (TileGridView) re-reads peekTile() under the new scheme.
   */
  setMode(mode: TileImageMode): void {
    if (mode === this.mode) return;
    diag.info("image", `tile image mode → ${mode}`, {
      previous: this.mode,
      next: mode,
    });
    this.mode = mode;
    this.notify("__mode__");
  }

  /**
   * Pull every existing `tileImages` row for this save into memory so the
   * first paint of a grid is instant after a reload. Cheap because Dexie
   * fetches Uint8Array bytes lazily — we just convert them to blob URLs.
   */
  async hydrateFromSave(): Promise<void> {
    const rows = await listTileImageRows(this.saveId);
    for (const row of rows) {
      if (!this.memUrls.has(row.key)) {
        const url = bytesToUrl(row.bytes, row.mime);
        this.memUrls.set(row.key, url);
      }
    }
    diag.info("image", `hydrated ${rows.length} cached tile image(s) from IDB`, {
      count: rows.length,
    });
  }

  /**
   * Synchronous peek. Returns a blob URL if the image is already loaded
   * (memory or just-resolved from Dexie via hydrateFromSave). Returns null
   * if the image hasn't been generated yet — callers should fall back to
   * a placeholder and listen via `subscribe()` for the URL becoming ready.
   */
  peek(kind: string, biome: string): string | null {
    const key = tileImageKey(kind, biome, this.style);
    return this.memUrls.get(key) ?? null;
  }

  /**
   * Synchronous peek for a tile within a grid. The current mode decides
   * which key the lookup uses. In `per-tile` mode this is equivalent to
   * `peek(tile.kind, grid.biome)`; in `mosaic` mode it is a per-position
   * key tied to the grid's owner.
   */
  peekTile(grid: TileGrid, x: number, y: number, tile: Tile): string | null {
    const key = this.keyForTile(grid, x, y, tile);
    return this.memUrls.get(key) ?? null;
  }

  /**
   * Get-or-generate. Resolves to a blob URL. Multiple concurrent calls for
   * the same key share one in-flight promise. On any failure, falls back
   * to a deterministic data URL so the UI never breaks.
   */
  async getUrl(kind: string, biome: string): Promise<string> {
    const key = tileImageKey(kind, biome, this.style);
    return this.getOrCreate(key, () => this.resolve(key, kind, biome));
  }

  /**
   * Mode-aware async resolver for a tile within a grid. In `per-tile`
   * mode this is identical to `getUrl(tile.kind, grid.biome)`. In
   * `mosaic` mode, this triggers (or joins) the one-shot whole-grid
   * image request and returns this slice's URL once the slicing
   * completes. Concurrent calls for different cells of the same grid
   * dedupe to a single image request.
   */
  async getUrlForTile(
    grid: TileGrid,
    x: number,
    y: number,
    tile: Tile,
  ): Promise<string> {
    const key = this.keyForTile(grid, x, y, tile);
    if (this.mode === "per-tile") {
      return this.getOrCreate(key, () => this.resolve(key, tile.kind, grid.biome));
    }
    return this.getOrCreate(key, () => this.resolveMosaicSlice(grid, key));
  }

  /**
   * Drop every image (both per-tile and mosaic key spaces) associated
   * with a grid so the next render kicks off a fresh generation. Used
   * by the HUD "Redraw" button to recover from a failed mosaic call
   * (each cell falls back to a deterministic placeholder URL stashed
   * in `memUrls`, and nothing else will dislodge it until a reload).
   *
   * Why both key spaces: the player can toggle modes at any time, so
   * a fallback placeholder may live under either the per-tile OR the
   * mosaic key (or both, if they've been switching back and forth).
   * Wiping both is the only way to guarantee the next paint actually
   * re-asks the provider, regardless of which mode is currently active.
   *
   * Per-tile keys are SHARED across grids (same `(kind, biome)` tuple
   * reuses across regions), so clearing a region's per-tile entries
   * also forces any other region that happened to share those kinds
   * to regenerate them on next view. That's an acceptable trade for
   * a manual user-driven action.
   */
  async clearImagesForGrid(grid: TileGrid): Promise<void> {
    const keys = new Set<string>();
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const tile = grid.tiles[y * grid.width + x];
        if (!tile) continue;
        keys.add(tileImageKey(tile.kind, grid.biome, this.style));
        keys.add(mosaicTileKey(grid.scope, grid.ownerId, x, y, this.style));
      }
    }

    for (const key of keys) {
      const url = this.memUrls.get(key);
      if (url && url.startsWith("blob:")) {
        // Revoke so the GC can drop the underlying blob. Best-effort;
        // older browsers occasionally throw on already-revoked URLs.
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
      this.memUrls.delete(key);
      this.inFlight.delete(key);
    }

    // Also drop the per-grid mosaic dedup lock so the next slice
    // resolver can start a fresh whole-grid request (rather than
    // joining a long-since-resolved-with-fallback promise).
    this.mosaicInFlight.delete(`${grid.scope}::${grid.ownerId}`);

    // Best-effort IDB cleanup; do this in parallel and don't let one
    // failure block the rest.
    await Promise.allSettled(
      [...keys].map((key) => deleteTileImageRow(this.saveId, key)),
    );

    diag.info("image", `cleared ${keys.size} cached image(s) for ${grid.scope} ${grid.ownerId}`, {
      scope: grid.scope,
      ownerId: grid.ownerId,
      count: keys.size,
    });

    // Notify per cleared key so listening cells re-read peekTile and
    // discover the URL is gone, then kick off regeneration via
    // getUrlForTile in their useEffect.
    for (const key of keys) {
      this.notify(key);
    }
  }

  // ------------------------------------------------------------------ private

  private keyForTile(
    grid: TileGrid,
    x: number,
    y: number,
    tile: Tile,
  ): string {
    if (this.mode === "mosaic") {
      return mosaicTileKey(grid.scope, grid.ownerId, x, y, this.style);
    }
    return tileImageKey(tile.kind, grid.biome, this.style);
  }

  /**
   * Common get-or-resolve plumbing shared by both modes: memo hit ->
   * in-flight join -> run the supplied resolver (which is responsible
   * for its own IDB hit + LLM round-trip if needed). On any failure we
   * substitute a deterministic placeholder so the UI never goes blank.
   */
  private async getOrCreate(
    key: string,
    resolver: () => Promise<string>,
  ): Promise<string> {
    const cached = this.memUrls.get(key);
    if (cached) return cached;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = resolver().catch((err) => {
      diag.warn("image", `generation failed; using fallback placeholder`, {
        key,
        mode: this.mode,
        error: err instanceof Error ? err.message : String(err),
      });
      return fallbackPlaceholder(key);
    });
    this.inFlight.set(key, promise);
    try {
      const url = await promise;
      this.memUrls.set(key, url);
      this.notify(key);
      return url;
    } finally {
      this.inFlight.delete(key);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(key: string): void {
    for (const listener of this.listeners) {
      try {
        listener(key);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[tileImageCache] listener threw", err);
      }
    }
  }

  /**
   * Mosaic resolver for a single slice. Tries IDB first (every slice is
   * persisted under its own key). On miss, joins or starts the per-grid
   * mosaic generation, waits for it to complete, then re-reads the
   * memoised URL set up by `fillMosaicForGrid`. If the mosaic call
   * fails outright, falls back to a placeholder for this slice (the
   * remaining slices follow the same path on their own resolvers).
   */
  private async resolveMosaicSlice(
    grid: TileGrid,
    key: string,
  ): Promise<string> {
    const persisted = await getTileImageRow(this.saveId, key);
    if (persisted) {
      diag.debug("image", `mosaic cache hit (IDB)`, {
        key,
        bytes: persisted.bytes.byteLength,
        mime: persisted.mime,
      });
      return bytesToUrl(persisted.bytes, persisted.mime);
    }

    await this.fillMosaicForGrid(grid);
    const url = this.memUrls.get(key);
    if (url) return url;
    return fallbackPlaceholder(key);
  }

  /**
   * Generate the whole-grid mosaic image and slice it into per-cell
   * PNGs. Deduplicated per `grid.ownerId` so concurrent slice resolvers
   * (which fire simultaneously when the grid first paints) share a
   * single image-LLM round-trip.
   *
   * Image y is flipped on the way out: image row 0 is the topmost
   * (northernmost) and maps to grid y = height - 1 - r, so the
   * cartographer's convention (+y = NORTH) is preserved.
   */
  private async fillMosaicForGrid(grid: TileGrid): Promise<void> {
    const lockKey = `${grid.scope}::${grid.ownerId}`;
    const existing = this.mosaicInFlight.get(lockKey);
    if (existing) return existing;

    const promise = (async () => {
      const prompt = composeMosaicPrompt(grid, this.style);
      const requestW = this.mosaicSliceSize * grid.width;
      const requestH = this.mosaicSliceSize * grid.height;
      const startedAt = performance.now();
      diag.info("image", `mosaic request → provider for ${grid.ownerId}`, {
        scope: grid.scope,
        ownerId: grid.ownerId,
        provider: this.imageProvider.id,
        size: `${requestW}x${requestH}`,
        gridSize: `${grid.width}x${grid.height}`,
        prompt,
      });

      const result = await this.imageProvider.generate({
        prompt,
        width: requestW,
        height: requestH,
      });
      const slices = await sliceMosaic(result, grid.width, grid.height);
      const durationMs = Math.round(performance.now() - startedAt);
      diag.info("image", `mosaic response (${durationMs}ms) for ${grid.ownerId}`, {
        scope: grid.scope,
        ownerId: grid.ownerId,
        sliceCount: slices.length,
        rawBytes: result.bytes.byteLength,
        rawSize: `${result.width}x${result.height}`,
        durationMs,
      });

      await this.persistSlices(grid, slices);
    })().finally(() => {
      this.mosaicInFlight.delete(lockKey);
    });
    this.mosaicInFlight.set(lockKey, promise);
    return promise;
  }

  private async persistSlices(
    grid: TileGrid,
    slices: MosaicSlice[],
  ): Promise<void> {
    for (const slice of slices) {
      // Image row 0 is the top of the image = NORTH = grid y = height-1.
      const x = slice.imgCol;
      const y = grid.height - 1 - slice.imgRow;
      const key = mosaicTileKey(grid.scope, grid.ownerId, x, y, this.style);
      await putTileImageRow({
        saveId: this.saveId,
        key,
        bytes: slice.bytes,
        mime: slice.mime,
        width: slice.width,
        height: slice.height,
        source: "llm",
        generatedAt: Date.now(),
      });
      const url = bytesToUrl(slice.bytes, slice.mime);
      this.memUrls.set(key, url);
      this.notify(key);
    }
  }

  private async resolve(key: string, kind: string, biome: string): Promise<string> {
    // 1. Persisted PNG?
    const persisted = await getTileImageRow(this.saveId, key);
    if (persisted) {
      diag.debug("image", `cache hit (IDB) for ${kind}`, {
        kind,
        biome,
        key,
        bytes: persisted.bytes.byteLength,
        mime: persisted.mime,
      });
      return bytesToUrl(persisted.bytes, persisted.mime);
    }

    // 2. Generate directly. We hand the image model a templated prompt
    //    built from (kind, biome, style) rather than first round-tripping
    //    a text LLM to invent a sentence: the image model is itself an
    //    LLM and reads structured prompts just as well, and we save one
    //    text-LLM call per unique tile kind (the dominant cost on a free
    //    tier).
    const prompt = composeImagePrompt(kind, biome, this.style);
    const startedAt = performance.now();
    diag.info("image", `image request → provider for ${kind}`, {
      kind,
      biome,
      key,
      provider: this.imageProvider.id,
      size: this.size,
      prompt,
    });
    const result = await this.imageProvider.generate({
      prompt,
      width: this.size,
      height: this.size,
    });
    const durationMs = Math.round(performance.now() - startedAt);

    await putTileImageRow({
      saveId: this.saveId,
      key,
      bytes: result.bytes,
      mime: result.mime,
      width: result.width,
      height: result.height,
      source: "llm",
      generatedAt: Date.now(),
    });
    diag.info("image", `image response (${durationMs}ms) for ${kind}`, {
      kind,
      biome,
      key,
      bytes: result.bytes.byteLength,
      width: result.width,
      height: result.height,
      durationMs,
    });
    return bytesToUrl(result.bytes, result.mime);
  }
}

/**
 * Build the image-generation prompt from structured fields. Keeping the
 * template here (rather than persisted) means a style/template tweak
 * applies to every freshly-generated tile without DB migration.
 */
function composeImagePrompt(kind: string, biome: string, style: string): string {
  const readableKind = kind.replace(/-/g, " ");
  const readableBiome = biome.replace(/-/g, " ");
  return [
    `A top-down square game tile depicting a ${readableKind} in a ${readableBiome} environment.`,
    "Use dominant colours and lighting that read clearly at a small thumbnail size.",
    "No people, no text, no UI elements, no borders.",
    `Art style: ${style}.`,
  ].join(" ");
}

function bytesToUrl(bytes: Uint8Array, mime: string): string {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return URL.createObjectURL(blob);
}

/**
 * Tiny deterministic placeholder used when both the LLM and the image
 * provider fail. A 1x1 SVG data URL whose fill colour is derived from the
 * cache key, so similar kinds at least look distinct on screen.
 *
 * Crucial detail: the `rgb(r,g,b)` value inside the SVG contains literal
 * `(` and `)`, and `encodeURIComponent` does NOT escape those characters.
 * Browsers parse a CSS `url(data:...)` form by counting parens, so the
 * inner `)` from `rgb(...)` would close the outer `url(...)` early, leave
 * the rule invalid, and the cell would fall through to its base
 * background — which is exactly the "blank blue" the player observed
 * once every cell had hit its fallback. We explicitly substitute the
 * parens (`%28`/`%29`) and use `rgb` in the SVG instead of literal
 * parens, so the data URL is parens-free and the CSS rule survives.
 */
function fallbackPlaceholder(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = (h >>> 16) & 0xff;
  const g = (h >>> 8) & 0xff;
  const b = h & 0xff;
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect width='1' height='1' fill='${hex}'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")}`;
}
