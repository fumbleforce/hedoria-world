import { z } from "zod";
import type { LlmAdapter } from "../llm/adapter";
import {
  deleteSceneSpecRow,
  getSceneSpecRow,
  putSceneSpecRow,
} from "../persist/saveLoad";
import { diag } from "../diag/log";
import type {
  WorldData,
  WorldLocation,
  WorldRegion,
} from "../schema/worldSchema";
import {
  LOCATION_GRID_H,
  LOCATION_GRID_W,
  REGION_GRID_H,
  REGION_GRID_W,
  TileGridSchema,
  type QuestMarker,
  type Tile,
  type TileGrid,
} from "./tilePrimitives";
import { projectLocations, type ProjectedAnchor } from "./locationProjection";
import { buildSystemPrompt } from "../llm/promptBuilder";
import { ENGINE_PROMPTS } from "../llm/systemPrompts";

/**
 * The filler's contract with the LLM. We ask for one row per grid cell,
 * full coverage, with the engine validating coverage downstream so a
 * partially-filled response can't crash the renderer.
 */
const FillerCellSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  /** LLM-invented short slug. Must match `^[a-z][a-z0-9-]*$` ideally. */
  kind: z.string().min(1),
  /** One short human-readable phrase, e.g. "marshy reed flats". */
  label: z.string().default(""),
  passable: z.boolean(),
  dangerous: z.boolean().default(false),
  /** If non-empty, this cell is a location-anchor for the named location. */
  locationId: z.string().optional(),
});
type FillerCell = z.infer<typeof FillerCellSchema>;

const FillerResponseSchema = z.object({
  /** The biome label the model inferred from the prose. */
  biome: z.string().default("mixed-temperate"),
  /**
   * The model's chosen palette of kinds. Surfaced for diagnostics; not
   * required to reuse — the engine just checks the cells.
   */
  palette: z.array(z.string()).default([]),
  cells: z.array(FillerCellSchema),
});

export type RegionFillerInput = {
  region: WorldRegion;
  regionId: string;
  /** Locations whose .region matches this region. Become location-anchors. */
  locations: Array<{ id: string; loc: WorldLocation }>;
  activeQuestMarkers?: QuestMarker[];
  /**
   * When set (e.g. HUD “Rebuild map”), appended to the user prompt so the
   * text-LLM transcript cache cannot replay a stale `scene-classify` grid.
   */
  llmCacheBuster?: string;
};

export type LocationFillerInput = {
  location: WorldLocation;
  locationId: string;
  region?: WorldRegion;
  regionBiome?: string;
  activeQuestMarkers?: QuestMarker[];
  llmCacheBuster?: string;
};

export type TileFillerOptions = {
  saveId: string;
  llm: LlmAdapter;
  world: WorldData;
};

/**
 * Centralised tile-grid generator. ONE LLM call per region (or location)
 * — never per cell — so a 10x10 region pays one round-trip and a 5x5
 * location pays another, even if every cell is procedural.
 *
 * Persisted as a `tile-grid` row in `sceneSpecs`; subsequent visits in the
 * same save read directly from IndexedDB without touching the LLM.
 */
export class TileFiller {
  private readonly saveId: string;
  private readonly llm: LlmAdapter;
  private readonly world: WorldData;
  /**
   * Per-(scope, ownerId) in-flight promise so two concurrent callers
   * (e.g. boot + a fast user click, or any future parallel prefetch)
   * share a single LLM round-trip. Without this, both calls would pass
   * the `readCachedGrid` miss and fire the model independently. The
   * boot singleton already prevents the most common case, but the
   * filler itself shouldn't trust callers to never race.
   */
  private readonly inFlight = new Map<string, Promise<TileGrid>>();

  constructor(opts: TileFillerOptions) {
    this.saveId = opts.saveId;
    this.llm = opts.llm;
    this.world = opts.world;
  }

