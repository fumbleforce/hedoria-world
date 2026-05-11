import type { WorldLocation } from "../schema/worldSchema";
import { LOCATION_GRID_H, LOCATION_GRID_W } from "./tilePrimitives";

export type LocationAreaAnchor = {
  id: string;
  gx: number;
  gy: number;
};

export type LocationAreaLayout = {
  width: number;
  height: number;
  anchors: LocationAreaAnchor[];
};

const CARDINAL: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function sortIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Find a free cell sharing an edge with any of `centers`, preferring the
 * first in stable scan order. If every adjacent cell is taken, expand by
 * BFS from those centers until an empty cell appears.
 */
function takeFreeNear(
  centers: Array<{ x: number; y: number }>,
  used: Set<string>,
): { x: number; y: number } {
  const sortedCenters = [...centers].sort((a, b) => a.y - b.y || a.x - b.x);
  if (sortedCenters.length === 0) {
    return { x: 0, y: 0 };
  }
  for (const c of sortedCenters) {
    for (const [dx, dy] of CARDINAL) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = cellKey(nx, ny);
      if (!used.has(k)) return { x: nx, y: ny };
    }
  }
  const q: Array<{ x: number; y: number }> = [...sortedCenters];
  const seen = new Set(q.map((p) => cellKey(p.x, p.y)));
  for (let i = 0; i < q.length; i += 1) {
    const c = q[i];
    for (const [dx, dy] of CARDINAL) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = cellKey(nx, ny);
      if (!used.has(k)) return { x: nx, y: ny };
      if (!seen.has(k)) {
        seen.add(k);
        q.push({ x: nx, y: ny });
      }
    }
  }
  return { x: sortedCenters[0].x + 99, y: sortedCenters[0].y };
}

function bboxOf(
  positions: Map<string, { x: number; y: number }>,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function nextIsolatedRoot(
  positions: Map<string, { x: number; y: number }>,
): { x: number; y: number } {
  if (positions.size === 0) return { x: 0, y: 0 };
  const { maxX, maxY } = bboxOf(positions);
  return { x: maxX + 2, y: maxY };
}

/**
 * Deterministic placement of authored sub-areas onto an integer grid.
 *
 * Uses `paths` as an undirected adjacency graph: we grow the layout with a
 * BFS so nearby cells in the grid tend to match authored connections. When
 * a hub exhausts its four orthogonal slots, we still place neighbors by
 * expanding outward — connector tiles (filled by the LLM / path) bridge the
 * gap, which matches how large sites read in play.
 *
 * The returned `width` / `height` include a one-cell rim of padding so the
 * cartographer pattern matches region grids: outer ring can stay generic
 * paths / edge dressing.
 */
export function layoutLocationAreas(
  areas: WorldLocation["areas"],
): LocationAreaLayout {
  const raw = areas ?? {};
  const ids = Object.keys(raw);
  if (ids.length === 0) {
    return {
      width: LOCATION_GRID_W,
      height: LOCATION_GRID_H,
      anchors: [],
    };
  }

  const idSet = new Set(ids);
  const sortedIds = sortIds(ids);

  const adj = new Map<string, Set<string>>();
  for (const id of ids) {
    adj.set(id, new Set());
  }
  for (const id of ids) {
    const paths = raw[id]?.paths ?? [];
    for (const p of paths) {
      if (!idSet.has(p)) continue;
      adj.get(id)!.add(p);
      adj.get(p)!.add(id);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  const used = new Set<string>();

  function placeAndEnqueue(seed: string, spot: { x: number; y: number }, queue: string[]) {
    if (positions.has(seed)) return;
    positions.set(seed, spot);
    used.add(cellKey(spot.x, spot.y));
    queue.push(seed);
  }

  // --- First connected component from the alphabetically first area id ---
  const queue: string[] = [];
  placeAndEnqueue(sortedIds[0], { x: 0, y: 0 }, queue);

  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi];
    qi += 1;
    const nbs = sortIds([...(adj.get(id) ?? [])]);
    for (const nb of nbs) {
      if (positions.has(nb)) continue;
      const placedNeighbors = sortIds([...(adj.get(nb) ?? [])])
        .filter((x) => positions.has(x))
        .map((x) => positions.get(x)!);
      const spot = takeFreeNear(placedNeighbors, used);
      placeAndEnqueue(nb, spot, queue);
    }
  }

  // --- Remaining components (no path edge to the first cluster) ---
  for (const id of sortedIds) {
    if (positions.has(id)) continue;

    const placedNeighbors = sortIds([...(adj.get(id) ?? [])])
      .filter((x) => positions.has(x))
      .map((x) => positions.get(x)!);

    const root =
      placedNeighbors.length > 0
        ? takeFreeNear(placedNeighbors, used)
        : nextIsolatedRoot(positions);

    const q2: string[] = [];
    placeAndEnqueue(id, root, q2);
    let j = 0;
    while (j < q2.length) {
      const cur = q2[j];
      j += 1;
      const nbs = sortIds([...(adj.get(cur) ?? [])]);
      for (const nb of nbs) {
        if (positions.has(nb)) continue;
        const pns = sortIds([...(adj.get(nb) ?? [])])
          .filter((x) => positions.has(x))
          .map((x) => positions.get(x)!);
        const spot = takeFreeNear(pns, used);
        placeAndEnqueue(nb, spot, q2);
      }
    }
  }

  const { minX, minY, maxX, maxY } = bboxOf(positions);
  const pad = 1;
  const anchors: LocationAreaAnchor[] = sortedIds.map((areaId) => {
    const p = positions.get(areaId)!;
    return {
      id: areaId,
      gx: p.x - minX + pad,
      gy: p.y - minY + pad,
    };
  });

  const width = maxX - minX + 1 + 2 * pad;
  const height = maxY - minY + 1 + 2 * pad;

  return { width, height, anchors };
}

export function areaIdToTileKind(id: string): string {
  return (
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "open-area"
  );
}
