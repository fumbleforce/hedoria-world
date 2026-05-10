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
 * enumerates every cell with a TERRAIN/FUNCTIONAL descriptor so the
 * model knows what to draw at every position. North is described as
 * the top of the image, matching how the renderer displays it.
 *
 * Crucially, we never feed proper nouns to the prompt. Two scrubs:
 *
 *  1. At REGION scope, anchor tiles (those carrying a `locationId`)
 *     are replaced with a generic "built place on <terrain>" line. The
 *     proper noun (e.g. "Avenor") never reaches the image model.
 *  2. At LOCATION scope, EVERY cell skips the human label and uses a
 *     generic functional descriptor derived from the kind, then run
 *     through a proper-noun cleaner. Location sub-area IDs (e.g.
 *     "The Farmer's Rest", "Inn Garden") are almost always proper
 *     nouns by authoring convention, and the location system prompt
 *     historically did not forbid them — so without this scrub the
 *     image model wrote them across each tile as text.
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
    `Tile composition (${grid.scope === "location" ? "top row first" : "north-most row first"}, west-most column first within each row):`,
  );
  lines.push("");

  // Walk rows from north (highest y) to south (y=0) so the listing
  // mirrors the visual layout the model is being asked to produce.
  for (let y = grid.height - 1; y >= 0; y -= 1) {
    const rowLabel = `Row ${y} (${rowDirectionLabel(y, grid.height)})`;
    const cells: string[] = [];
    for (let x = 0; x < grid.width; x += 1) {
      const tile = grid.tiles[y * grid.width + x];
      cells.push(
        `col ${x}: ${describeTileForPrompt(tile, grid.biome, grid.scope)}`,
      );
    }
    lines.push(`${rowLabel}:`);
    for (const c of cells) lines.push(`  ${c}`);
  }
  lines.push("");
  if (grid.scope === "location") {
    lines.push(
      `Setting: top-down view of a single ${prettify(grid.biome)} location's interior layout (courtyards, alleys, room-tops, garden patches). The image is the building/grounds plan as seen from above.`,
    );
  } else {
    lines.push(`Biome / region tone: ${prettify(grid.biome)}.`);
  }
  lines.push(`Art style: ${style}.`);
  lines.push("");
  lines.push(`Layout rules:`);
  lines.push(
    ` - The image is a strict ${grid.width}×${grid.height} lattice. All cells share the same size; the lattice aligns with the image edges so it can be sliced with equal cuts.`,
  );
  lines.push(
    ` - Each cell's central character should clearly read as the described ${grid.scope === "location" ? "function (a yard looks like a yard, a roofed hall looks like a roofed hall)" : "terrain (e.g. a grain field looks like a grain field; coastal shallows look like shallow water)"}.`,
  );
  lines.push(
    ` - Adjacent cells blend smoothly at their borders — ${grid.scope === "location" ? "a courtyard flows into the alley next to it, roof-lines align where buildings meet, paths connect across cells" : "a continuous river flows across river cells, a coastline looks like a coastline, a road connects road cells"}.`,
  );
  lines.push(
    ` - Render purely painted scenery. No labels, no place names, no captions, no compass roses, no scale bars, no legends, no letters, no numbers, no grid lines, no signage with readable writing. The descriptors above are instructions to YOU; they must NOT appear as text on the image. Paint the buildings, water, and roads themselves; do not annotate them.`,
  );
  return lines.join("\n");
}

/**
 * Render one tile as a terrain/function-only line for the prompt.
 *
 * - Region scope, anchor tile: "built place on <surrounding terrain>".
 *   The proper noun (the location's name) is dropped on purpose.
 * - Region scope, non-anchor: kind + safe label (the region system
 *   prompt forbids proper nouns in kind/label, so the label is
 *   already terrain-y like "Reed marsh" or "Wheat field").
 * - Location scope, ANY tile: kind only, with a proper-noun-ish kind
 *   coerced into a generic structural descriptor (e.g. "the-farmer-s-
 *   rest" → "small inn building"). Labels are dropped wholesale at
 *   this scope because they're almost always authored sub-area names
 *   ("The Farmer's Rest", "Inn Garden") that the image model would
 *   render as captions.
 */
function describeTileForPrompt(
  tile: {
    kind: string;
    label?: string;
    passable: boolean;
    locationId?: string;
    priorKind?: string;
  },
  fallbackBiome: string,
  scope: "region" | "location",
): string {
  const passable = tile.passable === false ? " (impassable)" : "";

  if (scope === "region" && tile.locationId) {
    const surrounding = prettify(tile.priorKind || fallbackBiome);
    return `built place — small cluster of buildings nestled in ${surrounding}${passable}`;
  }

  if (scope === "location") {
    // Map kind to a generic functional descriptor. Anything that still
    // looks like a proper noun after slug cleanup is collapsed into a
    // safe fallback so the image model can't latch onto it as text.
    const generic = genericiseLocationKind(tile.kind);
    return `${generic}${passable}`;
  }

  // Region scope, non-anchor terrain. Both kind and label are safe by
  // the region prompt's own anti-proper-noun rule (#3).
  const label = (tile.label || prettify(tile.kind)).replace(/\s+/g, " ").trim();
  return `${prettify(tile.kind)} — ${label}${passable}`;
}

