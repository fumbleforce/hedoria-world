import type { Tile, TileGrid } from "./tilePrimitives";

/**
 * Coordinates within a TileGrid. (0,0) is top-left.
 */
type Cell = { x: number; y: number };

/**
 * Lay down the `path` primitive over impassable-but-not-anchor cells along
 * the routes that connect every location-anchor to the region center and
 * to each other. Returns a NEW TileGrid; the input is not mutated.
 *
 * Pathing rules:
 *   - 4-connected (no diagonals).
 *   - Passable cells (filler `passable=true`) are walkable at cost 1.
 *   - Anchor cells are always walkable (cost 1) regardless of passable;
 *     the path approaches but does not overwrite them.
 *   - When no route exists between two anchors, we silently skip — the
 *     player can still navigate via the surrounding terrain on their own.
 *
 * Determinism:
 *   - The center is computed from grid dimensions only.
 *   - Anchor pairs are processed in a stable, sorted order (by id).
 *   - A* tie-breaks by (g, x, y) so the same input grid always produces
 *     the same output. We do not feed in the save seed because there is
 *     no randomness in the algorithm — the seed is a no-op here.
 */
export function applyPathing(grid: TileGrid): TileGrid {
  if (grid.scope !== "region") {
    // Path overlay is meaningful at region scope, where you walk between
    // settlements; locations are dense enough that pathing would be noise.
    return grid;
  }

  const tiles = grid.tiles.slice();
  const w = grid.width;
  const h = grid.height;

  // Collect anchors in stable order so the connection routine is deterministic.
  const anchors: Array<{ id: string; cell: Cell }> = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const t = tiles[y * w + x];
      if (t.locationId) {
        anchors.push({ id: t.locationId, cell: { x, y } });
      }
    }
  }
  anchors.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (anchors.length === 0) {
    return { ...grid, tiles };
  }

  const center: Cell = { x: Math.floor(w / 2), y: Math.floor(h / 2) };

  // Routes to mark: every anchor -> center, plus consecutive anchor pairs in
  // the sorted order so the network is connected without paying the O(n^2)
  // of all-pairs.
  const routesToWalk: Array<[Cell, Cell]> = [];
  for (const a of anchors) {
    routesToWalk.push([a.cell, center]);
  }
  for (let i = 0; i + 1 < anchors.length; i += 1) {
    routesToWalk.push([anchors[i].cell, anchors[i + 1].cell]);
  }

  const anchorCells = new Set<string>(
    anchors.map((a) => cellKey(a.cell)),
  );

  for (const [from, to] of routesToWalk) {
    const route = aStar(from, to, w, h, (x, y) => {
      const t = tiles[y * w + x];
      if (anchorCells.has(cellKey({ x, y }))) return true;
      return t.passable;
    });
    if (!route) continue;
    for (const step of route) {
      const idx = step.y * w + step.x;
      const t = tiles[idx];
      // Don't overwrite anchors; they keep their kind/locationId so the
      // player can click into the location.
      if (t.locationId) continue;
      // If we've already pathed this cell, leave it alone.
      if (t.kind === "path") continue;
      tiles[idx] = pathOver(t);
    }
  }

  return { ...grid, tiles };
}

function pathOver(prior: Tile): Tile {
  return {
    kind: "path",
    label: prior.label,
    passable: true,
    priorKind: prior.kind,
    props: prior.props,
    questMarker: prior.questMarker,
    // dangerous is intentionally dropped on a path cell — paths are walkable
    // by definition. If we want hazardous paths later we can revisit.
  };
}

function cellKey(c: Cell): string {
  return `${c.x},${c.y}`;
}

/**
 * Standard 4-connected A* with Manhattan heuristic. Deterministic:
 * tie-breaks the open-set on (f, g, x, y) to ensure the same start/end
 * always yields the same path bytes-for-bytes.
 */
function aStar(
  start: Cell,
  goal: Cell,
  w: number,
  h: number,
  passable: (x: number, y: number) => boolean,
): Cell[] | null {
  if (start.x === goal.x && start.y === goal.y) return [start];

  const startKey = cellKey(start);
  const goalKey = cellKey(goal);

  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const positions = new Map<string, Cell>();
  positions.set(startKey, start);
  positions.set(goalKey, goal);

  const open = new Set<string>([startKey]);
  gScore.set(startKey, 0);
  fScore.set(startKey, manhattan(start, goal));

  while (open.size > 0) {
    let bestKey: string | null = null;
    let bestF = Number.POSITIVE_INFINITY;
    let bestG = Number.POSITIVE_INFINITY;
    let bestCell: Cell | null = null;
    for (const k of open) {
      const fv = fScore.get(k) ?? Number.POSITIVE_INFINITY;
      const gv = gScore.get(k) ?? Number.POSITIVE_INFINITY;
      const c = positions.get(k)!;
      if (
        fv < bestF ||
        (fv === bestF && gv < bestG) ||
        (fv === bestF && gv === bestG && bestCell !== null && (c.x < bestCell.x || (c.x === bestCell.x && c.y < bestCell.y)))
      ) {
        bestKey = k;
        bestF = fv;
        bestG = gv;
        bestCell = c;
      }
    }
    if (!bestKey || !bestCell) break;
    if (bestKey === goalKey) {
      return reconstruct(cameFrom, positions, goalKey);
    }
    open.delete(bestKey);
    const cur = bestCell;
    const curG = gScore.get(bestKey) ?? Number.POSITIVE_INFINITY;
    for (const next of neighbors(cur, w, h)) {
      const nk = cellKey(next);
      if (!passable(next.x, next.y)) continue;
      const tentativeG = curG + 1;
      const oldG = gScore.get(nk) ?? Number.POSITIVE_INFINITY;
      if (tentativeG < oldG) {
        cameFrom.set(nk, bestKey);
        gScore.set(nk, tentativeG);
        fScore.set(nk, tentativeG + manhattan(next, goal));
        positions.set(nk, next);
        open.add(nk);
      }
    }
  }
  return null;
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function neighbors(c: Cell, w: number, h: number): Cell[] {
  const out: Cell[] = [];
  if (c.x > 0) out.push({ x: c.x - 1, y: c.y });
  if (c.x < w - 1) out.push({ x: c.x + 1, y: c.y });
  if (c.y > 0) out.push({ x: c.x, y: c.y - 1 });
  if (c.y < h - 1) out.push({ x: c.x, y: c.y + 1 });
  return out;
}

function reconstruct(
  cameFrom: Map<string, string>,
  positions: Map<string, Cell>,
  goalKey: string,
): Cell[] {
  const out: Cell[] = [];
  let cur: string | undefined = goalKey;
  while (cur) {
    const c = positions.get(cur);
    if (c) out.unshift(c);
    cur = cameFrom.get(cur);
  }
  return out;
}
