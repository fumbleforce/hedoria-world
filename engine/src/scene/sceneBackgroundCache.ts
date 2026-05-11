import type { ImageProvider } from "../llm/imageAdapter";
import { getTileImageRow, putTileImageRow } from "../persist/saveLoad";
import { diag } from "../diag/log";

/**
 * Widescreen scene establishing shots for the per-tile "room" view. Keys
 * live in the `tileImages` Dexie table under a `scene-bg|…` prefix so they
 * never collide with map tile art.
 */
const SCENE_BG_VERSION = "v1";
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 576;

type Listener = (key: string) => void;

export type SceneBackgroundRequest = {
  locationId: string;
  locationName: string;
  /** Short prose for the image model (not the cache key). */
  locationBrief: string;
  tileX: number;
  tileY: number;
  tileKind: string;
  tileLabel?: string;
};

function buildSceneBackgroundKey(req: SceneBackgroundRequest): string {
  const label = (req.tileLabel ?? "").trim();
  return [
    "scene-bg",
    SCENE_BG_VERSION,
    encodeURIComponent(req.locationId),
    String(req.tileX),
    String(req.tileY),
    encodeURIComponent(req.tileKind),
    encodeURIComponent(label),
  ].join("|");
}

function bytesToUrl(bytes: Uint8Array, mime: string): string {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  return URL.createObjectURL(blob);
}

function fallbackScenePlaceholder(key: string): string {
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

export function composeSceneBackgroundPrompt(req: SceneBackgroundRequest): string {
  const readableKind = req.tileKind.replace(/-/g, " ");
  const spot =
    (req.tileLabel?.trim() || "").length > 0
      ? `${readableKind} (${req.tileLabel!.trim()})`
      : readableKind;
  const place = req.locationName.trim() || req.locationId;
  const brief =
    req.locationBrief.trim().length > 0
      ? req.locationBrief.trim().slice(0, 420)
      : "";

  const lines = [
    `Wide cinematic establishing shot of ${spot} within or clearly belonging to ${place}.`,
    "Fantasy RPG environment — atmospheric lighting, sense of space and mood.",
    "No people, no figures, no silhouettes, no faces. No text, letters, signs, or UI.",
    "Painterly illustration style; evocative but not photorealistic.",
  ];
  if (brief) {
    lines.splice(2, 0, `Setting context: ${brief}`);
  }
  return lines.join(" ");
}

export type SceneBackgroundCacheOptions = {
  saveId: string;
  imageProvider: ImageProvider;
  width?: number;
  height?: number;
};

export class SceneBackgroundCache {
  private readonly saveId: string;
  private readonly imageProvider: ImageProvider;
  private readonly width: number;
  private readonly height: number;

  private readonly memUrls = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly listeners = new Set<Listener>();

  constructor(opts: SceneBackgroundCacheOptions) {
    this.saveId = opts.saveId;
    this.imageProvider = opts.imageProvider;
    this.width = opts.width ?? DEFAULT_WIDTH;
    this.height = opts.height ?? DEFAULT_HEIGHT;
  }

  /** Sync peek — blob URL if already resolved in memory. */
  peek(req: SceneBackgroundRequest): string | null {
    const key = buildSceneBackgroundKey(req);
    return this.memUrls.get(key) ?? null;
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
        console.warn("[sceneBackgroundCache] listener threw", err);
      }
    }
  }

  /**
   * Resolve background URL: memory hit → IDB → generate → deterministic fallback.
   */
  async getUrl(req: SceneBackgroundRequest): Promise<string> {
    const key = buildSceneBackgroundKey(req);
    const cached = this.memUrls.get(key);
    if (cached) {
      // UI may mount after the URL was stored (e.g. Strict Mode remount, sync return).
      this.notify(key);
      return cached;
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = this.resolve(key, req).catch((err) => {
      diag.warn("image", "scene background generation failed; placeholder", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return fallbackScenePlaceholder(key);
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

  private async resolve(key: string, req: SceneBackgroundRequest): Promise<string> {
    const persisted = await getTileImageRow(this.saveId, key);
    if (persisted) {
      diag.debug("image", "scene background cache hit (IDB)", {
        key,
        bytes: persisted.bytes.byteLength,
      });
      return bytesToUrl(persisted.bytes, persisted.mime);
    }

    const prompt = composeSceneBackgroundPrompt(req);
    const startedAt = performance.now();
    diag.info("image", "scene background request → provider", {
      key,
      provider: this.imageProvider.id,
      size: `${this.width}x${this.height}`,
      promptLength: prompt.length,
    });

    const result = await this.imageProvider.generate({
      prompt,
      width: this.width,
      height: this.height,
    });

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

    diag.info("image", `scene background response (${Math.round(performance.now() - startedAt)}ms)`, {
      key,
      bytes: result.bytes.byteLength,
    });

    return bytesToUrl(result.bytes, result.mime);
  }
}
