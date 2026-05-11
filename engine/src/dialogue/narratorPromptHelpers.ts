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
  toPassable: boolean | undefined;
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
    return { direction, toPassable: undefined };
  }
  const here = getTile(grid, pos[0], pos[1]);
  const target = getTile(grid, pos[0] + intent.dx, pos[1] + intent.dy);
  return {
    direction,
    fromLabel: tileLabel(here),
    toLabel: tileLabel(target),
    toPassable: target?.passable,
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
          "There is NO walkable path to that cell from the player's position — DO NOT emit travel_region;",
          "the player does not move. Use a single `narrate` call to describe why the route fails.",
        ].join(" ");
      }
      return [
        `Player intent: travel along the walkable path to ${destLabel} at (${intent.x},${intent.y}) on the region grid`,
        `(${path.length - 1} step(s)). Emit travel_region({x:${intent.x},y:${intent.y}}) and a single \`narrate\` call`,
        "covering the whole approach — textures, sounds, weather — without naming every intermediate cell.",
      ].join(" ");
    }
    case "region.enterLocation":
      return `Player intent: enter the named location. Emit enter_location({locationId:"${intent.locationId}"}) and a narrate call describing the threshold.`;
    case "location.move": {
      const ctx = movementContext(intent, state);
      return movementHint("move_location", ctx, "location");
    }
    case "location.enterTile":
      return `Player intent: enter the location tile at (${intent.x},${intent.y}) — transitions to scene mode. Emit enter_tile({x:${intent.x},y:${intent.y}}) and a narrate call setting the scene.`;
    case "location.leave":
      return intent.direction
        ? `Player intent: leave the location to the ${intent.direction}. Emit leave_location({direction:"${intent.direction}"}) and a narrate call.`
        : `Player intent: leave the location. Emit leave_location({}) and a narrate call.`;
    case "freetext":
      return `Player intent: a free-form action — "${intent.text}". Decide what (if anything) it changes in the world. Always emit a narrate call describing what the player perceives. If the action implies a mechanical change (item picked up, NPC summoned to greet them, quest taken, position changed), also emit the matching tool call. If the action is impossible or has no in-world effect, just narrate the attempt or its failure.`;
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

  if (ctx.toPassable === false) {
    return [
      `Player intent: attempt to walk ${ctx.direction} on the ${gridKind} grid,`,
      `from ${from} toward ${to}.`,
      `The destination tile is IMPASSABLE — DO NOT emit ${toolName};`,
      `the player does not move. In your single \`narrate\` call,`,
      `make it unmistakable that ${to} stops them: describe approaching it,`,
      `running into it, and turning back. Reference both ${from} (where they`,
      `still stand) and ${to} (the obstacle) by name so the line reads as a`,
      `failed step, not a successful one.`,
    ].join(" ");
  }

  return [
    `Player intent: walk one cell ${ctx.direction} on the ${gridKind} grid,`,
    `from ${from} toward ${to}.`,
    `Emit ${toolName}({direction:"${ctx.direction}"}) and a single \`narrate\` call.`,
    `Name BOTH ${from} (where the step began) and ${to} (where the step ends)`,
    `in the prose so the journey reads as transit — leaving one tile,`,
    `arriving at the next — rather than a generic "you walk ${ctx.direction}".`,
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
    parts.push(`${name}=${label}${t.passable ? "" : "(blocked)"}`);
  }
  return parts.join(", ");
}
