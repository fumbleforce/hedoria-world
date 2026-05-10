import type { ImageResponse } from "../llm/imageAdapter";
import type { TileGrid } from "./tilePrimitives";

/**
 * Whole-grid image generator + client-side slicer.
 *
 * Instead of calling the image model once per unique tile kind (the
 * default per-tile cache strategy), the mosaic mode asks for ONE big
 * image describing the entire region's composition and slices the
 * returned PNG into N×M tiles locally. This trades:
 *
 *   - cost / latency: one image call for the whole region (cheaper than
 *     ~10-15 per-tile calls when the LLM picks a fresh palette);
 *   - visual coherence: the image model can blend tile boundaries so
 *     rivers, roads, and shorelines flow continuously across the grid.
 *
 * Trade-offs to be aware of:
 *
 *   - the image model may not produce a perfectly aligned grid; some
 *     drift at borders is expected;
 *   - per-tile cache reuse across regions is lost (each slice is
 *     unique to its (region, x, y) coordinate);
 *   - regenerating a region wipes ALL slices, not just the changed
 *     cells.
 *
 * We expose two pure helpers here; the cache (`TileImageCache`) is the
 * one that decides when to call them and how to persist the slices.
 *
 * Coordinate convention: the grid uses cartographer's +y = NORTH (see
 * tilePrimitives), but the rendered image has +y going DOWN. We slice
 * row-by-row in image order and let the caller flip y so the
 * northernmost grid row maps to the topmost image row.
 */

/**
 * Build the image-generation prompt for a full grid. The prompt
 * enumerates every cell with a TERRAIN-ONLY descriptor so the model
 * knows what to draw at every position. North is described as the top
 * of the image, matching how the renderer displays it.
 *
 * Crucially, we never feed proper nouns to the prompt — when a cell
 * carries a `locationId` (so the engine has marked it a named-place
 * anchor), we substitute a generic "built structure on <terrain>"
 * descriptor that uses `priorKind` as the surrounding biome hint.
 * Without this scrub, the image model happily writes the place name
 * across the cell as cartographic text, which then bleeds into the
 * sliced tile illustrations.
 */
export function composeMosaicPrompt(grid: TileGrid, style: string): string {
  const lines: string[] = [];
  lines.push(
    `Generate a single top-down map illustration arranged as a strict ${grid.width} × ${grid.height} grid (${grid.width} columns by ${grid.height} rows).`,
  );
  lines.push(
    `North is at the TOP of the image; south is at the bottom. West is on the left, east on the right.`,
  );
  lines.push(
    `Cells are equal-sized and butt directly against each other — no gutters, no gaps, no labels, no borders, no UI, no text anywhere in the image.`,
  );
  lines.push("");
  lines.push(
    `Tile composition (north-most row first, west-most column first within each row):`,
  );
  lines.push("");

  // Walk rows from north (highest y) to south (y=0) so the listing
  // mirrors the visual layout the model is being asked to produce.
  for (let y = grid.height - 1; y >= 0; y -= 1) {
    const rowLabel = `Row ${y} (${rowDirectionLabel(y, grid.height)})`;
    const cells: string[] = [];
    for (let x = 0; x < grid.width; x += 1) {
      const tile = grid.tiles[y * grid.width + x];
      cells.push(`col ${x}: ${describeTileForPrompt(tile, grid.biome)}`);
    }
    lines.push(`${rowLabel}:`);
    for (const c of cells) lines.push(`  ${c}`);
  }
  lines.push("");
  lines.push(`Biome / region tone: ${prettify(grid.biome)}.`);
  lines.push(`Art style: ${style}.`);
  lines.push("");
  lines.push(`Layout rules:`);
  lines.push(
    ` - The image is a strict ${grid.width}×${grid.height} lattice. All cells share the same size; the lattice aligns with the image edges so it can be sliced with equal cuts.`,
  );
  lines.push(
    ` - Each cell's central character should clearly read as the described terrain (e.g. a grain field looks like a grain field; coastal shallows look like shallow water).`,
  );
  lines.push(
    ` - Adjacent cells blend smoothly at their borders — a continuous river flows across river cells, a coastline looks like a coastline, a road connects road cells.`,
  );
  lines.push(
    ` - Render purely painted scenery. No labels, no place names, no captions, no compass roses, no scale bars, no legends, no letters, no numbers, no grid lines. Paint the buildings, water, and roads themselves; do not annotate them.`,
  );
  return lines.join("\n");
}