  async getRegionGrid(input: RegionFillerInput): Promise<TileGrid> {
    const key = `region::${input.regionId}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      diag.debug("tile-grid", `joining in-flight region fill ${input.regionId}`);
      return existing;
    }
    const promise = (async () => {
      const cached = await this.readCachedGrid("region", input.regionId);
      if (cached) {
        diag.info("tile-grid", `region cache hit ${input.regionId}`, {
          scope: "region",
          ownerId: input.regionId,
          tiles: cached.tiles.length,
          biome: cached.biome,
        });
        return cached;
      }
      diag.info("tile-grid", `region cache miss ${input.regionId} — calling filler`, {
        scope: "region",
        ownerId: input.regionId,
        locationCount: input.locations.length,
      });
      const result = await this.generateRegionGrid(input);
      // Only persist authoritative LLM output. A blank fallback grid is a
      // transient quota-exhausted artefact; caching it would pin the world
      // to placeholder tiles forever (until the player clears IndexedDB).
      if (result.source === "llm") {
        await this.writeCachedGrid(result.grid);
        diag.info("tile-grid", `region generated (LLM) ${input.regionId}`, {
          scope: "region",
          ownerId: input.regionId,
          biome: result.grid.biome,
          tiles: result.grid.tiles.length,
        });
      } else {
        diag.warn("tile-grid", `region fallback grid used ${input.regionId} (not cached)`, {
          scope: "region",
          ownerId: input.regionId,
        });
      }
      return result.grid;
    })().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  async getLocationGrid(input: LocationFillerInput): Promise<TileGrid> {
    const key = `location::${input.locationId}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      diag.debug("tile-grid", `joining in-flight location fill ${input.locationId}`);
      return existing;
    }
    const promise = (async () => {
      const cached = await this.readCachedGrid("location", input.locationId);
      if (cached) {
        diag.info("tile-grid", `location cache hit ${input.locationId}`, {
          scope: "location",
          ownerId: input.locationId,
          tiles: cached.tiles.length,
          biome: cached.biome,
        });
        return cached;
      }
      diag.info(
        "tile-grid",
        `location cache miss ${input.locationId} — calling filler`,
        {
          scope: "location",
          ownerId: input.locationId,
          areaCount: Object.keys(input.location.areas ?? {}).length,
        },
      );
      const result = await this.generateLocationGrid(input);
      if (result.source === "llm") {
        await this.writeCachedGrid(result.grid);
        diag.info("tile-grid", `location generated (LLM) ${input.locationId}`, {
          scope: "location",
          ownerId: input.locationId,
          biome: result.grid.biome,
          tiles: result.grid.tiles.length,
        });
      } else {
        diag.warn(
          "tile-grid",
          `location fallback grid used ${input.locationId} (not cached)`,
          { scope: "location", ownerId: input.locationId },
        );
      }
      return result.grid;
    })().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /**
   * Discard the persisted grid spec for a region or location so the
   * next `getRegionGrid` / `getLocationGrid` call has to re-invoke the
   * LLM. The matching in-flight slot is dropped too, so a stale
   * promise from a previous (concurrent) caller can't satisfy the
   * fresh request with old data.
   *
   * Used by the HUD "Rebuild" action when the cached geography no
   * longer matches the authored prose (the typical cause: the LLM
   * inferred direction from the anchor positions instead of the
   * regional prose and ended up with the world upside-down).
   */
  async clearGrid(scope: "region" | "location", ownerId: string): Promise<void> {
    this.inFlight.delete(`${scope}::${ownerId}`);
    await deleteSceneSpecRow(
      this.saveId,
      "tile-grid",
      `${scope}-v3::${ownerId}`,
    );
    diag.info("tile-grid", `cleared cached grid for ${scope} ${ownerId}`, {
      scope,
      ownerId,
    });
  }

  // ---------------------------------------------------------------- internals

