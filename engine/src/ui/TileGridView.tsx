import { useEffect, useState } from "react";
import type { Tile, TileGrid } from "../grid/tilePrimitives";
import { isEngineKind } from "../grid/tilePrimitives";
import type { TileImageCache } from "../grid/tileImageCache";
import { useStore } from "../state/store";

/**
 * Shared map renderer for both RegionMap and LocationMap. Each cell shows
 * a cached tile illustration + a short label. The player position gets a
 * marker overlay; cells adjacent to the player are highlighted as
 * "movable" and the current cell as "occupied". Click semantics are left
 * to the parent so the same view can drive region traversal, location
 * traversal, or any other 2D map screen later.
 *
 * Layout — TileGridView is now camera-follow: the outer viewport fills
 * the parent and clips overflow; the inner grid uses fixed-pixel cells
 * and is translated so the centre of the player's tile lands on the
 * viewport's centre. Moving the player just changes the translate, which
 * animates smoothly via a CSS transition. This unlocks two future wins:
 *
 *   1. Cross-region traversal — the inner grid can grow beyond a single
 *      region without forcing the player to ever see the seam.
 *   2. Viewport-only generation — we can clip image-cache pre-warm to
 *      tiles inside the visible window.
 *
 * Coordinate convention: the rest of the engine uses cartographer-style
 * (+x = east, +y = NORTH). CSS grid lays children out top-to-bottom in
 * source order, which would put y=0 at the top — the OPPOSITE of north.
 * To keep north visually up, this view is the ONE place we y-flip:
 * each cell at logical (x, y) is rendered into CSS row `(height - y)`
 * (1-indexed), so y=H-1 ends up at the top and y=0 at the bottom.
 *
 * When `exits` is provided, the layout grows to (W+2) × (H+2) and four
 * exit tiles (north / south / east / west) appear at the cardinal
 * mid-points of the outer ring, while the actual grid fills the inner
 * (W × H) area. This is how location maps show "doors out of this
 * place".
 */
export type ExitDirection = "north" | "south" | "east" | "west";
export type ExitTile = {
  /** Short label rendered on the tile, e.g. "Exit · north". */
  label?: string;
};

/**
 * Fixed pixel size of one map cell. Chosen so a 10×10 region fits
 * comfortably in a 1080p viewport (~ 10×112 = 1120 px, slightly larger
 * than the typical visible area), and so the cells are large enough for
 * the LLM-generated tile imagery to read clearly.
 */
const TILE_PX = 112;

export type TileGridViewProps = {
  grid: TileGrid;
  playerPos: [number, number];
  imageCache: TileImageCache;
  onCellClick: (x: number, y: number, tile: Tile) => void;
  /** Optional cell-level decoration (e.g. quest-marker icon overlay). */
  renderOverlay?: (tile: Tile, x: number, y: number) => React.ReactNode;
  /**
   * Optional cardinal exits. When provided, the outer CSS grid expands by
   * one ring on every side and the four exit slots are populated at the
   * cardinal middles. Pass `undefined` for any direction to omit it.
   */
  exits?: Partial<Record<ExitDirection, ExitTile>>;
  /** Called when an exit tile is clicked. Required when `exits` is set. */
  onExitClick?: (direction: ExitDirection) => void;
};

export function TileGridView(props: TileGridViewProps) {
  const {
    grid,
    playerPos,
    imageCache,
    onCellClick,
    renderOverlay,
    exits,
    onExitClick,
  } = props;
  const [, forceTick] = useState(0);

  // Re-render when new images become available. The cache notifies us per
  // resolved key; we just bump a tick to read peek() again.
  useEffect(() => {
    return imageCache.subscribe(() => forceTick((n) => n + 1));
  }, [imageCache]);

  // When exits are present, we render a (W+2) × (H+2) outer grid: the
  // inner W×H grid sits in the middle and the 4 cardinal mid-cells hold
  // exit tiles. Without exits, behaviour is unchanged: a clean W×H grid.
  const hasExits = !!exits;
  const outerW = hasExits ? grid.width + 2 : grid.width;
  const outerH = hasExits ? grid.height + 2 : grid.height;
  const inset = hasExits ? 1 : 0;

  // Compute the focal point: the *centre* of the player's tile in the
  // grid's own CSS coordinate space (top-left origin, +y = down). The
  // y-flip mirrors what we do per-cell below — the northernmost logical
  // row maps to CSS row 0.
  const playerColOuter = playerPos[0] + inset;
  const playerRowOuter = grid.height - 1 - playerPos[1] + inset;
  const focusX = (playerColOuter + 0.5) * TILE_PX;
  const focusY = (playerRowOuter + 0.5) * TILE_PX;

  return (
    <div className="tileGridViewport">
      <div
        className={hasExits ? "tileGrid tileGrid--withExits" : "tileGrid"}
        style={{
          // The grid is positioned absolutely inside the viewport. Its
          // top-left starts at viewport-centre, and the transform pulls
          // it back by the focus offset so the player's tile centre
          // lands at exactly 50%/50% of the viewport. The transition
          // gives the camera a deliberate, weighty glide whenever the
          // focus changes — slower than the portrait below, so the
          // portrait visibly LEADS the move and the camera catches up.
          display: "grid",
          position: "absolute",
          left: "50%",
          top: "50%",
          width: `${outerW * TILE_PX}px`,
          height: `${outerH * TILE_PX}px`,
          gridTemplateColumns: `repeat(${outerW}, ${TILE_PX}px)`,
          gridTemplateRows: `repeat(${outerH}, ${TILE_PX}px)`,
          // Tiles butt directly against each other — the per-cell
          // styling (subtle inset, soft corner radius) is what hints
          // "grid" without painting dark gutters across every seam.
          gap: 0,
          transform: `translate(${-focusX}px, ${-focusY}px)`,
          transition:
            // Camera glide: long & smooth so a single step feels weighty.
            "transform 720ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {grid.tiles.map((tile, idx) => {
          const x = idx % grid.width;
          const y = Math.floor(idx / grid.width);
          const here = playerPos[0] === x && playerPos[1] === y;
          const adjacent =
            Math.abs(playerPos[0] - x) + Math.abs(playerPos[1] - y) === 1;
          // Y-flip + inset (when there's an exit ring around the grid).
          const cssRow = outerH - inset - y;
          const cssCol = x + 1 + inset;
          return (
            <TileGridCell
              key={idx}
              grid={grid}
              tile={tile}
              x={x}
              y={y}
              cssRow={cssRow}
              cssCol={cssCol}
              here={here}
              adjacent={adjacent}
              imageCache={imageCache}
              onClick={() => onCellClick(x, y, tile)}
              overlay={renderOverlay?.(tile, x, y)}
            />
          );
        })}
        {hasExits ? renderExits(grid, exits, onExitClick) : null}
        <PlayerPortrait focusX={focusX} focusY={focusY} />
      </div>
    </div>
  );
}

