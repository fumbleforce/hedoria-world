import type { PackData, PackLocation, PackRegion } from "../schema/packSchema";
import type { SceneCache } from "./sceneCache";

export type WorldLayoutLocation = {
  id: string;
  name: string;
  regionId: string;
  /** World-space center for the patch (overworld units). */
  position: [number, number];
  /** Radius for the location patch in world units. */
  patchRadius: number;
  raw: PackLocation;
};

export type WorldLayoutRegion = {
  id: string;
  name: string;
  /** World-space center for the region. */
  position: [number, number];
  /** Approximate region radius for tinted ground blob. */
  radius: number;
  basicInfo: string;
  raw: PackRegion;
};

export type WorldLayout = {
  /** World units per *local* (per-region) location coordinate unit. */
  unitsPerLocationUnit: number;
  /** World units per region-grid step (regions live on a coarse integer grid). */
  unitsPerRegionGrid: number;
  regions: WorldLayoutRegion[];
  locations: WorldLayoutLocation[];
  /** Approximate full-world radius (used for camera framing). */
  worldRadius: number;
};

// Voyage coordinate convention:
//  - region.x / region.y are coarse integer grid cells (typically -2..+2).
//  - location.x / location.y are FINE integer offsets, *region-local*, often
//    spanning -30..+40.
//  - Both axes use the cartographer's convention: +x = east, +y = NORTH.
//
// We flip y when going to world-space because the overworld camera sits at
// +X +Z looking at the player; in that view -world_z is the top of the
// screen ("away from the camera" = "north on the map"). Without the flip,
// a location with y=22 (north) appears at the bottom of the screen.
//
// Spacing chosen so that:
//  - region cells are big enough to fully contain their locations (Avenor's
//    Hedoria locations span ~80 location-units across, Sun-Scoured ~50).
//  - location patches scale with the Voyage `radius` field so a city
//    (radius=3) is visibly larger than a hamlet (radius=1) without crowding
//    its neighbours.
// CRITICAL: patch radius must scale by the *same* factor as positions, or
// MIN-clamping will inflate small hamlets past their source-data footprint
// and they'll intersect their neighbours. Hedoria has AI-generated regions
// where some location pairs are <0.5 source-units apart at the closest;
// honouring the source-data invariant is the only way to render them
// without overlap. Units below picked so:
//  - max location offset (~48 source units) fits inside the region cell
//    (1200 / 2 = ±600 world units = 50 source units).
//  - radius=1 hamlet renders at 12 world units, easily clickable.
//  - Tightest-pair gap (~0.12 source units, Kelmar's Last vs Long Ditch in
//    Hinderance Highlands) becomes ~1.4 world units — visibly separate.
const UNITS_PER_LOCATION_UNIT = 12;
const UNITS_PER_REGION_GRID = 1200;
const MIN_PATCH_RADIUS = 8;

function regionWorldPos(region: PackRegion): [number, number] {
  // y-flip: source +y is north → world -z is the top of the screen.
  return [region.x * UNITS_PER_REGION_GRID, -region.y * UNITS_PER_REGION_GRID];
}

function locationWorldPos(
  regionPos: [number, number],
  loc: PackLocation,
): [number, number] {
  return [
    regionPos[0] + loc.x * UNITS_PER_LOCATION_UNIT,
    regionPos[1] + -loc.y * UNITS_PER_LOCATION_UNIT,
  ];
}

function locationPatchRadius(loc: PackLocation): number {
  const r = loc.radius && loc.radius > 0 ? loc.radius : 1;
  return Math.max(MIN_PATCH_RADIUS, r * UNITS_PER_LOCATION_UNIT);
}

export function computeWorldLayout(pack: PackData): WorldLayout {
  const regions: WorldLayoutRegion[] = Object.entries(pack.regions).map(
    ([id, region]) => ({
      id,
      name: region.name || id,
      position: regionWorldPos(region),
      radius: UNITS_PER_REGION_GRID * 0.5,
      basicInfo: region.basicInfo,
      raw: region,
    }),
  );
  const regionPosById = new Map<string, [number, number]>(
    regions.map((r) => [r.id, r.position] as const),
  );

  const locations: WorldLayoutLocation[] = Object.entries(pack.locations).map(
    ([id, location]) => {
      const regionPos = regionPosById.get(location.region) ?? [0, 0];
      return {
        id,
        name: location.name || id,
        regionId: location.region,
        position: locationWorldPos(regionPos, location),
        patchRadius: locationPatchRadius(location),
        raw: location,
      };
    },
  );

  let worldRadius = 0;
  for (const region of regions) {
    const r = Math.hypot(region.position[0], region.position[1]) + region.radius;
    if (r > worldRadius) worldRadius = r;
  }
  for (const location of locations) {
    const r = Math.hypot(location.position[0], location.position[1]) + location.patchRadius;
    if (r > worldRadius) worldRadius = r;
  }
  if (worldRadius < 200) worldRadius = 400;

  return {
    unitsPerLocationUnit: UNITS_PER_LOCATION_UNIT,
    unitsPerRegionGrid: UNITS_PER_REGION_GRID,
    regions,
    locations,
    worldRadius,
  };
}

