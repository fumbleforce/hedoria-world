/**
 * Zone-based studio apartment. Instead of a sparse tile grid you walk across,
 * the studio is a small set of named ZONES laid out on a compact 5×5 footprint.
 * The character stands in a zone; clicking another zone moves them there
 * instantly-ish (a short animated glide in the renderer). Nothing is far apart —
 * it's one room plus a bathroom nook.
 */

import type { ActionOption } from "./actions";

export type ZoneId = "desk" | "bed" | "kitchenette" | "bathroom" | "couch" | "door";

export interface Zone {
  id: ZoneId;
  label: string;
  /** Where the character stands, in 5×5 grid cells (0..4). */
  cell: [number, number];
  /** Where the furniture art centers (may differ slightly from stand cell). */
  art: [number, number];
  description: string;
}

/**
 * Compact studio on a 5×5 footprint. `art` is kept equal to `cell` so the
 * furniture draws centered inside the exact zone box it belongs to (no drift).
 */
export const ZONES: Record<ZoneId, Zone> = {
  bed: {
    id: "bed", label: "Bed", cell: [0, 0], art: [0, 0],
    description: "A messy unmade bed. For sleep, late cozy streams, or doomscrolling.",
  },
  desk: {
    id: "desk", label: "Streaming Desk", cell: [4, 0], art: [4, 0],
    description: "Cam, mic, monitors, RGB. The heart of the operation.",
  },
  couch: {
    id: "couch", label: "Couch", cell: [2, 2], art: [2, 2],
    description: "A comfy two-seater for just-chatting and chill streams.",
  },
  kitchenette: {
    id: "kitchenette", label: "Kitchenette", cell: [0, 4], art: [0, 4],
    description: "A hot plate, a kettle, instant noodles. Fuel.",
  },
  bathroom: {
    id: "bathroom", label: "Bathroom", cell: [4, 4], art: [4, 4],
    description: "Tiny bathroom. Freshen up, change, take a real break.",
  },
  door: {
    id: "door", label: "Front Door", cell: [2, 4], art: [2, 4],
    description: "The way out. Deliveries… and visitors.",
  },
};

export const ZONE_LIST = Object.values(ZONES);
export const GRID = 5;
export const SPAWN_ZONE: ZoneId = "couch";

/** Square studio map coordinate system (matches `StudioRoom` SVG). */
export const STUDIO_VB = 500;
export const STUDIO_EDGE = 110;
export const STUDIO_ZONE_HIT = 132;

const STUDIO_SPAN = (STUDIO_VB - STUDIO_EDGE * 2) / (GRID - 1);

/** Default stand positions — copied from each zone's `cell`. */
export function defaultZoneCells(): Record<ZoneId, [number, number]> {
  return Object.fromEntries(ZONE_LIST.map((z) => [z.id, [...z.cell] as [number, number]])) as Record<
    ZoneId,
    [number, number]
  >;
}

export function zoneStandCell(
  zoneId: ZoneId,
  layout: Record<ZoneId, [number, number]>,
): [number, number] {
  return layout[zoneId] ?? ZONES[zoneId].cell;
}

/** Grid cell → SVG center (supports fractional cells for custom layouts). */
export function zoneGridCenter(cell: [number, number]): [number, number] {
  return [STUDIO_EDGE + cell[0] * STUDIO_SPAN, STUDIO_EDGE + cell[1] * STUDIO_SPAN];
}

// Zones may be dragged past the inset grid so a box can sit flush against any
// edge of the square map. The bound keeps the box fully inside the viewbox
// (center stays at least half a box from each edge), expressed in cell units.
const ZONE_CELL_MIN = (STUDIO_ZONE_HIT / 2 - STUDIO_EDGE) / STUDIO_SPAN;
const ZONE_CELL_MAX = (STUDIO_VB - STUDIO_ZONE_HIT / 2 - STUDIO_EDGE) / STUDIO_SPAN;

export function clampZoneCell(cell: [number, number]): [number, number] {
  return [
    Math.max(ZONE_CELL_MIN, Math.min(ZONE_CELL_MAX, cell[0])),
    Math.max(ZONE_CELL_MIN, Math.min(ZONE_CELL_MAX, cell[1])),
  ];
}

/** Merge persisted layout with defaults for any missing zones. */
export function normalizeZoneCells(
  raw: Partial<Record<ZoneId, [number, number]>> | null | undefined,
): Record<ZoneId, [number, number]> {
  const base = defaultZoneCells();
  if (!raw) return base;
  for (const z of ZONE_LIST) {
    const c = raw[z.id];
    if (c && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
      base[z.id] = clampZoneCell([c[0], c[1]]);
    }
  }
  return base;
}