/**
 * Round character portrait pinned to the player's tile centre. Lives in
 * grid-space (so it travels with the world, not the screen) and animates
 * faster than the camera. The visual effect: the portrait leaps to the
 * destination tile while the camera is still gliding, briefly leaving it
 * off-centre toward the direction of motion before everything settles.
 * That offset between portrait-arrival and camera-arrival is what gives
 * a single step real weight.
 *
 * When the player has generated a character portrait in the character
 * panel, that image fills the disc. Otherwise we fall back to a neutral
 * gradient + silhouette so the marker is still visible (boot-time, or
 * if the portrait generation failed). Reading `portraitDataUrl` from
 * the store via a selector means a freshly-generated portrait shows up
 * the moment the character panel updates the store, no remount needed.
 */
function PlayerPortrait({ focusX, focusY }: { focusX: number; focusY: number }) {
  const portraitDataUrl = useStore((s) => s.character?.portraitDataUrl);
  const characterName = useStore((s) => s.character?.name);
  const hasPortrait = typeof portraitDataUrl === "string" && portraitDataUrl.length > 0;

  return (
    <div
      className={
        hasPortrait
          ? "tileGrid__portrait tileGrid__portrait--withImage"
          : "tileGrid__portrait"
      }
      style={{
        // Positioned in the same coordinate space as cells: (focusX, focusY)
        // is the centre of the player's tile, so we pull the portrait
        // back by half its size to center it on that point.
        position: "absolute",
        left: `${focusX}px`,
        top: `${focusY}px`,
        transform: "translate(-50%, -50%)",
        transition:
          "left 320ms cubic-bezier(0.34, 1.56, 0.64, 1), top 320ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        pointerEvents: "none",
        zIndex: 10,
      }}
      aria-label={characterName ? `${characterName} is here` : "You are here"}
    >
      <div
        className="tileGrid__portraitDisc"
        style={
          hasPortrait
            ? {
                backgroundImage: `url("${portraitDataUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {hasPortrait ? null : (
          <svg
            className="tileGrid__portraitGlyph"
            viewBox="0 0 32 32"
            aria-hidden="true"
          >
            <circle cx="16" cy="12" r="5" />
            <path d="M6 28 C 6 20, 26 20, 26 28 Z" />
          </svg>
        )}
      </div>
    </div>
  );
}

/**
 * Compute the CSS grid coordinates for each cardinal exit slot and emit
 * <ExitCell /> elements. The exits sit on the outer ring at the
 * mid-column / mid-row of the inner grid, so a 5x5 location with a
 * 7x7 outer layout has exits at:
 *   - north: outer row 1, col centre (3 for an odd-width 5)
 *   - south: outer row last, col centre
 *   - west:  outer row centre, col 1
 *   - east:  outer row centre, col last
 */
function renderExits(
  grid: TileGrid,
  exits: Partial<Record<ExitDirection, ExitTile>> | undefined,
  onExitClick: ((direction: ExitDirection) => void) | undefined,
): React.ReactNode {
  if (!exits) return null;
  const outerW = grid.width + 2;
  const outerH = grid.height + 2;
  // Mid-column = ceil(grid.width/2) shifted by the +1 inset = +1 .. +grid.width.
  const midCol = Math.floor(grid.width / 2) + 2;
  const midRow = Math.floor(grid.height / 2) + 2;

  const slots: Array<{
    direction: ExitDirection;
    cssRow: number;
    cssCol: number;
    arrow: string;
  }> = [];
  if (exits.north) {
    slots.push({ direction: "north", cssRow: 1, cssCol: midCol, arrow: "↑" });
  }
  if (exits.south) {
    slots.push({
      direction: "south",
      cssRow: outerH,
      cssCol: midCol,
      arrow: "↓",
    });
  }
  if (exits.west) {
    slots.push({ direction: "west", cssRow: midRow, cssCol: 1, arrow: "←" });
  }
  if (exits.east) {
    slots.push({
      direction: "east",
      cssRow: midRow,
      cssCol: outerW,
      arrow: "→",
    });
  }

  return slots.map((slot) => (
    <ExitCell
      key={`exit-${slot.direction}`}
      direction={slot.direction}
      arrow={slot.arrow}
      cssRow={slot.cssRow}
      cssCol={slot.cssCol}
      label={exits[slot.direction]?.label}
      onClick={() => onExitClick?.(slot.direction)}
    />
  ));
}

type ExitCellProps = {
  direction: ExitDirection;
  arrow: string;
  cssRow: number;
  cssCol: number;
  label?: string;
  onClick: () => void;
};

function ExitCell({
  direction,
  arrow,
  cssRow,
  cssCol,
  label,
  onClick,
}: ExitCellProps) {
  return (
    <button
      type="button"
      className={`tileGrid__cell tileGrid__cell--exit tileGrid__cell--exit-${direction}`}
      onClick={onClick}
      style={{ gridRow: cssRow, gridColumn: cssCol }}
      title={`Leave the location heading ${direction}`}
    >
      <span className="tileGrid__cellExitArrow" aria-hidden="true">
        {arrow}
      </span>
      <span className="tileGrid__cellLabel">{label ?? `Leave · ${direction}`}</span>
    </button>
  );
}

type CellProps = {
  grid: TileGrid;
  tile: Tile;
  x: number;
  y: number;
  /** 1-indexed CSS grid row (height - y). */
  cssRow: number;
  /** 1-indexed CSS grid column (x + 1). */
  cssCol: number;
  here: boolean;
  adjacent: boolean;
  imageCache: TileImageCache;
  onClick: () => void;
  overlay?: React.ReactNode;
};

function TileGridCell({
  grid,
  tile,
  x,
  y,
  cssRow,
  cssCol,
  here,
  adjacent,
  imageCache,
  onClick,
  overlay,
}: CellProps) {
  // peekTile() is sync; if not yet loaded we kick off async generation
  // so it shows up on the next subscribe-driven tick. The cache's
  // current mode picks the key (per-tile vs. mosaic per-position),
  // so the same call site works for both strategies.
  const url = imageCache.peekTile(grid, x, y, tile);
  useEffect(() => {
    if (!url) {
      void imageCache.getUrlForTile(grid, x, y, tile).catch(() => null);
    }
  }, [url, grid, x, y, tile, imageCache]);

  const className = [
    "tileGrid__cell",
    here ? "tileGrid__cell--here" : "",
    adjacent ? "tileGrid__cell--adjacent" : "",
    !tile.passable ? "tileGrid__cell--impassable" : "",
    tile.dangerous ? "tileGrid__cell--dangerous" : "",
    isEngineKind(tile.kind) ? `tileGrid__cell--${tile.kind}` : "",
    tile.locationId ? "tileGrid__cell--anchor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // No image yet — flat colour placeholder; a single map-wide loading
  // film on `.tileGrid` (CSS :has) reads through at slightly reduced
  // opacity (see `.tileGrid__cellImage--pending`).
  const imageClass = url
    ? "tileGrid__cellImage"
    : "tileGrid__cellImage tileGrid__cellImage--pending";

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      style={{ gridRow: cssRow, gridColumn: cssCol }}
      title={`${tile.label ?? tile.kind} (${tile.kind})`}
    >
      <span
        className={imageClass}
        style={{
          // Quote the URL so any parentheses inside a data: URL (e.g. an SVG
          // placeholder using rgb()) cannot terminate the outer url() call
          // and leave the cell with no visible background.
          backgroundImage: url ? `url("${url.replace(/"/g, '\\"')}")` : undefined,
          backgroundColor: url ? undefined : kindColor(tile.kind),
        }}
      />
      <span className="tileGrid__cellLabel">{tile.label ?? tile.kind}</span>
      {tile.questMarker ? <span className="tileGrid__questMarker">!</span> : null}
      {/* The "you are here" marker now lives outside the cell as a
          floating circular portrait (see PlayerPortrait). The cell
          itself just wears `tileGrid__cell--here` so callers can still
          tint the underlying tile. */}
      {overlay}
    </button>
  );
}

/**
 * Quick deterministic colour from kind name, used as a placeholder while
 * the LLM-generated image is still loading. Same colour for the same kind
 * so the grid stays visually stable.
 */
function kindColor(kind: string): string {
  let h = 0;
  for (let i = 0; i < kind.length; i += 1) {
    h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue}, 35%, 38%)`;
}
