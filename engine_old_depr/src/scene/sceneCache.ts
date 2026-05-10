import type { LlmAdapter } from "../llm/adapter";
import {
  getSceneSpecRow,
  putSceneSpecRow,
  listSceneSpecRows,
} from "../persist/saveLoad";
import type { SceneSpecRow } from "../persist/db";
import {
  composeSceneSpec,
  type ComposedSceneSpec,
  type SceneScope,
  type SceneSpec,
} from "./sceneSpec";
import { SceneSpecSchema } from "./sceneSpec";
import { proceduralSpec } from "./proceduralSpec";
import { classifyScene, scopeKeyToString } from "./sceneClassifier";
import type { ScenePromptContext } from "./llm/scenePrompt";
import type { ParsedScenesBundle } from "./sceneLoader";

const LRU_CAPACITY = 64;

export type SceneCacheSource = "bundle" | "save" | "llm" | "procedural" | "author";

export type CachedSpec = {
  spec: SceneSpec;
  source: SceneCacheSource;
};

export type ScopeMetadata = {
  scope: SceneScope;
  ids: ScopeIds;
  prose: string;
  worldTone?: string;
};

export type ScopeIds = {
  regionId?: string;
  locationId?: string;
  areaId?: string;
};

export type SceneCacheOptions = {
  bundle: ParsedScenesBundle;
  saveId: string;
  seed: string;
  worldTone?: string;
  adapter?: LlmAdapter | null;
  onSpecResolved?: (info: {
    scope: SceneScope;
    ids: ScopeIds;
    source: SceneCacheSource;
  }) => void;
};

class LruCache<V> {
  private readonly capacity: number;
  private readonly map = new Map<string, V>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

function bundleKeyForScope(scope: SceneScope, ids: ScopeIds): string | undefined {
  if (scope === "region") return ids.regionId;
  if (scope === "location") return ids.locationId;
  if (scope === "area") {
    if (!ids.locationId || !ids.areaId) return undefined;
    return `${ids.locationId}--${ids.areaId}`;
  }
  return undefined;
}

function dbIdsForScope(scope: SceneScope, ids: ScopeIds): string {
  if (scope === "region") return ids.regionId ?? "";
  if (scope === "location") return ids.locationId ?? "";
  if (scope === "area") return `${ids.locationId ?? ""}::${ids.areaId ?? ""}`;
  return "";
}

/**
 * Three-tier scene-spec cache: in-memory LRU → IndexedDB save → bundle.
 *
 * On a full miss for a scope, the cache returns a deterministic procedural
 * placeholder synchronously (so the renderer never blocks) and queues the LLM
 * classifier in parallel; once that resolves the cache hot-swaps the spec and
 * notifies subscribers.
 */
export class SceneCache {
  private readonly lru = new LruCache<CachedSpec>(LRU_CAPACITY);
  private readonly bundle: ParsedScenesBundle;
  private readonly saveId: string;
  private readonly seed: string;
  private readonly worldTone?: string;
  private adapter: LlmAdapter | null;
  private readonly inFlight = new Map<string, Promise<CachedSpec>>();
  private readonly onSpecResolved?: SceneCacheOptions["onSpecResolved"];
  private readonly subscribers = new Set<
    (info: { scope: SceneScope; ids: ScopeIds; source: SceneCacheSource }) => void
  >();

  constructor(options: SceneCacheOptions) {
    this.bundle = options.bundle;
    this.saveId = options.saveId;
    this.seed = options.seed;
    this.worldTone = options.worldTone;
    this.adapter = options.adapter ?? null;
    this.onSpecResolved = options.onSpecResolved;
  }

  setAdapter(adapter: LlmAdapter | null): void {
    this.adapter = adapter;
  }

  async hydrateFromSave(): Promise<void> {
    const rows = await listSceneSpecRows(this.saveId);
    for (const row of rows) {
      const parsed = SceneSpecSchema.safeParse(row.spec);
      if (!parsed.success) continue;
      const ids = idsFromRow(row);
      const key = scopeKeyToString({ scope: row.scope, ...ids });
      this.lru.set(key, { spec: parsed.data, source: "save" });
    }
  }

