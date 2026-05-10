import type { IndexedWorld } from "../../world/indexer";

type Props = {
  world: IndexedWorld;
  selectedLocationId: string | null;
  onSelectLocation: (locationId: string) => void;
};

export function WorldMap({ world, selectedLocationId, onSelectLocation }: Props) {
  const locations = Object.entries(world.locations);
  return (
    <div className="mapGrid">
      {locations.map(([id, location]) => (
        <button
          key={id}
          type="button"
          className={id === selectedLocationId ? "mapNode selected" : "mapNode"}
          onClick={() => onSelectLocation(id)}
          title={`${location.region} (${location.x}, ${location.y})`}
        >
          <div style={{ fontWeight: 600 }}>{location.name}</div>
          <div style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: 2 }}>
            {location.region || "—"}
          </div>
        </button>
      ))}
    </div>
  );
}
