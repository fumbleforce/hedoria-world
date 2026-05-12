import type { Tile, TileGrid } from "../grid/tilePrimitives";
import { getTile } from "../grid/tilePrimitives";
import type { WorldLocation } from "../schema/worldSchema";
import { tileMatchesAuthoredArea } from "../scene/npcPresence";

export function locationAreaDescriptions(loc: WorldLocation | undefined): string {
  if (!loc?.areas) return "";
  return Object.values(loc.areas)
    .map((a) => a.description?.trim())
    .filter((s): s is string => !!s)
    .join("\n\n");
}

/** Fields written by scene-classify / tile fill — useful for side-rail debug. */
export function tileClassifierRecord(tile: Tile): Record<string, unknown> {
  const r: Record<string, unknown> = {
    kind: tile.kind,
    passable: tile.passable,
  };
  const label = tile.label?.trim();
  if (label) r.label = label;
  const prior = tile.priorKind?.trim();
  if (prior) r.priorKind = prior;
  if (tile.dangerous === true) r.dangerous = true;
  const locId = tile.locationId?.trim();
  if (locId) r.locationId = locId;
  const mosaic = tile.mosaicDescribe?.trim();
  if (mosaic) r.mosaicDescribe = mosaic;
  if (tile.props && Object.keys(tile.props).length > 0) r.props = tile.props;
  if (tile.questMarker) r.questMarker = tile.questMarker;
  return r;
}

export function formatTileClassifierDebug(tile: Tile): string {
  return JSON.stringify(tileClassifierRecord(tile), null, 2);
}

export function formatGridClassifierDebug(grid: TileGrid): string {
  const header = [
    `scope: ${grid.scope}`,
    `ownerId: ${grid.ownerId}`,
    `biome: ${grid.biome}`,
    `size: ${grid.width}×${grid.height}`,
    `generatedAt: ${new Date(grid.generatedAt).toISOString()}`,
    grid.source ? `source: ${grid.source}` : null,
  ]
    .filter((line): line is string => !!line)
    .join("\n");
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const t = getTile(grid, x, y);
      if (!t) continue;
      rows.push(`(${x},${y}) ${JSON.stringify(tileClassifierRecord(t))}`);
    }
  }
  return `${header}\n\n${rows.join("\n")}`;
}

export type SubAreaClassifierDebug = { areaId: string; text: string };

/**
 * One debug blob per authored sub-area: tiles whose classifier kind/label
 * match that area id (same rules as NPC placement).
 */
export function subAreaClassifierDebugSections(
  location: WorldLocation,
  grid: TileGrid,
): SubAreaClassifierDebug[] {
  const ids = location.areas ? Object.keys(location.areas) : [];
  if (ids.length === 0) return [];
  return ids.map((areaId) => {
    const chunks: string[] = [];
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const t = getTile(grid, x, y);
        if (!t || !tileMatchesAuthoredArea(areaId, t)) continue;
        chunks.push(`(${x},${y})\n${formatTileClassifierDebug(t)}`);
      }
    }
    const text =
      chunks.length > 0
        ? chunks.join("\n\n—\n\n")
        : "(No cells matched this sub-area id against tile kind/label. See tileMatchesAuthoredArea in npcPresence.ts.)";
    return { areaId, text };
  });
}
