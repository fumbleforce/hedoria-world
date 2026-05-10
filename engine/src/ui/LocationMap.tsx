import { useStore } from "../state/store";
import type { Tile } from "../grid/tilePrimitives";
import type { TileImageCache } from "../grid/tileImageCache";
import type { WorldNarrator } from "../dialogue/worldNarrator";
import { TileGridView, type ExitDirection } from "./TileGridView";

/**
 * 5×5 location grid. Adjacent passable cell -> move; current cell ->
 * enter_tile (scene mode). The map renders directly into the canvas
 * viewport with no surrounding panel chrome — the HUD handles the
 * location name + (x,y) crumb and the contextual "Leave" action. The
 * camera follows the player so their tile is always centred on screen.
 *
 * Every click is funnelled through `worldNarrator.submitPlayerIntent` so
 * the LLM gets the chance to author narration about the journey alongside
 * the mechanical move.
 */
type Props = {
  imageCache: TileImageCache;
  worldNarrator: WorldNarrator;
};

export function LocationMap({ imageCache, worldNarrator }: Props) {
  const grid = useStore((s) => s.locationGrid);
  const pos = useStore((s) => s.locationPos);

  if (!grid) return null;

  const onCellClick = (x: number, y: number, tile: Tile) => {
    const dx = x - pos[0];
    const dy = y - pos[1];
    if (dx === 0 && dy === 0) {
      if (!tile.passable) return;
      void worldNarrator.submitPlayerIntent({
        kind: "location.enterTile",
        x,
        y,
      });
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) !== 1) return;
    void worldNarrator.submitPlayerIntent({
      kind: "location.move",
      dx,
      dy,
    });
  };

  const onExitClick = (direction: ExitDirection) => {
    void worldNarrator.submitPlayerIntent({
      kind: "location.leave",
      direction,
    });
  };

  // Every location has the same four cardinal exits; eventually we'll
  // surface custom labels (e.g. "to the north gate" if the location's
  // prose specifies one), but for now a uniform "Leave · north" reads
  // clearly and matches the directional arrow on the tile.
  const exits = {
    north: { label: "Leave · N" },
    south: { label: "Leave · S" },
    east: { label: "Leave · E" },
    west: { label: "Leave · W" },
  };

  return (
    <TileGridView
      grid={grid}
      playerPos={pos}
      imageCache={imageCache}
      onCellClick={onCellClick}
      exits={exits}
      onExitClick={onExitClick}
    />
  );
}