/**
 * Render one tile as a terrain-only line for the prompt. Anchor tiles
 * (those with a `locationId`) get a generic "built structure on
 * <terrain>" treatment — using `priorKind` (the LLM's choice for the
 * surrounding terrain before the engine stamped the anchor) so the
 * built structure sits on the right biome, but stripped of any proper
 * noun so the image model can't latch onto a name to render as text.
 */
function describeTileForPrompt(
  tile: { kind: string; label?: string; passable: boolean; locationId?: string; priorKind?: string },
  fallbackBiome: string,
): string {
  const passable = tile.passable === false ? " (impassable terrain)" : "";

  if (tile.locationId) {
    const surrounding = prettify(tile.priorKind || fallbackBiome);
    // We deliberately do NOT pass tile.label or tile.kind — both
    // contain the proper noun (e.g. "Avenor", "avenor") that the image
    // model would happily write across the cell as cartographic text.
    return `built place — small cluster of buildings nestled in ${surrounding}${passable}`;
  }

  // Generic terrain. The LLM-invented kind is already a kebab-case
  // descriptor like "grain-field" or "reed-marsh"; the human label
  // (when authored) is a short noun phrase like "Grazing meadow".
  // Both are safe to feed straight to the image prompt — neither
  // contains a proper noun by construction (see tileFiller's prompt
  // rule #3 forbidding proper nouns in kind/label).
  const label = (tile.label || prettify(tile.kind)).replace(/\s+/g, " ").trim();
  return `${prettify(tile.kind)} — ${label}${passable}`;
}

function prettify(slugOrPhrase: string): string {
  return (slugOrPhrase || "").replace(/-/g, " ").trim();
}

function rowDirectionLabel(y: number, height: number): string {
  if (y === height - 1) return "northernmost";
  if (y === 0) return "southernmost";
  return `row ${y}`;
}

/**
 * One slice of a mosaic image, with its position in IMAGE coordinates
 * (row 0 = topmost in the image = northernmost in the grid). Callers
 * map this to grid (x, y) by flipping y.
 */
export type MosaicSlice = {
  /** 0-indexed row in the source image; 0 = top. */
  imgRow: number;
  /** 0-indexed column in the source image; 0 = left. */
  imgCol: number;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
};

/**
 * Slice a generated mosaic image into `cols × rows` PNG slices using
 * the browser's offscreen canvas. Returns slices in image-row order
 * (top-left first, row-major). The caller is responsible for any
 * y-flip needed to map image rows to cartographer-y grid coordinates.
 *
 * If the source image's pixel size isn't an exact multiple of (cols,
 * rows), we floor the per-tile size and let any spare pixels at the
 * right/bottom edge be cropped — better than scaling artefacts in
 * every tile.
 */
export async function sliceMosaic(
  image: ImageResponse,
  cols: number,
  rows: number,
): Promise<MosaicSlice[]> {
  const blob = new Blob([image.bytes as unknown as BlobPart], { type: image.mime });
  const bitmap = await createImageBitmap(blob);
  const tileW = Math.floor(bitmap.width / cols);
  const tileH = Math.floor(bitmap.height / rows);

  const slices: MosaicSlice[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = tileW;
      canvas.height = tileH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("sliceMosaic: 2d canvas context unavailable");
      }
      ctx.drawImage(
        bitmap,
        c * tileW, // sx
        r * tileH, // sy
        tileW, // sWidth
        tileH, // sHeight
        0, // dx
        0, // dy
        tileW, // dWidth
        tileH, // dHeight
      );
      const sliceBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!sliceBlob) {
        throw new Error("sliceMosaic: canvas.toBlob returned null");
      }
      const ab = await sliceBlob.arrayBuffer();
      slices.push({
        imgRow: r,
        imgCol: c,
        bytes: new Uint8Array(ab),
        mime: "image/png",
        width: tileW,
        height: tileH,
      });
    }
  }
  bitmap.close?.();
  return slices;
}
