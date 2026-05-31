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
      { id: "change-cozy", label: "🧶 Change into a cozy fit", prompt: "__outfit_cozy__", liveOnly: false },
      { id: "change-cute", label: "✨ Change into a cute fit", prompt: "__outfit_cute__", liveOnly: false },
      { id: "change-bold", label: "🔥 Change into a bold fit", prompt: "__outfit_bold__", liveOnly: false },
    ],
  },
  door: {
    allowFreeform: false,
    options: [
      { id: "check-door", label: "🚪 See who's there", prompt: "__door__", liveOnly: false },
      { id: "order-food", label: "🛵 Order delivery", prompt: "__order_food__", liveOnly: false },
    ],
  },
};
