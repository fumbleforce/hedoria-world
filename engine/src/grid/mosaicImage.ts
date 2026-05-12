import type { ImageResponse } from "../llm/imageAdapter";
import type { Tile, TileGrid } from "./tilePrimitives";

/** Last-resort line when a location cell has no usable kind / priorKind. */
const MOSAIC_LOCATION_FALLBACK = "small interior space";

function isMosaicLocationFallback(phrase: string): boolean {
  return phrase === MOSAIC_LOCATION_FALLBACK;
}

/**
 * When head-noun mapping fails, turn a kebab-case classifier slug into a
 * plain phrase for the image model (e.g. `city-gate` → "city gate, seen from above").
 */
function kebabSlugToScenePhrase(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .trim();
  const STOP = new Set(["the", "a", "an", "of", "s", "and"]);
  const tokens = cleaned.split("-").filter((t) => t && !STOP.has(t));
  if (tokens.length === 0) return MOSAIC_LOCATION_FALLBACK;
  return `${tokens.join(" ")}, seen from above`;
}

/**
 * Location mosaic lines: classifier output lives in `priorKind` after the
 * engine stamps sub-area tiles (overwriting `kind` with a slug from the
 * area id). Prefer that, then `kind`, mapping head nouns when we can.
 */
function describeLocationTileForMosaic(tile: {
  kind: string;
  priorKind?: string;
}): string {
  const phraseFromRaw = (raw: string | undefined): string | null => {
    if (!raw?.trim()) return null;
    const mapped = genericiseLocationKind(raw);
    if (!isMosaicLocationFallback(mapped)) return mapped;
    const kebab = kebabSlugToScenePhrase(raw);
    return isMosaicLocationFallback(kebab) ? null : kebab;
  };

  return (
    phraseFromRaw(tile.priorKind) ??
    phraseFromRaw(tile.kind) ??
    MOSAIC_LOCATION_FALLBACK
  );
}

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
 *  2. At LOCATION scope, cells skip the human `label` (often a proper
 *     noun) but should reflect the scene-classifier `kind` and, when the
 *     engine stamped a sub-area, the preserved `priorKind` from the LLM
 *     (the terrain the classifier chose before the overwrite). Unknown
 *     slugs become plain hyphen phrases ("city gate") instead of a
 *     useless generic interior.
 *
 * When tiles carry `mosaicDescribe` (classifier output in mosaic image mode),
 * that string is passed through verbatim as the cell line — it is already
 * written for the image model.
 */
function lineForMosaicCell(tile: Tile, biome: string, scope: "region" | "location"): string {
  const md = tile.mosaicDescribe?.trim();
  if (md) return md;
  return describeTileForPrompt(tile, biome, scope);
}

