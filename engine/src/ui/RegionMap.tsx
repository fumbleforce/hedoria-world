import { useStore } from "../state/store";
import type { Tile } from "../grid/tilePrimitives";
import type { TileImageCache } from "../grid/tileImageCache";
import type { WorldNarrator } from "../dialogue/worldNarrator";
import { TileGridView } from "./TileGridView";

/**
 * The top-level region map. The map renders directly into the canvas
 * viewport (no surrounding panel chrome). The camera follows the player,
 * so wherever the player walks, their tile stays centred on screen. The
 * HUD shows the region name + (x,y) crumb, so this view doesn't need its
 * own title strip.
 *
 * Click semantics — each gesture is sent through the WorldNarrator so
 * the LLM gets to author narration alongside the mechanical move:
 *
 *   - Adjacent passable cell -> worldNarrator.submitPlayerIntent(region.move)
 *   - Current cell IF it's a location-anchor -> region.enterLocation
 *   - Anything else: ignored.
 */
type Props = {
  imageCache: TileImageCache;
  worldNarrator: WorldNarrator;
};

export function RegionMap({ imageCache, worldNarrator }: Props) {
  const grid = useStore((s) => s.regionGrid);
  const pos = useStore((s) => s.regionPos);

  // No region grid yet — the HUD already surfaces the loading state.
  if (!grid) return null;

  const onCellClick = (x: number, y: number, tile: Tile) => {
    const dx = x - pos[0];
    const dy = y - pos[1];
    if (dx === 0 && dy === 0) {
      if (tile.locationId) {
        void worldNarrator.submitPlayerIntent({
          kind: "region.enterLocation",
          locationId: tile.locationId,
        });
      }
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) !== 1) return;
    void worldNarrator.submitPlayerIntent({
      kind: "region.move",
      dx,
      dy,
    });
  };

  return (
    <TileGridView
      grid={grid}
      playerPos={pos}
      imageCache={imageCache}
      onCellClick={onCellClick}
    />
  );
}
