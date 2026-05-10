import type { ComposedSceneSpec, SceneSpec } from "./sceneSpec";
import { SceneSpecSchema, composeSceneSpec } from "./sceneSpec";

export type ScenesBundle = {
  packId: string;
  generatedAt: string;
  scenes: {
    regions: Record<string, unknown>;
    locations: Record<string, unknown>;
    areas: Record<string, unknown>;
  };
};

export type ParsedScenesBundle = {
  regions: Record<string, SceneSpec>;
  locations: Record<string, SceneSpec>;
  areas: Record<string, SceneSpec>;
};

export function parseScenesBundle(bundle: ScenesBundle): ParsedScenesBundle {
  const out: ParsedScenesBundle = { regions: {}, locations: {}, areas: {} };
  for (const [id, raw] of Object.entries(bundle.scenes.regions ?? {})) {
    const parsed = SceneSpecSchema.safeParse(raw);
    if (parsed.success && parsed.data.scope === "region") {
      out.regions[id] = parsed.data;
    } else {
      console.warn(`[scenes] region '${id}' failed to parse`, parsed.success ? parsed.data.scope : parsed.error.issues);
    }
  }
  for (const [id, raw] of Object.entries(bundle.scenes.locations ?? {})) {
    const parsed = SceneSpecSchema.safeParse(raw);
    if (parsed.success && parsed.data.scope === "location") {
      out.locations[id] = parsed.data;
    } else {
      console.warn(`[scenes] location '${id}' failed to parse`, parsed.success ? parsed.data.scope : parsed.error.issues);
    }
  }
  for (const [id, raw] of Object.entries(bundle.scenes.areas ?? {})) {
    const parsed = SceneSpecSchema.safeParse(raw);
    if (parsed.success && parsed.data.scope === "area") {
      out.areas[id] = parsed.data;
    } else {
      console.warn(`[scenes] area '${id}' failed to parse`, parsed.success ? parsed.data.scope : parsed.error.issues);
    }
  }
  return out;
}

export async function loadScenesBundleFromUrl(url: string): Promise<ParsedScenesBundle> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch scenes bundle: ${response.status}`);
  }
  const json = (await response.json()) as ScenesBundle;
  return parseScenesBundle(json);
}

/**
 * Storage for the scene specs the engine knows about right now. Phase 1 only
 * sources from the bundle; Phase 2 layers IndexedDB save state and an in-memory
 * LRU on top via sceneCache.
 */
export class SceneStore {
  private regions: Record<string, SceneSpec>;
  private locations: Record<string, SceneSpec>;
  private areas: Record<string, SceneSpec>;

  constructor(parsed: ParsedScenesBundle) {
    this.regions = parsed.regions;
    this.locations = parsed.locations;
    this.areas = parsed.areas;
  }

  getRegionSpec(regionId: string): SceneSpec | undefined {
    return this.regions[regionId];
  }

  getLocationSpec(locationId: string): SceneSpec | undefined {
    return this.locations[locationId];
  }

  getAreaSpec(locationId: string, areaId: string): SceneSpec | undefined {
    const key = `${locationId}--${areaId}`;
    return this.areas[key];
  }

  setRegionSpec(regionId: string, spec: SceneSpec): void {
    this.regions[regionId] = spec;
  }

  setLocationSpec(locationId: string, spec: SceneSpec): void {
    this.locations[locationId] = spec;
  }

  setAreaSpec(locationId: string, areaId: string, spec: SceneSpec): void {
    this.areas[`${locationId}--${areaId}`] = spec;
  }

  /**
   * Compose a SceneSpec for the renderer. Returns undefined if the region is
   * missing — every composition needs at least a region (the source of ground).
   */
  compose(input: {
    regionId: string;
    locationId?: string;
    areaId?: string;
  }): ComposedSceneSpec | undefined {
    const region = this.regions[input.regionId];
    if (!region) return undefined;
    const location = input.locationId ? this.locations[input.locationId] : undefined;
    const area =
      input.locationId && input.areaId
        ? this.areas[`${input.locationId}--${input.areaId}`]
        : undefined;
    return composeSceneSpec({ region, location, area });
  }
}
