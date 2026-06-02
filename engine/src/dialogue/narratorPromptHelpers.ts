import type { StoreState } from "../state/store";
import { getTile, type Tile, type TileGrid } from "../grid/tilePrimitives";
import { findRegionWalkPath } from "../grid/pathing";
import type { PlayerIntent } from "./playerIntent";

const DIR_NAMES: Record<string, string> = {
  "1,0": "east",
  "-1,0": "west",
  "0,1": "north",
  "0,-1": "south",
};

export function dirName(dx: number, dy: number): string {
  return DIR_NAMES[`${dx},${dy}`] ?? "onward";
}

export type MoveContext = {
  direction: string;
  fromLabel?: string;
  toLabel?: string;
};

export function tileLabel(tile: Tile | undefined): string | undefined {
  if (!tile) return undefined;
  return (tile.label ?? tile.kind)?.replace(/\s+/g, " ").trim() || undefined;
}

export function movementContext(
  intent:
    | { kind: "region.move"; dx: number; dy: number }
    | { kind: "location.move"; dx: number; dy: number },
  state: StoreState,
): MoveContext {
  const direction = dirName(intent.dx, intent.dy);
  const grid =
    intent.kind === "region.move" ? state.regionGrid : state.locationGrid;
  const pos =
    intent.kind === "region.move" ? state.regionPos : state.locationPos;
  if (!grid) {
    return { direction };
  }
  const here = getTile(grid, pos[0], pos[1]);
  const target = getTile(grid, pos[0] + intent.dx, pos[1] + intent.dy);
  return {
    direction,
    fromLabel: tileLabel(here),
    toLabel: tileLabel(target),
  };
}

export function intentHintLine(intent: PlayerIntent, state: StoreState): string {
  switch (intent.kind) {
    case "region.move": {
      const ctx = movementContext(intent, state);
      return movementHint("move_region", ctx, "region");
    }
    case "region.travelTo": {
      const grid = state.regionGrid;
      const pos = state.regionPos;
      if (!grid) {
        return `Player intent: travel to region cell (${intent.x},${intent.y}). Emit travel_region({x:${intent.x},y:${intent.y}}) and a narrate call describing the journey.`;
      }
      const dest = getTile(grid, intent.x, intent.y);
      const destLabel = dest ? tileLabel(dest) ?? `(${intent.x},${intent.y})` : `(${intent.x},${intent.y})`;
      const path = findRegionWalkPath(
        grid,
        { x: pos[0], y: pos[1] },
        { x: intent.x, y: intent.y },
      );
      if (!path || path.length < 2) {
        return [
          `Player intent: travel toward ${destLabel} at (${intent.x},${intent.y}) on the region grid.`,
          "There is NO route to that cell from the player's position — DO NOT emit travel_region;",
          "the player does not move. Use a single `narrate` call to describe why the route fails.",
        ].join(" ");
      }
      return [
        `Player intent: travel along the route to ${destLabel} at (${intent.x},${intent.y}) on the region grid`,
        `(${path.length - 1} step(s)). Emit travel_region({x:${intent.x},y:${intent.y}}) and a single \`narrate\` call`,
        "covering the whole approach — the player's surroundings as the route unfolds — without naming every intermediate cell.",
      ].join(" ");
    }
    case "region.enterLocation":
      return [
        `Player intent: cross from outside ${intent.locationId} into it.`,
        `Until now they were outside; now they enter — in whatever form a "threshold" takes for this kind of place (the location description below tells you what kind of place it is).`,
        `Narrate the crossing itself: how the player's surroundings change as they pass from outside to inside.`,
        `Emit enter_location({locationId:"${intent.locationId}"}). They were outside; now they are inside.`,
      ].join(" ");
    case "location.move": {
      const ctx = movementContext(intent, state);
      return movementHint("move_location", ctx, "location");
    }
    case "location.enterTile":
      return [
        `Player intent: move to the specific spot at (${intent.x},${intent.y}) within the place and stand there.`,
        `Until now they were taking the place in at a wider view; now they're up close — close enough to interact directly with whoever or whatever is there.`,
        `Narrate the approach: what the spot looks and feels like as they reach it; who or what they notice now that they're close.`,
        `Emit enter_tile({x:${intent.x},y:${intent.y}}).`,
      ].join(" ");
    case "location.leave":
      return [
        `Player intent: cross back out${intent.direction ? ` to the ${intent.direction}` : ""} — leave the named place and return to the wider region.`,
        `Narrate the crossing outward in whatever form makes sense for the place, with the place fading behind them.`,
        `Emit leave_location(${intent.direction ? `{direction:"${intent.direction}"}` : `{}`}).`,
      ].join(" ");
    case "freetext": {
      // Surface the engaged-NPC short-list so the hint can demand a
      // response from the specific id rather than a vague "an NPC".
      const engagedIds: string[] = [];
      for (const g of Object.values(state.engagement.groups)) {
        if (g.state !== "engaged" && g.state !== "locked") continue;
        for (const id of g.npcIds) engagedIds.push(id);
      }
      const baseHint = `Player intent: a free-form action — "${intent.text}". Write the player's beat as narration (their action, their environment) in the assistant content channel. Emit any matching mechanical tool calls.`;
      if (state.mode === "scene" && engagedIds.length > 0) {
        return [
          baseHint,
          "",
          `This turn is happening in scene mode with engaged NPC(s): ${engagedIds.join(", ")}.`,
          "If the player addressed any of them (asked a question, made a remark, demanded an answer), you MUST emit `say({npcId, text})` for that NPC's reply on this same turn — they do not stay silent unless the FICTION calls for it, and even then narrate their body language (frown, shrug, look away) and still emit a `say` with what they mutter.",
          "Do NOT write meta-narration like 'no one reacts', 'the air hangs still', 'the question lingers'. The player gets a real reply on every turn they speak.",
        ].join(" ");
      }
      return baseHint;
    }
    default:
      return "";
  }
}

