import { DeterministicRng } from "../rng/rng";
import type { Tile, TileGrid } from "../grid/tilePrimitives";
import type { WorldQuest } from "../schema/worldSchema";
import { markersFor, type ArchetypeMarker } from "./archetypes";

/**
 * Quest tile populator. Given an active region or location grid and an
 * accepted quest, decide which cells to overlay with QuestMarker entries.
 *
 * Crucially, the populator NEVER changes a cell's kind, label, or
 * passability — those came from the LLM filler and the engine respects
 * them. Quest presence is a thin overlay that the scene runner /
 * tileFiller (on next regen) can narrate around.
 *
 * Picking strategy:
 *   1. Score every passable, non-anchor cell against the archetype's
 *      `preferredKindHints` (substring match against `kind` and `label`).
 *   2. Sort descending by score; on ties, fall back to a deterministic
 *      seedable RNG.
 *   3. Take the top N cells (where N = markersFor(...).length) and write
 *      a QuestMarker into each.
 *
 * The same quest re-applied to the same grid produces identical
 * placements — important because the player may re-enter a region after
 * accepting a quest and we don't want markers to walk around.
 */

export type PopulateOptions = {
  quest: WorldQuest;
  questId: string;
  grid: TileGrid;
  /** Stable seed; usually `${saveId}::${questId}::${grid.scope}::${grid.ownerId}`. */
  seed: string;
};

export function populateGridWithQuest(opts: PopulateOptions): TileGrid {
  const { quest, questId, grid, seed } = opts;
  const archetypeMarkers = markersFor(quest, questId);
  if (archetypeMarkers.length === 0) return grid;

  const rng = new DeterministicRng(seed);
  const tiles = grid.tiles.slice();

  const scored = tiles
    .map((tile, idx) => ({ tile, idx, x: idx % grid.width, y: Math.floor(idx / grid.width) }))
    .filter((c) => c.tile.passable)
    .filter((c) => !c.tile.questMarker || c.tile.questMarker.questId === questId);

  for (const marker of archetypeMarkers) {
    const pick = pickCellFor(marker, scored, rng);
    if (!pick) continue;
    const existing = tiles[pick.idx];
    tiles[pick.idx] = {
      ...existing,
      questMarker: { ...marker.marker },
    } as Tile;
    // Don't reuse this cell for the next marker of the same quest.
    const reuseIdx = scored.findIndex((c) => c.idx === pick.idx);
    if (reuseIdx >= 0) scored.splice(reuseIdx, 1);
  }

  return { ...grid, tiles };
}

/**
 * Strip markers belonging to `questId` from a grid. Used when a quest
 * completes / fails / is abandoned. Returns a new grid; original is
 * untouched.
 */
export function clearQuestMarkers(grid: TileGrid, questId: string): TileGrid {
  let dirty = false;
  const tiles = grid.tiles.map((t) => {
    if (t.questMarker?.questId === questId) {
      dirty = true;
      const next: Tile = { ...t };
      delete next.questMarker;
      return next;
    }
    return t;
  });
  if (!dirty) return grid;
  return { ...grid, tiles };
}

// ---------------------------------------------------------------- internals

type ScoredCell = {
  tile: Tile;
  idx: number;
  x: number;
  y: number;
};

function pickCellFor(
  marker: ArchetypeMarker,
  candidates: ScoredCell[],
  rng: DeterministicRng,
): ScoredCell | null {
  if (candidates.length === 0) return null;

  // Special case: archetype wanted a location anchor (escort, delivery).
  if (marker.preferredKindHints.includes("__anchor__")) {
    const anchors = candidates.filter((c) => !!c.tile.locationId);
    if (anchors.length > 0) {
      return anchors[Math.floor(rng.next() * anchors.length)];
    }
    // Fall through to general scoring if no anchor in this grid.
  }

  const scored = candidates.map((c) => ({
    cell: c,
    score: scoreCell(c, marker.preferredKindHints),
  }));

  // Highest score first; on ties, shuffle deterministically via rng.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ra = rng.next();
    const rb = rng.next();
    return ra - rb;
  });

  return scored[0]?.cell ?? null;
}

function scoreCell(cell: ScoredCell, hints: string[]): number {
  if (hints.length === 0) return 1;
  const haystack = `${cell.tile.kind} ${cell.tile.label ?? ""}`.toLowerCase();
  let score = 0;
  for (const hint of hints) {
    if (hint === "__anchor__") continue;
    if (haystack.includes(hint)) score += 10;
  }
  return score === 0 ? 1 : score;
}
