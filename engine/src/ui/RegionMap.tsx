import type { Tile } from "../grid/tilePrimitives";
import { useStore } from "../state/store";
import type { TileImageCache } from "../grid/tileImageCache";
import { TileGridView } from "./TileGridView";

type RegionSelection = { x: number; y: number };

/**
 * Region overview map. Tile taps update the side-rail locale panel (selection
 * + travel / enter actions live there).
 */
type Props = {
  imageCache: TileImageCache;
  regionSelection: RegionSelection | null;
  onRegionSelectionChange: (next: RegionSelection | null) => void;
};

export function RegionMap({
  imageCache,
  regionSelection,
  onRegionSelectionChange,
}: Props) {
  const grid = useStore((s) => s.regionGrid);
  const pos = useStore((s) => s.regionPos);

  if (!grid) return null;

  const onCellClick = (x: number, y: number, _tile: Tile) => {
    onRegionSelectionChange({ x, y });
  };

  return (
    <TileGridView
      grid={grid}
      playerPos={pos}
      selectedPos={regionSelection ? [regionSelection.x, regionSelection.y] : null}
      imageCache={imageCache}
      onCellClick={onCellClick}
    />
  );
}