export function composeMosaicImagePrompt(grid: TileGrid, style: string): string {
  const subject =
    grid.scope === "location"
      ? `top-down TILED MAP of a single ${prettify(grid.biome)} place — its courtyards, alleys, buildings, gardens, and other open ground seen from a map perspective`
      : `top-down TILED MAP of a ${prettify(grid.biome)} region`;
  const rowLines: string[] = [];
  for (let y = grid.height - 1; y >= 0; y -= 1) {
    const rowLabel = rowDirectionLabel(y, grid.height);
    const cells: string[] = [];
    for (let x = 0; x < grid.width; x += 1) {
      const tile = grid.tiles[y * grid.width + x];
      cells.push(lineForMosaicCell(tile, grid.biome, grid.scope));
    }
    rowLines.push(` ${rowLabel}: ${cells.join(" | ")}`);
  }
  const continuityLines =
    grid.scope === "location"
      ? [
          " - Adjacent open spaces flow into each other: courtyards open onto alleys, paths run unbroken across band edges, roof ridges align where buildings span more than one band.",
          " - Shadows, paving textures, vegetation, and lighting are continuous across band edges. Treat the whole canvas as one place at one moment, not a stitched collage.",
        ].join("\n")
      : [
          " - Rivers, coastlines, roads, and ridge lines flow unbroken through every band they pass through. A river that ends mid-band is a bug.",
          " - Forest canopies, fields, and grasslands have continuous textures across band edges; lighting and palette are uniform across the whole picture.",
        ].join("\n");

  return `
A ${subject}, in this art style: ${style}.

Hard rules — the finished image must satisfy ALL of these:
 - ENVIRONMENT ONLY. No text, no captions, no labels, no place names, no numbers, no letters, no symbols, no signs with readable writing.
 - NO VISIBLE GRID. The image must not contain any grid lines, cell borders, frames, gutters, seams, outlines, fences-of-pixels, or any other line marking subdivisions. The picture is one continuous painting.
 - NO MAP CHROME. No compass rose, no scale bar, no legend, no key, no border decoration, no inset, no arrows.
 - North is at the top of the image, south at the bottom; west is on the left, east on the right.

Composition: the map fills the canvas edge-to-edge and is laid out so that ${grid.width} equal vertical tiles across the width and ${grid.height} equal horizontal tiles across the height each contain one of the features listed below. The tiling are an INVISIBLE layout reference — they must not be drawn, outlined, or hinted at. After you return the picture we slice it into ${grid.width} × ${grid.height} tiles externally; your job is to paint a single seamless image whose features happen to land in those positions.

Feature placement (${grid.height} rows from top to bottom, each row listing west→east cells):
${rowLines.join("\n")}

Continuity rules:
${continuityLines}
`.trim();
}

/**
 * Render one tile as a terrain/function-only line for the prompt.
 *
 * - Region scope, anchor tile: "built place on <surrounding terrain>".
 *   The proper noun (the location's name) is dropped on purpose.
 * - Region scope, non-anchor: kind + safe label (the region system
 *   prompt forbids proper nouns in kind/label, so the label is
 *   already terrain-y like "Reed marsh" or "Wheat field").
 * - Location scope: prefer `priorKind` (classifier before engine stamp),
 *   then `kind`, using head-noun mapping when possible and a kebab-slug
 *   phrase fallback. `label` is still omitted to reduce painted captions.
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
    return `named location footprint integrated into surrounding ${surrounding}${passable}`;
  }

  if (scope === "location") {
    return `${describeLocationTileForMosaic(tile)}${passable}`;
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
  if (tokens.length === 0) return MOSAIC_LOCATION_FALLBACK;

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
    gates: "city gates and barbican seen from above",
    city: "dense block of rooftops, alleys, and small courtyards",
    urban: "dense block of rooftops, alleys, and small courtyards",
    street: "narrow city street between buildings",
    streets: "network of city streets between buildings",
    avenue: "broad paved avenue between façades",
    boulevard: "broad tree-lined boulevard between buildings",
    promenade: "riverside or harbor promenade with paving",
    embankment: "stone river embankment with worn steps",
    riverside: "riverside quay with mooring posts and stone paving",
    riverwalk: "busy riverfront walk with stalls and mooring",
    landing: "busy river landing with wharves and cargo",
    wharf: "wooden wharf with stacked cargo and ropes",
    wharves: "row of wooden wharves along the water",
    quays: "row of stone quays along the water",
    district: "mixed city district of roofs and narrow lanes",
    quarter: "historic quarter of tight lanes and rooflines",
    ward: "urban ward of packed buildings and alleys",
    plaza: "small public square of flagstones",
    forum: "open civic forum of flagstones and low steps",
    bazaar: "covered bazaar alley with awnings and stalls",
    arcade: "covered shopping arcade with repeating arches",
    rampart: "thick stone rampart walk with crenellations",
    bastion: "angular bastion jutting from city walls",
    watchtower: "tall stone watchtower with steep roof",
    tower: "tall stone tower with small windows",
    spire: "slender stone spire rising above roofs",
    temple: "temple forecourt and stepped roof seen from above",
    cathedral: "large cathedral roof and crossing plan",
    palace: "grand palace roof and formal courtyard",
    manor: "manor house roof and attached yard",
    keep: "fortified keep with thick walls",
    barracks: "long barracks roof and drill yard",
    warehouse: "long warehouse roof with loading bays",
    granary: "granary building with peaked roof",
    sewer: "narrow vaulted sewer channel with damp stone",
    sewers: "network of vaulted sewer channels",
    tunnel: "stone tunnel mouth or underpass",
    bridge: "short stone footbridge",
    stairs: "wide outdoor stone stair flight",
    steps: "wide outdoor stone steps between levels",
    door: "doorway set into a low wall",
    wall: "section of stone wall",
    walls: "run of stone walls",
    path: "trodden footpath of packed earth",
    paths: "network of trodden footpaths",
    road: "narrow paved road of fitted stones",
    alley: "narrow alley between buildings",
    alleys: "warren of narrow alleys",
    square: "small public square of flagstones",
    pond: "small pond surrounded by reeds",
    field: "small enclosed working field",
    fields: "patchwork of small working fields",
    orchard: "compact orchard of low fruit trees",
    barn: "barn building with peaked roof",
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

  // Caller may still turn the raw slug into a hyphen phrase; here we avoid
  // inventing misleading concrete nouns for unknown tokens.
  return MOSAIC_LOCATION_FALLBACK;
}

function prettify(slugOrPhrase: string): string {
  return (slugOrPhrase || "").replace(/-/g, " ").trim();
}

function rowDirectionLabel(y: number, height: number): string {
  if (y === height - 1) return "Top row (northernmost)";
  if (y === 0) return "Bottom row (southernmost)";
  return `Row ${height - 1 - y} of ${height - 1} from the top`;
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

function colorForToken(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = Math.abs(h % 360);
  // Keep blueprint tones muted so they guide structure without dominating.
  const sat = 14 + Math.abs((h >> 3) % 14);
  const light = 62 + Math.abs((h >> 7) % 16);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

/**
 * Build a synthetic "blueprint" guide image aligned to the target grid.
 * The model can use this as a hard spatial prior so landmarks stay within
 * their cells and outer margins are reduced.
 */