export function movementHint(
  toolName: "move_region" | "move_location",
  ctx: MoveContext,
  gridKind: "region" | "location",
): string {
  const from = ctx.fromLabel ? `"${ctx.fromLabel}"` : "the current tile";
  const to = ctx.toLabel ? `"${ctx.toLabel}"` : "the adjacent tile";

  return [
    `Player intent: move one cell ${ctx.direction} on the ${gridKind} grid,`,
    `from ${from} toward ${to}.`,
    `Emit ${toolName}({direction:"${ctx.direction}"}) and a single \`narrate\` call.`,
    `Name BOTH ${from} (where the step began) and ${to} (where the step ends)`,
    `in the prose so the move reads as transit — leaving one tile,`,
    `arriving at the next — rather than a generic "you go ${ctx.direction}".`,
    `Choose the right verb (walk, ride, climb, swim, drift, hover, whatever fits)`,
    `from what the tile data and place description tell you.`,
  ].join(" ");
}

export function adjacentSummary(grid: TileGrid, pos: readonly [number, number]): string {
  const dirs: Array<[string, number, number]> = [
    ["N", 0, 1],
    ["S", 0, -1],
    ["E", 1, 0],
    ["W", -1, 0],
  ];
  const parts: string[] = [];
  for (const [name, dx, dy] of dirs) {
    const x = pos[0] + dx;
    const y = pos[1] + dy;
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
      parts.push(`${name}=edge`);
      continue;
    }
    const t = getTile(grid, x, y);
    if (!t) continue;
    const label = (t.label ?? t.kind).replace(/\s+/g, " ");
    parts.push(`${name}=${label}`);
  }
  return parts.join(", ");
}

/**
 * Compose a short bearing word for an offset on the cartesian grid:
 *
 *   +x = east, +y = NORTH (matches tilePrimitives.ts).
 *
 * We collapse near-cardinal vectors to a single direction ("east")
 * rather than producing intercardinals ("east-northeast") because the
 * LLM only needs a coarse heading for narration. The full delta is
 * still included in the prompt for any reasoning the model wants to
 * do.
 */