/**
 * Convert a location-grid `kind` into a generic top-down architectural
 * descriptor. The pipeline:
 *
 *   1. Slug → words. ("the-farmer-s-rest" → "the farmer s rest")
 *   2. Drop English articles / possessives. ("the", "a", "s", "of")
 *   3. If the remainder is empty OR still contains capitalised-looking
 *      tokens that don't appear in our common-noun whitelist, fall
 *      back to a generic "interior building space" descriptor.
 *   4. Otherwise, decorate with a structural noun phrase so the model
 *      paints a recognisable feature ("yard" → "small open yard
 *      between low walls", "garden" → "patch of garden plants").
 *
 * Cheap and rule-based on purpose. We're not trying to render every
 * possible authored kind — just to guarantee that whatever we send
 * looks like a description, not a name to be lettered onto the tile.
 */
function genericiseLocationKind(rawKind: string): string {
  const cleaned = rawKind
    .toLowerCase()
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const STOP = new Set(["the", "a", "an", "of", "s", "and"]);
  const tokens = cleaned.split(" ").filter((t) => t && !STOP.has(t));
  if (tokens.length === 0) return "small interior space";

  // Look for a "head noun" we recognise as a generic architectural
  // feature. If we find one, build a descriptor around it. Otherwise
  // fall back to a structural generic.
  const HEAD_NOUNS: Record<string, string> = {
    room: "roofed room interior",
    rooms: "row of roofed rooms",
    hall: "long hall with stone or timber floor",
    halls: "row of long halls",
    kitchen: "working kitchen with hearth and benches",
    bath: "tiled bath chamber with steaming water",
    cellar: "shadowed cellar with barrels and crates",
    yard: "small open yard between low walls",
    yards: "open courtyard between low walls",
    garden: "patch of leafy garden plants and earth beds",
    gardens: "leafy garden patches with earth beds",
    courtyard: "wide flagstone courtyard",
    court: "wide flagstone courtyard",
    stable: "stable bay with hay and wooden stalls",
    stables: "row of stable bays with hay",
    market: "open market stand with awnings",
    stall: "wooden trading stall with awning",
    stalls: "row of trading stalls with awnings",
    inn: "small inn building seen from above",
    tavern: "small tavern building seen from above",
    house: "modest house roof and door",
    cottage: "modest cottage roof and door",
    smithy: "smithy with forge chimney and anvil",
    forge: "smithy with forge chimney and anvil",
    chapel: "tiny chapel with peaked roof",
    shrine: "small open-air shrine of stones",
    well: "stone well in an open patch of ground",
    fountain: "stone fountain in an open patch of ground",
    gate: "stone gate set into a wall",
    door: "doorway set into a low wall",
    wall: "section of stone wall",
    walls: "run of stone walls",
    path: "trodden footpath of packed earth",
    paths: "network of trodden footpaths",
    road: "narrow paved road of fitted stones",
    alley: "narrow alley between buildings",
    alleys: "warren of narrow alleys",
    square: "small public square of flagstones",
    plaza: "small public square of flagstones",
    pond: "small pond surrounded by reeds",
    bridge: "short stone footbridge",
    field: "small enclosed working field",
    fields: "patchwork of small working fields",
    orchard: "compact orchard of low fruit trees",
    barn: "barn building with peaked roof",
    granary: "granary building with peaked roof",
    library: "small library with shelved roof shadow",
    workshop: "open workshop with workbenches",
    foundry: "smoking foundry with chimney",
    pier: "wooden pier extending over water",
    quay: "stone quay along the water's edge",
    docks: "row of wooden docks along the water",
    dock: "wooden dock along the water",
    rooftop: "patchwork of building rooftops",
    rooftops: "patchwork of building rooftops",
  };

  // Try each token as a possible head noun, last-most wins (so
  // "kitchen yard" reads as "yard"). This matches English compound
  // ordering for area names.
  let chosen: string | null = null;
  for (const t of tokens) {
    if (HEAD_NOUNS[t]) chosen = HEAD_NOUNS[t];
  }
  if (chosen) return chosen;

  // No recognised head noun — the kind is either an unknown but
  // plausible word (e.g. "smithy-attic") or a proper-noun slug. In
  // either case, "small interior space" is a safe top-down filler
  // that won't be rendered as text.
  return "small interior space";
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