export type ProximityResult = {
  /** Closest location regardless of distance — used for prefetch / awareness. */
  nearestLocation: WorldLayoutLocation | null;
  nearestLocationDistance: number;
  /**
   * The location whose catchment circle currently contains the player, or
   * null if the player is in the wilderness between locations.
   */
  containingLocation: WorldLayoutLocation | null;
  /** The region grid cell the player currently stands in, if any. */
  currentRegion: WorldLayoutRegion | null;
};

/**
 * Multiplier on patchRadius defining the "you have arrived" catchment.
 * Must match the *visible* circle drawn by `LocationProxy` so the HUD
 * cannot claim you're inside Avenor while the painted Avenor disc is
 * clearly behind you. The visible disc has radius == patchRadius, so this
 * is exactly 1.0.
 */
const CATCHMENT_FACTOR = 1.0;

export function findProximity(
  layout: WorldLayout,
  playerPos: [number, number],
): ProximityResult {
  let nearestLocation: WorldLayoutLocation | null = null;
  let nearestLocationDistance = Number.POSITIVE_INFINITY;
  let containingLocation: WorldLayoutLocation | null = null;
  let containingDistance = Number.POSITIVE_INFINITY;
  for (const loc of layout.locations) {
    const dx = loc.position[0] - playerPos[0];
    const dz = loc.position[1] - playerPos[1];
    const d = Math.hypot(dx, dz);
    if (d < nearestLocationDistance) {
      nearestLocationDistance = d;
      nearestLocation = loc;
    }
    if (d <= loc.patchRadius * CATCHMENT_FACTOR && d < containingDistance) {
      containingDistance = d;
      containingLocation = loc;
    }
  }

  // Region the player is *standing* in is determined by the containing grid
  // cell of the regional layout (axis-aligned, half-cell either side of
  // each region.position).
  const cellHalf = layout.unitsPerRegionGrid * 0.5;
  let currentRegion: WorldLayoutRegion | null = null;
  for (const region of layout.regions) {
    const dx = playerPos[0] - region.position[0];
    const dz = playerPos[1] - region.position[1];
    if (Math.abs(dx) <= cellHalf && Math.abs(dz) <= cellHalf) {
      currentRegion = region;
      break;
    }
  }
  if (!currentRegion && containingLocation) {
    currentRegion =
      layout.regions.find((r) => r.id === containingLocation!.regionId) ?? null;
  }
  if (!currentRegion && nearestLocation) {
    currentRegion =
      layout.regions.find((r) => r.id === nearestLocation!.regionId) ?? null;
  }
  if (!currentRegion) {
    let bestRegionDistance = Number.POSITIVE_INFINITY;
    for (const region of layout.regions) {
      const dx = region.position[0] - playerPos[0];
      const dz = region.position[1] - playerPos[1];
      const d = Math.hypot(dx, dz);
      if (d < bestRegionDistance) {
        bestRegionDistance = d;
        currentRegion = region;
      }
    }
  }
  return {
    nearestLocation,
    nearestLocationDistance,
    containingLocation,
    currentRegion,
  };
}

export const TRANSITION_RADIUS = {
  /** Below this distance, prefetch the location's *area* spec (the one the
   *  player is most likely to enter next). */
  AREA: 18,
  /** Below this distance, prefetch the location's location-scope spec. */
  LOCATION: 60,
};

/**
 * Prefetch nearby scene specs through the cache. Idempotent — the cache
 * already deduplicates in-flight classify calls.
 */
export function prefetchNearby(
  layout: WorldLayout,
  playerPos: [number, number],
  cache: SceneCache,
  pack: PackData,
): void {
  const playerX = playerPos[0];
  const playerZ = playerPos[1];

  for (const region of layout.regions) {
    const dx = region.position[0] - playerX;
    const dz = region.position[1] - playerZ;
    const d = Math.hypot(dx, dz);
    if (d > region.radius * 2) continue;
    cache.getRegionSpec(region.id, region.basicInfo);
  }

  for (const location of layout.locations) {
    const dx = location.position[0] - playerX;
    const dz = location.position[1] - playerZ;
    const d = Math.hypot(dx, dz);
    if (d > TRANSITION_RADIUS.LOCATION) continue;

    cache.getLocationSpec(location.regionId, location.id, location.raw.basicInfo);

    if (d <= TRANSITION_RADIUS.AREA) {
      const areas = location.raw.areas ?? {};
      for (const [areaId, area] of Object.entries(areas)) {
        cache.getAreaSpec(location.regionId, location.id, areaId, area.description);
        // Preheat only the first few areas; tinyworld has 2-3 typical.
      }
    }
  }
  void pack;
}

/**
 * Convert a click on a `door-portal` exit into an interior transition request.
 * Returns the area id to enter, or null if the exit doesn't lead to one.
 */
export function exitToInteriorTarget(exit: { kind: string; toAreaId?: string; toLocationId?: string }): {
  locationId?: string;
  areaId?: string;
} | null {
  if (exit.kind !== "doorway" && exit.kind !== "portal" && exit.kind !== "stair-down" && exit.kind !== "stair-up") {
    return null;
  }
  if (!exit.toAreaId && !exit.toLocationId) return null;
  return { locationId: exit.toLocationId, areaId: exit.toAreaId };
}
