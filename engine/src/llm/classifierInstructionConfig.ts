/**
 * Optional extra system-prompt prose appended after `TILE_CARTOGRAPHY_PROMPTS`
 * headers for scene-classify (tile grid) calls only. Editable in-repo; not
 * loaded from world packs or `world.aiInstructions`.
 *
 * Leave empty unless you need global classifier tuning (palette bias, banned
 * motifs, etc.). Per-grid context still comes from the user prompt in
 * `tileFiller`.
 */
export const TILE_CLASSIFIER_OPS = [
  "tile.region",
  "tile.location",
  "tile.region.mosaic",
  "tile.location.mosaic",
] as const;

export type TileClassifierOperation = (typeof TILE_CLASSIFIER_OPS)[number];

const TILE_CLASSIFIER_EXTRAS: Record<TileClassifierOperation, string> = {
  "tile.region": "",
  "tile.location": "",
  "tile.region.mosaic": "",
  "tile.location.mosaic": "",
};

const TILE_OP_SET = new Set<string>(TILE_CLASSIFIER_OPS);

export function isTileClassifierOperation(op: string): op is TileClassifierOperation {
  return TILE_OP_SET.has(op);
}

/** Returns trimmed engine-only classifier tail, or empty if `operation` is not a tile classify op. */
export function tileClassifierExtra(operation: string): string {
  if (!isTileClassifierOperation(operation)) return "";
  return TILE_CLASSIFIER_EXTRAS[operation].trim();
}