  /**
   * Synchronous accessor: returns whatever spec is currently known for the
   * scope (LRU -> save -> bundle -> procedural placeholder). On a full miss,
   * also kicks off a lazy LLM classify and persists the result back into the
   * save when it resolves.
   *
   * @param options.passive  When true, do NOT trigger a classify on miss.
   *   The placeholder is still cached in the LRU so subsequent reads (passive
   *   or not) skip straight to it. Use this for wide overworld renders that
   *   only need a "good enough" placeholder for distant scopes — lazy
   *   classify still happens for the focus scope and via `prefetch()` for
   *   nearby scopes as the player moves.
   */
  getSpec(meta: ScopeMetadata, options?: { passive?: boolean }): CachedSpec {
    const key = scopeKeyToString({ scope: meta.scope, ...meta.ids });
    const cached = this.lru.get(key);
    if (cached) return cached;

    const bundleKey = bundleKeyForScope(meta.scope, meta.ids);
    if (bundleKey) {
      const fromBundle = this.bundleLookup(meta.scope, bundleKey);
      if (fromBundle) {
        const entry: CachedSpec = { spec: fromBundle, source: "bundle" };
        this.lru.set(key, entry);
        return entry;
      }
    }

    const placeholder = this.makeProcedural(meta);
    const entry: CachedSpec = { spec: placeholder, source: "procedural" };
    this.lru.set(key, entry);

    if (!options?.passive) {
      void this.queueClassify(meta).catch((err) => {
        // Rate-limit errors are an expected control flow (the provider has
        // a built-in cooldown), so they get a one-line warning instead of a
        // scary stack trace. Genuine errors keep the full trace.
        const name = err instanceof Error ? err.name : "";
        if (name === "RateLimitedError") {
          console.warn(
            `[sceneCache] classify skipped (${this.scopeLabel(meta)}): ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        console.warn("[sceneCache] classify failed", err);
      });
    }

    return entry;
  }

  private scopeLabel(meta: ScopeMetadata): string {
    if (meta.scope === "area") {
      return `area ${meta.ids.regionId}/${meta.ids.locationId}/${meta.ids.areaId}`;
    }
    if (meta.scope === "location") {
      return `location ${meta.ids.regionId}/${meta.ids.locationId}`;
    }
    return `region ${meta.ids.regionId}`;
  }

  /**
   * Compose a SceneSpec for the renderer. Each scope is fetched via getSpec
   * (which always returns something — bundle, save, or procedural fallback).
   *
   * @param input.passive  When true, do not trigger LLM classify on a cache
   *   miss for any of the contributing scopes. Procedural placeholders are
   *   used in their place.
   */
  compose(input: {
    regionId: string;
    locationId?: string;
    areaId?: string;
    prose?: SceneProse;
    passive?: boolean;
  }): ComposedSceneSpec | undefined {
    const opts = { passive: input.passive ?? false };
    const region = this.getSpec(
      {
        scope: "region",
        ids: { regionId: input.regionId },
        prose: input.prose?.region ?? "",
        worldTone: this.worldTone,
      },
      opts,
    );
    const location = input.locationId
      ? this.getSpec(
          {
            scope: "location",
            ids: { regionId: input.regionId, locationId: input.locationId },
            prose: input.prose?.location ?? "",
            worldTone: this.worldTone,
          },
          opts,
        )
      : undefined;
    const area = input.locationId && input.areaId
      ? this.getSpec(
          {
            scope: "area",
            ids: {
              regionId: input.regionId,
              locationId: input.locationId,
              areaId: input.areaId,
            },
            prose: input.prose?.area ?? "",
            worldTone: this.worldTone,
          },
          opts,
        )
      : undefined;
    return composeSceneSpec({
      region: region.spec,
      location: location?.spec,
      area: area?.spec,
    });
  }

  private bundleLookup(scope: SceneScope, key: string): SceneSpec | undefined {
    if (scope === "region") return this.bundle.regions[key];
    if (scope === "location") return this.bundle.locations[key];
    if (scope === "area") return this.bundle.areas[key];
    return undefined;
  }

  private makeProcedural(meta: ScopeMetadata): SceneSpec {
    const parentRegion = meta.scope !== "region" && meta.ids.regionId
      ? this.lru.get(scopeKeyToString({ scope: "region", regionId: meta.ids.regionId }))?.spec ??
        this.bundleLookup("region", meta.ids.regionId)
      : undefined;
    const parentLocation = meta.scope === "area" && meta.ids.locationId
      ? this.lru.get(
          scopeKeyToString({
            scope: "location",
            regionId: meta.ids.regionId,
            locationId: meta.ids.locationId,
          }),
        )?.spec ?? this.bundleLookup("location", meta.ids.locationId)
      : undefined;
    return proceduralSpec({
      scope: meta.scope,
      prose: meta.prose,
      seed: `${this.seed}::${scopeKeyToString({ scope: meta.scope, ...meta.ids })}`,
      parentRegion,
      parentLocation,
    });
  }

  private async queueClassify(meta: ScopeMetadata): Promise<CachedSpec> {
    if (!this.adapter) {
      return { spec: this.makeProcedural(meta), source: "procedural" };
    }
    const key = scopeKeyToString({ scope: meta.scope, ...meta.ids });
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const ctx: ScenePromptContext = {
        scope: meta.scope,
        prose: meta.prose,
        worldTone: meta.worldTone,
        ids: meta.ids,
        parentRegion: meta.ids.regionId
          ? {
              name: meta.ids.regionId,
              spec:
                this.lru.get(scopeKeyToString({ scope: "region", regionId: meta.ids.regionId }))
                  ?.spec ?? this.bundleLookup("region", meta.ids.regionId),
            }
          : undefined,
        parentLocation:
          meta.scope === "area" && meta.ids.locationId
            ? {
                name: meta.ids.locationId,
                spec:
                  this.lru.get(
                    scopeKeyToString({
                      scope: "location",
                      regionId: meta.ids.regionId,
                      locationId: meta.ids.locationId,
                    }),
                  )?.spec ?? this.bundleLookup("location", meta.ids.locationId),
              }
            : undefined,
      };
      const result = await classifyScene(this.adapter!, ctx);
      if (!result.ok) {
        return { spec: this.makeProcedural(meta), source: "procedural" as const };
      }
      const entry: CachedSpec = { spec: result.spec, source: "llm" };
      this.lru.set(key, entry);
      const dbIds = dbIdsForScope(meta.scope, meta.ids);
      const row: SceneSpecRow = {
        saveId: this.saveId,
        scope: meta.scope,
        ids: dbIds,
        spec: result.spec,
        source: "llm",
        generatedAt: Date.now(),
      };
      await putSceneSpecRow(row).catch((err) => {
        console.warn("[sceneCache] persist failed", err);
      });
      this.onSpecResolved?.({ scope: meta.scope, ids: meta.ids, source: "llm" });
      for (const listener of this.subscribers) {
        try {
          listener({ scope: meta.scope, ids: meta.ids, source: "llm" });
        } catch (err) {
          console.warn("[sceneCache] subscriber threw", err);
        }
      }
      return entry;
    })();
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
    return promise;
  }

  /**
   * Pre-load (fire-and-forget) classify for a list of scopes, useful for the
   * Phase 4 LoD-mid prefetch trigger.
   */
  prefetch(metas: ScopeMetadata[]): void {
    for (const meta of metas) {
      const key = scopeKeyToString({ scope: meta.scope, ...meta.ids });
      const cached = this.lru.get(key);
      if (cached && cached.source !== "procedural") continue;
      void this.queueClassify(meta).catch((err) => {
        console.warn("[sceneCache] prefetch failed", err);
      });
    }
  }

  /** Get the latest known cached value without triggering classify. */
  peek(meta: ScopeMetadata): CachedSpec | undefined {
    const key = scopeKeyToString({ scope: meta.scope, ...meta.ids });
    return this.lru.get(key);
  }

  getRegionSpec(
    regionId: string,
    prose = "",
    worldTone = this.worldTone,
    options?: { passive?: boolean },
  ): CachedSpec {
    return this.getSpec(
      {
        scope: "region",
        ids: { regionId },
        prose,
        worldTone,
      },
      options,
    );
  }

  getLocationSpec(
    regionId: string,
    locationId: string,
    prose = "",
    worldTone = this.worldTone,
    options?: { passive?: boolean },
  ): CachedSpec {
    return this.getSpec(
      {
        scope: "location",
        ids: { regionId, locationId },
        prose,
        worldTone,
      },
      options,
    );
  }

  getAreaSpec(
    regionId: string,
    locationId: string,
    areaId: string,
    prose = "",
    worldTone = this.worldTone,
    options?: { passive?: boolean },
  ): CachedSpec {
    return this.getSpec(
      {
        scope: "area",
        ids: { regionId, locationId, areaId },
        prose,
        worldTone,
      },
      options,
    );
  }

  /**
   * Subscribe to spec resolutions (LLM hot-swaps). Returns an unsubscribe fn.
   */
  subscribeToSpec(
    listener: (info: {
      scope: SceneScope;
      ids: ScopeIds;
      source: SceneCacheSource;
    }) => void,
  ): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /**
   * Force a fresh classify even if we already have a cached spec — used when
   * the author wants to regenerate a scope.
   */
  async refresh(meta: ScopeMetadata): Promise<CachedSpec> {
    const key = scopeKeyToString({ scope: meta.scope, ...meta.ids });
    this.lru.delete(key);
    const dbIds = dbIdsForScope(meta.scope, meta.ids);
    const existing = await getSceneSpecRow(this.saveId, meta.scope, dbIds);
    void existing; // we intentionally overwrite below
    return this.queueClassify(meta);
  }
}

export type SceneProse = {
  region?: string;
  location?: string;
  area?: string;
};

function idsFromRow(row: SceneSpecRow): ScopeIds {
  if (row.scope === "region") return { regionId: row.ids };
  if (row.scope === "location") return { locationId: row.ids };
  if (row.scope === "area") {
    const [locationId, areaId] = row.ids.split("::");
    return { locationId, areaId };
  }
  return {};
}