  private async readCachedGrid(
    scope: "region" | "location",
    ownerId: string,
  ): Promise<TileGrid | null> {
    // The "v3" suffix is a deliberate cache-busting tag.
    //   v1 -> v2: switched from screen-y-down to cartographer +y = north.
    //   v2 -> v3: locations are now placed by the engine via a projection
    //             from authored config (x, y) into the grid, instead of
    //             being scattered wherever the LLM felt like. v2 rows
    //             would still render with locations in random spots.
    const row = await getSceneSpecRow(
      this.saveId,
      "tile-grid",
      `${scope}-v3::${ownerId}`,
    );
    if (!row) return null;
    const parsed = TileGridSchema.safeParse(row.spec);
    if (!parsed.success) return null;
    if (parsed.data.tiles.length !== parsed.data.width * parsed.data.height) return null;
    // Guard against earlier builds that persisted blank fallback grids
    // (every cell `path`, no location anchors). The current build only
    // writes authoritative LLM output; discarding the legacy row gives
    // the next call a chance to re-run the filler against the live API.
    const looksLikeFallback =
      parsed.data.tiles.every((t) => t.kind === "path" && !t.locationId) &&
      !parsed.data.tiles.some((t) => t.label);
    if (looksLikeFallback) return null;
    return parsed.data;
  }

  private async writeCachedGrid(grid: TileGrid): Promise<void> {
    await putSceneSpecRow({
      saveId: this.saveId,
      scope: "tile-grid",
      // Keep the read/write keys in lock-step (see readCachedGrid for the
      // version history behind the "-v3" suffix).
      ids: `${grid.scope}-v3::${grid.ownerId}`,
      spec: grid,
      source: "llm",
      generatedAt: Date.now(),
    });
  }

  private async generateRegionGrid(
    input: RegionFillerInput,
  ): Promise<FillerOutcome> {
    const { region, regionId, locations, activeQuestMarkers = [] } = input;
    const width = REGION_GRID_W;
    const height = REGION_GRID_H;

    // Project authored coords into the 10x10 grid. The LLM is told these
    // assignments are FIXED; if it nevertheless ignores them or echoes a
    // different cell, the engine overwrites the affected cells in
    // cellsToGrid using `forcedAnchors`.
    const anchors = projectLocations({ locations, gridW: width, gridH: height });

    const system = buildSystemPrompt({
      world: this.world,
      operation: "tile.region",
      engineHeader: ENGINE_PROMPTS.tileRegion(),
    });
    let user = userPromptForRegion({
      regionId,
      regionName: region.name || regionId,
      regionProse: region.basicInfo,
      width,
      height,
      anchors,
      activeQuestMarkers,
      worldBackground: this.worldBackgroundHint(),
    });
    if (input.llmCacheBuster) {
      user += `\n\n<!-- engine:grid-regenerate ${input.llmCacheBuster} -->`;
    }

    return this.invokeFiller({
      scope: "region",
      ownerId: regionId,
      width,
      height,
      system,
      user,
      forcedAnchors: anchors,
      buildFallback: () =>
        deterministicRegionGrid({
          regionId,
          width,
          height,
          anchors,
        }),
    });
  }

  private async generateLocationGrid(
    input: LocationFillerInput,
  ): Promise<FillerOutcome> {
    const { location, locationId, regionBiome, activeQuestMarkers = [] } = input;
    const width = LOCATION_GRID_W;
    const height = LOCATION_GRID_H;
    const areas = Object.entries(location.areas ?? {}).map(([id, a]) => ({
      id,
      description: a.description,
    }));

    const system = buildSystemPrompt({
      world: this.world,
      operation: "tile.location",
      engineHeader: ENGINE_PROMPTS.tileLocation(),
    });
    let user = userPromptForLocation({
      locationId,
      locationName: location.name || locationId,
      locationProse: location.basicInfo,
      regionName: input.region?.name ?? location.region,
      regionProse: input.region?.basicInfo ?? "",
      regionBiome: regionBiome ?? "mixed-temperate",
      width,
      height,
      areas,
      activeQuestMarkers,
      worldBackground: this.worldBackgroundHint(),
    });
    if (input.llmCacheBuster) {
      user += `\n\n<!-- engine:grid-regenerate ${input.llmCacheBuster} -->`;
    }

    return this.invokeFiller({
      scope: "location",
      ownerId: locationId,
      width,
      height,
      system,
      user,
      forcedAnchors: [],
      buildFallback: () =>
        deterministicLocationGrid({
          locationId,
          width,
          height,
          areas,
          biome: regionBiome ?? "mixed-temperate",
        }),
    });
  }

