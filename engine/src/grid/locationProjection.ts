import type { WorldLocation } from "../schema/worldSchema";

/**
 * Project authored region-local location coordinates onto a fixed integer
 * grid (typically 10x10). The coordinates in `config.json` use the
 * cartographer's convention (+x = east, +y = north) and span an arbitrary
 * range per region (Avenor's locations live in roughly x ∈ [-38, 26],
 * y ∈ [-24, 22]). We bbox-fit them into [0..gridW-1, 0..gridH-1] and resolve
 * collisions so every input id ends up on a distinct cell.
 *
 * Why this matters: without a projection, the LLM was free to place named
 * locations wherever it pleased, and it routinely buried far-north cities
 * in the southern row. With the projection, the engine fixes the anchor
 * positions and the LLM only has authority over the *terrain between*.
 */

export type ProjectedAnchor = {
  id: string;
  /** 0..gridW-1, x = east. */
  gx: number;
  /** 0..gridH-1, y = north. */
  gy: number;
  loc: WorldLocation;
};

export type ProjectionInput = {
  locations: Array<{ id: string; loc: WorldLocation }>;
  gridW: number;
  gridH: number;
};

/**
 * Compute a deterministic mapping from each location id to a (gx, gy) cell.
 *
 * Steps:
 *  1. Take the bounding box of the input (x, y) values.
 *  2. Pad the bbox so locations near the edge don't snap to the very last
 *     row/column (the LLM still needs room for sea / mountain / wilderness
 *     terrain on the outer rim).
 *  3. Linear-rescale into [0..gridW-1] × [0..gridH-1] and round to nearest.
 *  4. Resolve collisions by spiraling out to the nearest free cell.
 *
 * The output is sorted by id so two callers with the same input always get
 * the same projection, which matters for IndexedDB cache stability.
 */
export function projectLocations(input: ProjectionInput): ProjectedAnchor[] {
  const { locations, gridW, gridH } = input;
  if (locations.length === 0) return [];

  // 1. Bounding box. Single-location regions need an artificial spread so
  //    we don't divide by zero.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { loc } of locations) {
    if (loc.x < minX) minX = loc.x;
    if (loc.x > maxX) maxX = loc.x;
    if (loc.y < minY) minY = loc.y;
    if (loc.y > maxY) maxY = loc.y;
  }
  if (minX === maxX) {
    minX -= 1;
    maxX += 1;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  // 2. Pad: leave roughly one cell of border on each side so wilderness can
  //    surround the inhabited core.
  const padX = (maxX - minX) * 0.08;
  const padY = (maxY - minY) * 0.08;
  const x0 = minX - padX;
  const x1 = maxX + padX;
  const y0 = minY - padY;
  const y1 = maxY + padY;

  // Reserve a 1-cell rim on every side; locations get mapped into the
  // interior [1, gridW-2] × [1, gridH-2]. This leaves a guaranteed border
  // for the LLM to fill with edge terrain (mountains, sea, marshland).
  const interiorW = gridW - 2;
  const interiorH = gridH - 2;

  // 3. Stable input order: sort by id so collision resolution is
  //    deterministic across runs.
  const sorted = [...locations].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const used = new Set<string>();
  const cellKey = (gx: number, gy: number) => `${gx},${gy}`;

  const out: ProjectedAnchor[] = [];
  for (const { id, loc } of sorted) {
    const xFrac = (loc.x - x0) / (x1 - x0);
    const yFrac = (loc.y - y0) / (y1 - y0);
    let gx = 1 + Math.round(xFrac * (interiorW - 1));
    let gy = 1 + Math.round(yFrac * (interiorH - 1));
    gx = Math.max(0, Math.min(gridW - 1, gx));
    gy = Math.max(0, Math.min(gridH - 1, gy));

    // 4. Collision resolution. Spiral out from the desired cell to the
    //    nearest free one. Manhattan-distance order so the displacement
    //    stays small.
    if (used.has(cellKey(gx, gy))) {
      const candidates = enumerateNearbyCells(gx, gy, gridW, gridH);
      for (const [cx, cy] of candidates) {
        if (!used.has(cellKey(cx, cy))) {
          gx = cx;
          gy = cy;
          break;
        }
      }
    }

    used.add(cellKey(gx, gy));
    out.push({ id, gx, gy, loc });
  }
  return out;
}

/**
 * Enumerate all (x, y) cells inside the grid in increasing Manhattan
 * distance from the seed, then by stable angle for ties. Used for collision
 * resolution: the first cell in the result that hasn't been claimed yet
 * gets the displaced anchor.
 */
function enumerateNearbyCells(
  seedX: number,
  seedY: number,
  gridW: number,
  gridH: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const seen = new Set<string>();
  const maxRadius = Math.max(gridW, gridH);
  for (let r = 1; r <= maxRadius; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.abs(dx) + Math.abs(dy) !== r) continue;
        const cx = seedX + dx;
        const cy = seedY + dy;
        if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridH) continue;
        const key = `${cx},${cy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([cx, cy]);
      }
    }
  }
  return out;
}
