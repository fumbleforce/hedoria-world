import { z } from "zod";

/**
 * Coordinate convention (matches the deprecated 3D engine and config.json):
 *
 *     +x = EAST
 *     +y = NORTH        (cartographer's convention — NOT screen y-down)
 *
 * Every coordinate the engine touches — tile arrays, player positions,
 * direction vectors, A* pathfinding, click handlers, LLM tool args — is
 * cartesian. Tiles are stored row-major as `tiles[y * width + x]`, so the
 * row at array index 0 is the SOUTHERN edge of the map and the row at
 * index `height - 1` is the NORTHERN edge.
 *
 * The renderer (`ui/TileGridView.tsx`) is the SINGLE place that performs
 * a y-flip, so on screen the northern row appears at the top and the
 * southern row at the bottom — without ever inverting the storage.
 *
 * If you find yourself writing `north: [0, -1]` anywhere inside the
 * engine, you have just reintroduced the bug we keep fixing. Don't.
 */

/**
 * Engine-known structural tile kinds. The engine treats these two — and only
 * these two — as primitives with built-in behaviour:
 *
 *  - `path` is written by the pathfinder in `pathing.ts` after the LLM has
 *    filled the rest of the grid. Always passable. Image-cached per biome.
 *  - `location-anchor` carries a non-empty `locationId` that resolves to a
 *    Location in the world; clicking enters that location's tile grid.
 *
 * Every other value of `kind` is a free-form string the LLM invented for
 * a particular cell (e.g. "reed-marsh", "witch-shrine", "vineyard",
 * "ferry-crossing"). The engine does not enumerate them and never
 * special-cases a particular spelling. Behavior derives from the metadata
 * the LLM produces alongside the kind (passable, dangerous, label, props).
 */
export const ENGINE_TILE_KINDS = ["path", "location-anchor"] as const;
export type EngineTileKind = (typeof ENGINE_TILE_KINDS)[number];

export function isEngineKind(kind: string): kind is EngineTileKind {
  return kind === "path" || kind === "location-anchor";
}

/**
 * What gameplay role a quest has imposed on a tile. The kind/label remain
 * whatever the filler produced; `QuestMarker` is an overlay the populator
 * adds to make the cell narratively relevant to an active quest.
 */
export const QuestMarkerSchema = z.object({
  questId: z.string(),
  role: z.enum(["monster", "item", "objective", "target"]),
  params: z
    .object({
      monsterType: z.string().optional(),
      itemId: z.string().optional(),
      count: z.number().optional(),
      remaining: z.number().optional(),
      hint: z.string().optional(),
    })
    .default({}),
});
export type QuestMarker = z.infer<typeof QuestMarkerSchema>;

/**
 * A single tile in either a region (10x10) or a location (variable size) grid. The
 * shape is identical at both scales — only the surrounding grid dimensions
 * and contextual prose differ.
 */
export const TileSchema = z.object({
  /** Free-form LLM-invented string, OR one of the engine primitives above. */
  kind: z.string(),
  /**
   * Short human-readable label shown under the tile and surfaced in
   * narration prompts. The LLM produces this in the same response that
   * picks the kind.
   */
  label: z.string().optional(),
  /**
   * If non-empty, this tile is a `location-anchor` and clicking it enters
   * the named Location's grid. The engine validates that the locationId
   * resolves before accepting the action.
   */
  locationId: z.string().optional(),
  /** Whether the player can walk through / land on this tile. */
  passable: z.boolean(),
  /**
   * Whether crossing this tile triggers an LLM-narrated hazard (storm,
   * ambush risk, exhaustion roll). The dispatcher reads this flag when
   * resolving a `move_region` / `move_location` action.
   */
  dangerous: z.boolean().optional(),
  /**
   * If the pathfinder has overwritten this tile with `path`, `priorKind`
   * preserves the original LLM kind so narration can still say "a worn
   * track through the reed-marsh" rather than "a worn track through path".
   */
  priorKind: z.string().optional(),
  /**
   * Free-form structured data attached to the tile. The LLM may emit
   * `{ hasMerchant: true, merchantType: "fishmonger" }` etc. and we forward
   * it to the scene-runner without interpreting it engine-side.
   */
  props: z.record(z.string(), z.unknown()).optional(),
  /** Quest overlay; written by the populator, not the filler. */
  questMarker: QuestMarkerSchema.optional(),
  /**
   * When the tile grid was authored for mosaic-style art, the classifier may
   * attach a rich per-cell description for the single whole-map image pass.
   * Ignored in per-tile image mode (keys use kind+biome).
   */
  mosaicDescribe: z.string().optional(),
});
export type Tile = z.infer<typeof TileSchema>;

/**
 * A complete region or location grid. Stored as a flat row-major array
 * (length = width * height) so we can serialize it directly into a
 * `sceneSpecs` row without map<->object conversions.
 */
export const TileGridSchema = z.object({
  /** Always "region" for 10x10 grids, "location" for per-site grids. */
  scope: z.enum(["region", "location"]),
  /** The id of the WorldRegion or WorldLocation this grid belongs to. */
  ownerId: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The biome label the LLM inferred for this grid; reused as image-cache discriminator. */
  biome: z.string(),
  /** Row-major: index = y * width + x. */
  tiles: z.array(TileSchema),
  /** When this grid was generated (ms epoch). */
  generatedAt: z.number().int(),
  /**
   * Where this grid came from. `llm` = authoritative LLM output (either fresh
   * or cached on disk); `fallback` = the deterministic blank grid we hand back
   * when scene-classify failed (rate limit, network, schema). Callers like
   * the rebuild flow use this to decide whether expensive follow-up work
   * (image generation) is worth doing.
   *
   * Optional in the schema so previously-cached entries (which we always
   * trust were LLM-sourced) still validate; filler code sets it explicitly
   * before handing the grid back to the engine.
   */
  source: z.enum(["llm", "fallback"]).optional(),
});
export type TileGrid = z.infer<typeof TileGridSchema>;

export function tileIndex(grid: { width: number }, x: number, y: number): number {
  return y * grid.width + x;
}

export function getTile(grid: TileGrid, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return undefined;
  return grid.tiles[tileIndex(grid, x, y)];
}

export function withTile(grid: TileGrid, x: number, y: number, tile: Tile): TileGrid {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return grid;
  const tiles = grid.tiles.slice();
  tiles[tileIndex(grid, x, y)] = tile;
  return { ...grid, tiles };
}

/**
 * Generate a "blank" grid filled with the engine's `path` primitive at every
 * cell — used as a fallback when the LLM call fails outright. Players can
 * still navigate; cells just look generic until the first real fill.
 */
export function blankGrid(
  scope: "region" | "location",
  ownerId: string,
  width: number,
  height: number,
  biome: string,
): TileGrid {
  const tiles: Tile[] = [];
  for (let i = 0; i < width * height; i += 1) {
    tiles.push({ kind: "path", passable: true });
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

export const REGION_GRID_W = 10;
export const REGION_GRID_H = 10;
/** Default location grid when a site has no authored sub-areas. */
export const LOCATION_GRID_W = 5;
/** Default location grid when a site has no authored sub-areas. */
export const LOCATION_GRID_H = 5;
