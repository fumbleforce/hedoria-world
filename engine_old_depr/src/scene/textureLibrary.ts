import { useEffect, useState } from "react";
import * as THREE from "three";
import { textureKey } from "./llm/texturePrompt";
import type { SurfaceCondition, SurfaceMaterial } from "./sceneSpec";

export type TextureIndex = {
  packId: string;
  generatedAt: string;
  baseUrl: string;
  keys: string[];
};

export type TextureLibraryOptions = {
  index: TextureIndex;
};

const memoryCache = new Map<string, THREE.Texture>();
const inFlight = new Map<string, Promise<THREE.Texture>>();

export class TextureLibrary {
  private readonly index: TextureIndex;
  private readonly known: Set<string>;
  private overrides = new Map<string, THREE.Texture>();
  private listeners = new Set<(key: string) => void>();

  constructor(options: TextureLibraryOptions) {
    this.index = options.index;
    this.known = new Set(options.index.keys);
  }

  get baseUrl(): string {
    return this.index.baseUrl;
  }

  has(key: string): boolean {
    return this.known.has(key) || this.overrides.has(key) || memoryCache.has(this.urlFor(key));
  }

  /** URL for a baked texture relative to the public origin. */
  urlFor(key: string): string {
    return `${this.index.baseUrl}${key}.png`;
  }

  async load(material: SurfaceMaterial, condition: SurfaceCondition): Promise<THREE.Texture | null> {
    const key = textureKey(material, condition);
    return this.loadByKey(key);
  }

  async loadByKey(key: string): Promise<THREE.Texture | null> {
    const override = this.overrides.get(key);
    if (override) return override;
    if (!this.known.has(key)) return null;
    const url = this.urlFor(key);
    const cached = memoryCache.get(url);
    if (cached) return cached;
    const existing = inFlight.get(url);
    if (existing) return existing;
    const promise = loadTexture(url);
    inFlight.set(url, promise);
    try {
      const tex = await promise;
      memoryCache.set(url, tex);
      return tex;
    } finally {
      inFlight.delete(url);
    }
  }

  /**
   * Inject a runtime-generated texture (e.g. from textureExpansion). Notifies
   * subscribers of the new key so renderers can re-pick it up.
   */
  registerOverride(key: string, texture: THREE.Texture): void {
    this.overrides.set(key, texture);
    this.known.add(key);
    for (const listener of this.listeners) {
      try {
        listener(key);
      } catch (err) {
        console.warn("[textureLibrary] listener threw", err);
      }
    }
  }

  subscribe(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Synchronous LRU peek — returns the underlying texture if already loaded. */
  peek(key: string): THREE.Texture | null {
    return this.overrides.get(key) ?? memoryCache.get(this.urlFor(key)) ?? null;
  }
}

async function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      (err) => {
        reject(err);
      },
    );
  });
}

export async function loadTextureIndex(url = "/bundles/texture-index.json"): Promise<TextureIndex> {
  const response = await fetch(url);
  if (!response.ok) {
    return { packId: "", generatedAt: "", baseUrl: "/textures/", keys: [] };
  }
  return (await response.json()) as TextureIndex;
}

/**
 * React hook: returns the THREE.Texture for a (material, condition) pair from
 * the bundled texture library. Returns null while loading or if the texture is
 * missing — the renderer should fall back to a solid colour from
 * surface.palette in that case.
 */
export function useSurfaceTexture(
  library: TextureLibrary | null,
  material: SurfaceMaterial,
  condition: SurfaceCondition,
  variantKey?: string,
): THREE.Texture | null {
  const initial: THREE.Texture | null = library
    ? library.peek(variantKey ?? textureKey(material, condition))
    : null;
  const [tex, setTex] = useState<THREE.Texture | null>(initial);

  useEffect(() => {
    if (!library) return;
    let cancelled = false;
    const key = variantKey ?? textureKey(material, condition);
    library
      .loadByKey(key)
      .then((t) => {
        if (cancelled) return;
        setTex(t);
      })
      .catch(() => {
        if (cancelled) return;
        setTex(null);
      });
    const off = library.subscribe((updatedKey) => {
      if (cancelled) return;
      if (updatedKey === key) {
        const next = library.peek(key);
        setTex(next);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [library, material, condition, variantKey]);

  return tex;
}
