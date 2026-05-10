import * as THREE from "three";
import type { ImageProvider } from "../llm/imageAdapter";
import { getTextureRow, putTextureRow } from "../persist/saveLoad";
import type { TextureRow } from "../persist/db";
import { buildTexturePrompt, textureKey } from "./llm/texturePrompt";
import type { SurfaceCondition, SurfaceMaterial } from "./sceneSpec";
import type { TextureLibrary } from "./textureLibrary";

export type TextureExpansionInput = {
  material: SurfaceMaterial;
  condition: SurfaceCondition;
  palette: string[];
  variant?: string;
};

export type TextureExpansionOptions = {
  library: TextureLibrary;
  provider: ImageProvider;
  saveId: string;
  /** When true, do not actually call the provider — only resolve from cache. */
  offline?: boolean;
  /** Texture dimensions; defaults to 256x256 to keep payloads tight. */
  width?: number;
  height?: number;
};

/**
 * Runtime texture expansion. On a request:
 *  1. Returns immediately from the in-memory texture library if present.
 *  2. Otherwise checks IndexedDB for a previously generated texture for this save.
 *  3. Otherwise calls the image provider, persists the bytes, and registers the
 *     result with the library so renderers receive a subscription update.
 *
 * In all cases the caller can keep using the surface palette as a synchronous
 * fallback; this function is fire-and-forget from the renderer's perspective.
 */
export class TextureExpansion {
  private readonly inFlight = new Map<string, Promise<THREE.Texture | null>>();
  private readonly options: TextureExpansionOptions;

  constructor(options: TextureExpansionOptions) {
    this.options = options;
  }

  /** Returns the cache key that {@link request} would use. */
  keyFor(input: TextureExpansionInput): string {
    return textureKey(input.material, input.condition, input.variant);
  }

  /**
   * Request a texture; returns immediately with whatever is currently in memory
   * and asynchronously fills in the rest. The promise resolves once the texture
   * has been generated or loaded from a persistent layer (or rejects after a
   * failure has been swallowed by registering nothing).
   */
  request(input: TextureExpansionInput): Promise<THREE.Texture | null> {
    const key = this.keyFor(input);
    const peeked = this.options.library.peek(key);
    if (peeked) return Promise.resolve(peeked);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.resolve(key, input);
    this.inFlight.set(key, promise);
    promise.finally(() => {
      this.inFlight.delete(key);
    });
    return promise;
  }

  private async resolve(key: string, input: TextureExpansionInput): Promise<THREE.Texture | null> {
    try {
      const fromDb = await getTextureRow(this.options.saveId, key);
      if (fromDb) {
        const texture = await bytesToTexture(fromDb.bytes, fromDb.mime);
        if (texture) {
          this.options.library.registerOverride(key, texture);
          return texture;
        }
      }
      if (this.options.offline) return null;

      const prompt = buildTexturePrompt({
        material: input.material,
        condition: input.condition,
        paletteHint: input.palette,
        variant: input.variant,
      });
      const response = await this.options.provider.generate({
        prompt,
        width: this.options.width ?? 256,
        height: this.options.height ?? 256,
        variant: input.variant,
      });
      const row: TextureRow = {
        saveId: this.options.saveId,
        key,
        bytes: response.bytes,
        mime: response.mime,
        width: response.width,
        height: response.height,
        source: "llm",
        generatedAt: Date.now(),
      };
      await putTextureRow(row);
      const texture = await bytesToTexture(response.bytes, response.mime);
      if (!texture) return null;
      this.options.library.registerOverride(key, texture);
      return texture;
    } catch (err) {
      console.warn("[textureExpansion] failed", { key, err });
      return null;
    }
  }
}

async function bytesToTexture(bytes: Uint8Array, mime: string): Promise<THREE.Texture | null> {
  try {
    const safe = new Uint8Array(bytes);
    const blob = new Blob([safe.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    return await new Promise<THREE.Texture | null>((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (tex) => {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          URL.revokeObjectURL(url);
          resolve(tex);
        },
        undefined,
        () => {
          URL.revokeObjectURL(url);
          resolve(null);
        },
      );
    });
  } catch (err) {
    console.warn("[textureExpansion] decode failed", err);
    return null;
  }
}