  private worldBackgroundHint(): string {
    const story = this.world.storyStarts;
    const random = (story && (story.Random as unknown)) ?? null;
    if (random && typeof random === "object") {
      try {
        return JSON.stringify(random).slice(0, 1500);
      } catch {
        return "";
      }
    }
    return "";
  }

  private async invokeFiller(args: {
    scope: "region" | "location";
    ownerId: string;
    width: number;
    height: number;
    system: string;
    user: string;
    /**
     * Cells the engine is going to stamp regardless of what the LLM does.
     * For region grids this is the projected location list (so locations
     * can never end up in the wrong half of the map). For location grids
     * this is empty — areas are flexible.
     */
    forcedAnchors: ProjectedAnchor[];
    /**
     * Called when the LLM is unavailable. Should return a grid that still
     * surfaces authored content (locations as anchors at region scope,
     * areas as labelled tiles at location scope) so the player sees the
     * world even with a dead API.
     */
    buildFallback: () => TileGrid;
  }): Promise<FillerOutcome> {
    const { scope, ownerId, width, height, system, user, forcedAnchors, buildFallback } = args;

    let parsed: z.infer<typeof FillerResponseSchema> | null = null;
    try {
      const response = await this.llm.complete(
        {
          system,
          messages: [{ role: "user", content: user }],
          jsonMode: true,
        },
        { kind: "scene-classify" },
      );
      const json = safeJson(response.text);
      parsed = json ? FillerResponseSchema.parse(json) : null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[tileFiller] LLM call failed for ${scope}=${ownerId}:`, err);
    }

    if (!parsed) {
      // eslint-disable-next-line no-console
      console.warn(
        `[tileFiller] using deterministic fallback grid for ${scope}=${ownerId}`,
      );
      return { grid: buildFallback(), source: "fallback" };
    }

    return {
      grid: cellsToGrid({
        scope,
        ownerId,
        width,
        height,
        biome: parsed.biome.trim() || "mixed-temperate",
        cells: parsed.cells,
        forcedAnchors,
      }),
      source: "llm",
    };
  }
}

type FillerOutcome = {
  grid: TileGrid;
  /** "llm" if the model gave us a valid grid; "fallback" when we substituted
   * blankGrid after the call failed (rate limit, network, schema). Callers
   * persist `llm` outcomes only so a transient outage doesn't poison the cache.
   */
  source: "llm" | "fallback";
};

// ---------------------------------------------------------------- prompt text

function userPromptForRegion(args: {
  regionId: string;
  regionName: string;
  regionProse: string;
  width: number;
  height: number;
  anchors: ProjectedAnchor[];
  activeQuestMarkers: QuestMarker[];
  worldBackground: string;
}): string {
  const lines: string[] = [];
  lines.push(`Region id: ${args.regionId}`);
  lines.push(`Region name: ${args.regionName}`);
  lines.push(
    `Grid: ${args.width} columns x ${args.height} rows. ` +
      `Coordinates are 0..${args.width - 1} on x and 0..${args.height - 1} on y. ` +
      `Cartographer's convention: +x = EAST, +y = NORTH. ` +
      `(0,0) is the SOUTH-WEST corner; (${args.width - 1},${args.height - 1}) is the NORTH-EAST corner. ` +
      `Place mountains, the sea, the deep north, etc. accordingly.`,
  );
  lines.push("");
  lines.push("Region prose:");
  lines.push(args.regionProse || "(no prose authored — invent a coherent geography)");
  lines.push("");
  if (args.anchors.length > 0) {
    lines.push(
      "ENGINE-RESERVED CELLS — these (x,y) coordinates are already assigned to named locations. The engine will OVERWRITE these cells with location anchors regardless of what you put there, so emit plausible terrain on them and let your terrain choices around them respect the geography these locations imply:",
    );
    for (const a of args.anchors) {
      const summary = (a.loc.basicInfo || "").slice(0, 200).replace(/\s+/g, " ");
      lines.push(
        `  - (${a.gx},${a.gy}) → "${a.loc.name || a.id}" :: ${summary}`,
      );
    }
    lines.push("");
    lines.push(
      "Do NOT echo these names into other cells' `kind` or `label`. Other cells are pure terrain (rivers, marsh, fields, foothills, sea, etc.).",
    );
  } else {
    lines.push("No named locations to place; populate the whole grid with regional terrain.");
  }
  lines.push("");
  if (args.activeQuestMarkers.length > 0) {
    lines.push("Active quest hints (you don't need to mark cells for these — the engine overlays them — but pick kinds that could plausibly host these activities):");
    for (const qm of args.activeQuestMarkers) {
      lines.push(`  - ${qm.role}: ${JSON.stringify(qm.params)}`);
    }
    lines.push("");
  }
  if (args.worldBackground) {
    lines.push("World tone (do not contradict):");
    lines.push(args.worldBackground);
    lines.push("");
  }
  lines.push("Produce the JSON now.");
  return lines.join("\n");
}

function userPromptForLocation(args: {
  locationId: string;
  locationName: string;
  locationProse: string;
  regionName: string;
  regionProse: string;
  regionBiome: string;
  width: number;
  height: number;
  areas: Array<{ id: string; description: string }>;
  activeQuestMarkers: QuestMarker[];
  worldBackground: string;
}): string {
  const lines: string[] = [];
  lines.push(`Location id: ${args.locationId}`);
  lines.push(`Location name: ${args.locationName}`);
  lines.push(`Within region: ${args.regionName} (biome: ${args.regionBiome})`);
  lines.push(
    `Grid: ${args.width} x ${args.height}. ` +
      `Coords 0..${args.width - 1} x 0..${args.height - 1}; ` +
      `+x = east, +y = NORTH; (0,0) is the south-west cell.`,
  );
  lines.push("");
  lines.push("Location prose:");
  lines.push(args.locationProse || "(no prose authored — invent a coherent layout that fits the region.)");
  lines.push("");
  if (args.areas.length > 0) {
    lines.push("Authored sub-areas you should surface as cells:");
    for (const a of args.areas) {
      lines.push(`  - "${a.id}" :: ${a.description.slice(0, 240)}`);
    }
    lines.push("");
  }
  if (args.regionProse) {
    lines.push("Surrounding region prose (context only):");
    lines.push(args.regionProse.slice(0, 600));
    lines.push("");
  }
  if (args.activeQuestMarkers.length > 0) {
    lines.push("Active quest hints (engine handles cell selection; pick a coherent layout):");
    for (const qm of args.activeQuestMarkers) {
      lines.push(`  - ${qm.role}: ${JSON.stringify(qm.params)}`);
    }
    lines.push("");
  }
  if (args.worldBackground) {
    lines.push("World tone:");
    lines.push(args.worldBackground);
    lines.push("");
  }
  lines.push("Produce the JSON now.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- conversion

function cellsToGrid(args: {
  scope: "region" | "location";
  ownerId: string;
  width: number;
  height: number;
  biome: string;
  cells: FillerCell[];
  /**
   * Engine-authoritative location placements (region scope only). After the
   * LLM cells are written into the grid, these positions are stamped LAST
   * so the model can never bury a far-north city in the south row.
   */
  forcedAnchors: ProjectedAnchor[];
}): TileGrid {
  const { scope, ownerId, width, height, biome, cells, forcedAnchors } = args;

  // Default-fill with `path` so any missing cell is still walkable.
  const tiles: Tile[] = [];
  for (let i = 0; i < width * height; i += 1) {
    tiles.push({ kind: "path", passable: true });
  }

  const place = (x: number, y: number, t: Tile) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    tiles[y * width + x] = t;
  };

  // 1. LLM cells provide background terrain. We strip any locationId the
  //    model attached because the engine owns location placement now;
  //    forcedAnchors below is the single source of truth for that.
  for (const cell of cells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) continue;
    const tile: Tile = {
      kind: normalizeKind(cell.kind),
      label: cell.label || undefined,
      passable: cell.passable,
      dangerous: cell.dangerous || undefined,
    };
    place(cell.x, cell.y, tile);
  }

  // 2. Engine-authoritative anchor stamps. These ALWAYS win over whatever
  //    the LLM put on those cells; the prior LLM kind is preserved on
  //    `priorKind` so narration can still reference the surrounding
  //    geography ("Avenor's gates rise out of the riverflats").
  if (scope === "region") {
    for (const a of forcedAnchors) {
      const idx = a.gy * width + a.gx;
      const prior = tiles[idx];
      const slugFromName = (a.loc.name || a.id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        ;
      tiles[idx] = {
        kind: slugFromName || "settlement",
        label: a.loc.name || a.id,
        passable: true,
        locationId: a.id,
        priorKind: prior.kind !== "path" ? prior.kind : undefined,
      };
    }
  }

  return {
    scope,
    ownerId,
    width,
    height,
    biome,
    tiles,
    generatedAt: Date.now(),
  };
}

/**
 * Coerce LLM-supplied kinds into a canonical kebab-case form. Rejects the
 * literal engine primitives so the LLM cannot accidentally usurp them.
 */
function normalizeKind(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "open-ground";
  if (cleaned === "path" || cleaned === "location-anchor") {
    return `${cleaned}-tile`;
  }
  return cleaned;
}

function safeJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip markdown code fences if the model includes them.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/```\s*$/u, "");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

// -------------------------------------------------------- deterministic fallbacks
//
// These run when the LLM is unreachable (rate-limited, network, schema). Unlike
// the old blankGrid path, they still expose authored content — locations on the
// region map and areas on the location map — so the player can navigate the
// authored world while the API is unavailable. Outputs are NOT persisted to the
// cache (see TileFiller.getRegionGrid / getLocationGrid), so a later successful
// LLM call will replace them with a richer procedural grid.

function deterministicRegionGrid(args: {
  regionId: string;
  width: number;
  height: number;
  anchors: ProjectedAnchor[];
}): TileGrid {
  const { regionId, width, height, anchors } = args;
  const tiles: Tile[] = [];
  for (let i = 0; i < width * height; i += 1) {
    tiles.push({ kind: "path", passable: true });
  }
  // Use the SAME projection the LLM was told about so the offline view of
  // the world is geographically identical to the (eventual) LLM-filled
  // view — players don't see locations swap places when the API recovers.
  for (const a of anchors) {
    const idx = a.gy * width + a.gx;
    const slug = (a.loc.name || a.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    tiles[idx] = {
      kind: slug || "settlement",
      label: a.loc.name || a.id,
      passable: true,
      locationId: a.id,
    };
  }
  return {
    scope: "region",
    ownerId: regionId,
    width,
    height,
    biome: "mixed-temperate",
    tiles,
    generatedAt: Date.now(),
  };
}

function deterministicLocationGrid(args: {
  locationId: string;
  width: number;
  height: number;
  biome: string;
  areas: Array<{ id: string; description: string }>;
}): TileGrid {
  const { locationId, width, height, areas, biome } = args;
  const tiles: Tile[] = [];
  for (let i = 0; i < width * height; i += 1) {
    tiles.push({ kind: "path", passable: true });
  }
  // Stable, area-first placement: every authored area becomes one cell, in
  // declaration order, walking row-major across the grid. Any remaining cells
  // stay as `path` connectors. With 5x5 = 25 cells, locations with up to 25
  // areas all fit; for the rare bigger location we surface only the first 25.
  const sorted = [...areas];
  const usable = Math.min(sorted.length, width * height);
  for (let i = 0; i < usable; i += 1) {
    const a = sorted[i];
    const x = i % width;
    const y = Math.floor(i / width);
    tiles[y * width + x] = {
      kind:
        a.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
        "open-area",
      label: a.id,
      passable: true,
    };
  }
  return {
    scope: "location",
    ownerId: locationId,
    width,
    height,
    biome,
    tiles,
    generatedAt: Date.now(),
  };
}