/** Pointer position → grid cell on the studio map SVG. */
export function pointerToZoneCell(svg: SVGSVGElement, clientX: number, clientY: number): [number, number] {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return [2, 2];
  const { x, y } = pt.matrixTransform(ctm.inverse());
  return clampZoneCell([
    (x - STUDIO_EDGE) / STUDIO_SPAN,
    (y - STUDIO_EDGE) / STUDIO_SPAN,
  ]);
}

/**
 * Concrete contextual actions per zone. No vague filler — each option is a
 * specific thing with a clear outcome. `__token__` prompts are handled directly
 * by the controller; the rest are sent through the evaluator. `liveOnly` filters
 * by stream state.
 */
export const ZONE_MENUS: Record<ZoneId, { allowFreeform: boolean; options: ActionOption[] }> = {
  desk: {
    allowFreeform: true,
    options: [
      { id: "go-live", label: "● Go live / End stream", prompt: "__toggle_live__" },
      { id: "play-game", label: "🎬 Start an activity…", prompt: "__game_picker__", liveOnly: true },
      { id: "react-video", label: "📺 React to a trending video", prompt: "react to a trending video chat is linking", liveOnly: true },
      { id: "qna", label: "❓ Do a Q&A from chat", prompt: "answer questions chat is asking", liveOnly: true },
      { id: "karaoke", label: "🎤 Sing a song", prompt: "sing a song for chat", liveOnly: true },
    ],
  },
  couch: {
    allowFreeform: true,
    options: [
      { id: "just-chatting", label: "💬 Just chatting", prompt: "do a relaxed just-chatting segment from the couch", liveOnly: true },
      { id: "tell-story", label: "📖 Tell a story from your week", prompt: "tell chat a specific story from your week", liveOnly: true },
      { id: "open-up", label: "🫧 Open up about something", prompt: "get vulnerable and share something personal", liveOnly: true },
      { id: "nap", label: "😴 Power nap (off-cam)", prompt: "__nap__", liveOnly: false },
      { id: "relieve", label: "💫 Take care of yourself (private)", prompt: "__relieve__", liveOnly: false },
    ],
  },
  bed: {
    allowFreeform: true,
    options: [
      { id: "sleep", label: "🛏️ Sleep until tomorrow", prompt: "__sleep__", liveOnly: false },
      { id: "bed-stream", label: "🌙 Cozy bed stream", prompt: "do a soft late-night stream from bed", liveOnly: true },
      { id: "scroll", label: "📱 Read fan mail in bed", prompt: "__scroll__", liveOnly: false },
      { id: "relieve-bed", label: "💫 Take care of yourself (private)", prompt: "__relieve__", liveOnly: false },
    ],
  },
  kitchenette: {
    allowFreeform: true,
    options: [
      { id: "cook", label: "🍳 Cook instant noodles", prompt: "__cook__", liveOnly: false },
      { id: "cook-stream", label: "👩‍🍳 Cooking segment on-cam", prompt: "do a cooking segment live on cam", liveOnly: true },
      { id: "coffee", label: "☕ Make coffee", prompt: "__coffee__", liveOnly: false },
      { id: "eat", label: "🍽 Eat a proper meal", prompt: "__eat__", liveOnly: false },
    ],
  },
  bathroom: {
    allowFreeform: false,
    options: [
      { id: "bathroom", label: "🚽 Use the bathroom", prompt: "__bathroom__", liveOnly: false },
      { id: "shower", label: "🚿 Take a shower", prompt: "__shower__", liveOnly: false },
      { id: "freshen", label: "🧴 Freshen up (quick)", prompt: "__freshen__", liveOnly: false },
      { id: "wardrobe", label: "👗 Change clothes", prompt: "__wardrobe__", liveOnly: false },
    ],
  },
  door: {
    allowFreeform: false,
    options: [
      { id: "work", label: "💼 Go to work", prompt: "__work__", liveOnly: false },
      { id: "job-board", label: "📋 Job board", prompt: "__job_board__", liveOnly: false },
      { id: "shop", label: "📦 Shop (upgrades & games)", prompt: "__open_shop__", liveOnly: false },
      { id: "check-door", label: "🚪 See who's there", prompt: "__door__", liveOnly: false },
      { id: "order-food", label: "🛵 Order delivery", prompt: "__order_food__", liveOnly: false },
    ],
  },
};