export async function createMosaicBlueprintImage(
  grid: TileGrid,
  cellPx: number,
): Promise<ImageResponse> {
  const width = Math.max(1, grid.width * cellPx);
  const height = Math.max(1, grid.height * cellPx);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("createMosaicBlueprintImage: 2d canvas context unavailable");

  ctx.fillStyle = "#f2efe2";
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const t = grid.tiles[y * grid.width + x];
      const imgRow = grid.height - 1 - y;
      const px = x * cellPx;
      const py = imgRow * cellPx;
      const token = `${t.kind}|${t.priorKind ?? ""}|${grid.biome}`;
      ctx.fillStyle = colorForToken(token);
      ctx.fillRect(px, py, cellPx, cellPx);

      // Named anchors: visible inner marker so model keeps motifs contained.
      if (t.locationId) {
        const inset = Math.max(3, Math.floor(cellPx * 0.18));
        ctx.strokeStyle = "#101820";
        ctx.lineWidth = Math.max(2, Math.floor(cellPx * 0.05));
        ctx.strokeRect(px + inset, py + inset, cellPx - inset * 2, cellPx - inset * 2);
      }

      // Intentionally no danger glyphs/dots; they added visual noise and could
      // bias the model toward accidental corner artefacts.
    }
  }

  ctx.strokeStyle = "rgba(65, 58, 45, 0.26)";
  ctx.lineWidth = Math.max(1, Math.floor(cellPx * 0.02));
  for (let x = 0; x <= grid.width; x += 1) {
    const px = x * cellPx;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, 0);
    ctx.lineTo(px + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= grid.height; y += 1) {
    const py = y * cellPx;
    ctx.beginPath();
    ctx.moveTo(0, py + 0.5);
    ctx.lineTo(width, py + 0.5);
    ctx.stroke();
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("createMosaicBlueprintImage: canvas.toBlob returned null");
  const ab = await blob.arrayBuffer();
  return {
    bytes: new Uint8Array(ab),
    mime: "image/png",
    width,
    height,
  };
}

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