function bearing(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return "here";
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // Diagonal if neither axis dominates by >=2x.
  const diagonal = Math.min(ax, ay) * 2 > Math.max(ax, ay);
  if (diagonal) {
    const ns = dy > 0 ? "north" : "south";
    const ew = dx > 0 ? "east" : "west";
    return `${ns}${ew}`;
  }
  if (ax > ay) return dx > 0 ? "east" : "west";
  return dy > 0 ? "north" : "south";
}

/**
 * Walk the region grid for `location-anchor` cells and emit a compact
 * list grounded in real map facts: each named location is identified
 * with its id, label, signed offset from the player, and a short
 * bearing word. The LLM uses this to ground prose in the actual
 * geography — e.g. it can mention "Riverwatch lies five tiles to the
 * east" because it sees that anchor, and it does NOT see "Harkenfells"
 * because that string isn't in the world. This is the cure for the
 * "invents adjacent landmarks" hallucination.
 *
 * Capped to 12 entries (sorted by Manhattan distance) so the prompt
 * stays small even on dense maps.
 */
export function nearbyLocationsSummary(
  grid: TileGrid,
  pos: readonly [number, number],
): string {
  if (grid.scope !== "region") return "";
  type Hit = {
    locationId: string;
    label: string;
    dx: number;
    dy: number;
    dist: number;
  };
  const hits: Hit[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const t = grid.tiles[y * grid.width + x];
      if (!t?.locationId) continue;
      const dx = x - pos[0];
      const dy = y - pos[1];
      hits.push({
        locationId: t.locationId,
        label: (t.label ?? t.locationId).replace(/\s+/g, " ").trim(),
        dx,
        dy,
        dist: Math.abs(dx) + Math.abs(dy),
      });
    }
  }
  if (hits.length === 0) return "";
  hits.sort((a, b) => a.dist - b.dist);
  const top = hits.slice(0, 12);
  return top
    .map((h) => {
      // Use "this tile" rather than "you stand here" — the latter
      // misleads the LLM into thinking the player is INSIDE the place
      // when they are merely standing on the region tile representing
      // it from outside.
      const here = h.dist === 0 ? " (this tile — the player is on the road outside)" : "";
      const offset = `Δx=${h.dx},Δy=${h.dy}`;
      const dir = h.dist === 0 ? "" : `, ${bearing(h.dx, h.dy)} ${h.dist} tile${h.dist === 1 ? "" : "s"}`;
      return `  - ${h.locationId} ("${h.label}"): ${offset}${dir}${here}`;
    })
    .join("\n");
}

/**
 * Same idea at the location scale: scan the location grid for area
 * anchors / labelled tiles so the LLM can ground area names.
 *
 * Location tiles do not carry `locationId` (that's region-only); we
 * instead pick tiles whose label is non-empty and not equal to their
 * kind, which is the convention `tileFiller` uses for named area
 * cells.
 */
export function namedAreasSummary(
  grid: TileGrid,
  pos: readonly [number, number],
): string {
  if (grid.scope !== "location") return "";
  type Hit = { label: string; dx: number; dy: number; dist: number };
  const hits: Hit[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const t = grid.tiles[y * grid.width + x];
      if (!t) continue;
      const lbl = (t.label ?? "").trim();
      if (!lbl || lbl === t.kind) continue;
      const dx = x - pos[0];
      const dy = y - pos[1];
      hits.push({ label: lbl, dx, dy, dist: Math.abs(dx) + Math.abs(dy) });
    }
  }
  if (hits.length === 0) return "";
  hits.sort((a, b) => a.dist - b.dist);
  return hits
    .slice(0, 12)
    .map((h) => {
      const here = h.dist === 0 ? " (this tile)" : "";
      const dir = h.dist === 0 ? "" : `, ${bearing(h.dx, h.dy)} ${h.dist} tile${h.dist === 1 ? "" : "s"}`;
      return `  - "${h.label}": Δx=${h.dx},Δy=${h.dy}${dir}${here}`;
    })
    .join("\n");
}
