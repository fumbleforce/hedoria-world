import { useEffect, useMemo, useState } from "react";
import { useStore, type Mode } from "../state/store";
import { getTile } from "../grid/tilePrimitives";
import { findRegionWalkPath } from "../grid/pathing";
import type { WorldNarrator } from "../dialogue/worldNarrator";
import type { IndexedWorld } from "../world/indexer";
import { locationAreaDescriptions } from "./localePanelUtils";
import {
  partitionCharactersAndParties,
  sortedGroupsForView,
} from "../scene/engagement";

type RegionSelection = { x: number; y: number };

type Props = {
  world: IndexedWorld;
  worldNarrator: WorldNarrator;
  regionSelection: RegionSelection | null;
  onRegionSelectionChange: (next: RegionSelection | null) => void;
};

/**
 * Side-rail "where am I" context: tabbed Region / Location / Scene so the
 * player can read the current level or jump up the stack without leaving
 * the mode they're in. On the region map, a selected tile replaces the
 * region overview until cleared.
 */
export function LocaleContextPanel({
  world,
  worldNarrator,
  regionSelection,
  onRegionSelectionChange,
}: Props) {
  const mode = useStore((s) => s.mode);
  const currentRegionId = useStore((s) => s.currentRegionId);
  const currentLocationId = useStore((s) => s.currentLocationId);
  const regionGrid = useStore((s) => s.regionGrid);
  const regionPos = useStore((s) => s.regionPos);
  const locationGrid = useStore((s) => s.locationGrid);
  const currentSceneTile = useStore((s) => s.currentSceneTile);
  const engagement = useStore((s) => s.engagement);

  const [activeTab, setActiveTab] = useState<Mode>(mode);

  useEffect(() => {
    setActiveTab(mode);
  }, [mode]);

  const region = currentRegionId ? world.regionsById[currentRegionId] : undefined;
  const regionName = region?.name ?? currentRegionId ?? "—";
  const location = currentLocationId ? world.locations[currentLocationId] : undefined;
  const locationName = location?.name ?? currentLocationId ?? "";
  const locationAreaText = useMemo(
    () => (location ? locationAreaDescriptions(location) : ""),
    [location],
  );

  const showLocationTab = !!currentLocationId;
  const showSceneTab = mode === "scene" && !!currentSceneTile;

  const selectedTile = useMemo(() => {
    if (!regionGrid || !regionSelection) return undefined;
    return getTile(regionGrid, regionSelection.x, regionSelection.y);
  }, [regionGrid, regionSelection]);

  const atPlayer =
    !!regionSelection &&
    regionSelection.x === regionPos[0] &&
    regionSelection.y === regionPos[1];

  const pathToSelected = useMemo(() => {
    if (!regionGrid || !regionSelection || !selectedTile?.passable || atPlayer) {
      return null;
    }
    return findRegionWalkPath(
      regionGrid,
      { x: regionPos[0], y: regionPos[1] },
      { x: regionSelection.x, y: regionSelection.y },
    );
  }, [regionGrid, regionSelection, selectedTile, atPlayer, regionPos]);

  const canWalkTo = !!pathToSelected && pathToSelected.length >= 2;

  const locFromTile = selectedTile?.locationId
    ? world.locations[selectedTile.locationId]
    : undefined;

  const tileTitle =
    locFromTile?.name ||
    selectedTile?.label ||
    selectedTile?.kind ||
    (regionSelection ? `Tile (${regionSelection.x},${regionSelection.y})` : "");

  const tileDescription = locFromTile ? locationAreaDescriptions(locFromTile) : "";
  const tileInfo = locFromTile?.basicInfo?.trim() ?? "";
  const terrainHint =
    !locFromTile && selectedTile
      ? [
          selectedTile.label,
          selectedTile.kind && selectedTile.kind !== selectedTile.label
            ? selectedTile.kind
            : null,
          selectedTile.dangerous ? "Hazardous crossing." : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  const canEnterTile =
    mode === "region" && atPlayer && !!selectedTile?.locationId && !!regionSelection;

  const sceneSorted = useMemo(() => sortedGroupsForView(engagement), [engagement]);
  const { characters, parties } = useMemo(
    () => partitionCharactersAndParties(sceneSorted),
    [sceneSorted],
  );
  const underlyingSceneTile = useMemo(() => {
    if (!locationGrid || !currentSceneTile) return null;
    return getTile(locationGrid, currentSceneTile.x, currentSceneTile.y);
  }, [locationGrid, currentSceneTile]);

  const showMapCellActionFooter =
    mode === "region" &&
    !!regionSelection &&
    !!selectedTile &&
    (!atPlayer || !!(canEnterTile && selectedTile.locationId));

  return (
    <section
      className="sideRail__card localeContextPanel"
      aria-label="Place and context"
    >
      <div className="localeContextPanel__tabs" role="tablist" aria-orientation="horizontal">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "region"}
          className={
            activeTab === "region"
              ? "localeContextPanel__tab localeContextPanel__tab--active"
              : "localeContextPanel__tab"
          }
          onClick={() => setActiveTab("region")}
        >
          Region
        </button>
        {showLocationTab ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "location"}
            className={
              activeTab === "location"
                ? "localeContextPanel__tab localeContextPanel__tab--active"
                : "localeContextPanel__tab"
            }
            onClick={() => setActiveTab("location")}
          >
            Location
          </button>
        ) : null}
        {showSceneTab ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "scene"}
            className={
              activeTab === "scene"
                ? "localeContextPanel__tab localeContextPanel__tab--active"
                : "localeContextPanel__tab"
            }
            onClick={() => setActiveTab("scene")}
          >
            Scene
          </button>
        ) : null}
      </div>

      <div className="localeContextPanel__body" role="tabpanel">
        {activeTab === "region" ? (
          <>
            {mode === "region" && regionSelection && selectedTile ? (
              <>
                <div className="localeContextPanel__scroll">
                  <h2 className="localeContextPanel__title">
                    Map cell <small>{tileTitle}</small>
                  </h2>
                  <p className="localeContextPanel__meta">
                    {regionName} · {regionSelection.x},{regionSelection.y}
                    {selectedTile.locationId ? ` · ${selectedTile.locationId}` : ""}
                  </p>
                  <button
                    type="button"
                    className="localeContextPanel__textBtn"
                    onClick={() => onRegionSelectionChange(null)}
                  >
                    Region overview
                  </button>
                  {tileDescription ? (
                    <section className="localeContextPanel__section">
                      <h3 className="localeContextPanel__sectionLabel">Description</h3>
                      <p className="localeContextPanel__prose">{tileDescription}</p>
                    </section>
                  ) : null}
                  {tileInfo ? (
                    <section className="localeContextPanel__section">
                      <h3 className="localeContextPanel__sectionLabel">Info</h3>
                      <p className="localeContextPanel__prose">{tileInfo}</p>
                    </section>
                  ) : null}
                  {!tileDescription && !tileInfo && terrainHint ? (
                    <section className="localeContextPanel__section">
                      <h3 className="localeContextPanel__sectionLabel">Terrain</h3>
                      <p className="localeContextPanel__prose">{terrainHint}</p>
                    </section>
                  ) : null}
                  {!tileDescription && !tileInfo && !terrainHint ? (
                    <p className="localeContextPanel__prose localeContextPanel__muted">
                      No extra details for this tile yet.
                    </p>
                  ) : null}
                </div>
                {showMapCellActionFooter ? (
                  <div className="localeContextPanel__footer">
                    <div className="localeContextPanel__actions">
                      {!atPlayer ? (
                        selectedTile.passable ? (
                          <button
                            type="button"
                            disabled={!canWalkTo}
                            title={
                              canWalkTo
                                ? "Walk along the path to this cell"
                                : "No walkable path from your position"
                            }
                            onClick={() => {
                              if (!regionSelection) return;
                              void worldNarrator.submitPlayerIntent({
                                kind: "region.travelTo",
                                x: regionSelection.x,
                                y: regionSelection.y,
                              });
                            }}
                          >
                            Go here
                          </button>
                        ) : (
                          <span className="localeContextPanel__prose localeContextPanel__small">
                            This tile is impassable.
                          </span>
                        )
                      ) : null}
                      {canEnterTile && selectedTile?.locationId ? (
                        <button
                          type="button"
                          onClick={() => {
                            void worldNarrator.submitPlayerIntent({
                              kind: "region.enterLocation",
                              locationId: selectedTile.locationId!,
                            });
                          }}
                        >
                          Enter
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="localeContextPanel__scroll">
                <h2 className="localeContextPanel__title">
                  Region <small>{regionName}</small>
                </h2>
                <p className="localeContextPanel__prose">
                  {region?.basicInfo?.trim() || "(no prose authored)"}
                </p>
              </div>
            )}
          </>
        ) : null}

        {activeTab === "location" && showLocationTab && location ? (
          <div className="localeContextPanel__scroll">
            <h2 className="localeContextPanel__title">
              Location <small>{locationName}</small>
            </h2>
            {currentLocationId ? (
              <p className="localeContextPanel__meta">{currentLocationId}</p>
            ) : null}
            {locationAreaText ? (
              <section className="localeContextPanel__section">
                <h3 className="localeContextPanel__sectionLabel">Description</h3>
                <p className="localeContextPanel__prose">{locationAreaText}</p>
              </section>
            ) : null}
            {location.basicInfo?.trim() ? (
              <section className="localeContextPanel__section">
                <h3 className="localeContextPanel__sectionLabel">Info</h3>
                <p className="localeContextPanel__prose">{location.basicInfo.trim()}</p>
              </section>
            ) : null}
            {!locationAreaText && !location.basicInfo?.trim() ? (
              <p className="localeContextPanel__prose localeContextPanel__muted">
                No location prose authored yet.
              </p>
            ) : null}
          </div>
        ) : null}

        {activeTab === "scene" && showSceneTab && currentSceneTile ? (
          <div className="localeContextPanel__scroll">
            <h2 className="localeContextPanel__title">
              Scene <small>{currentSceneTile.label ?? currentSceneTile.kind}</small>
            </h2>
            <p className="localeContextPanel__meta">
              {locationName ? `${locationName} · ` : ""}tile ({currentSceneTile.x},
              {currentSceneTile.y})
            </p>
            {underlyingSceneTile ? (
              <section className="localeContextPanel__section">
                <h3 className="localeContextPanel__sectionLabel">This spot</h3>
                <p className="localeContextPanel__prose">
                  {[underlyingSceneTile.label, underlyingSceneTile.kind]
                    .filter(Boolean)
                    .join(" · ")}
                  {underlyingSceneTile.dangerous ? " · Hazardous." : ""}
                </p>
              </section>
            ) : null}
            {location?.basicInfo?.trim() ? (
              <section className="localeContextPanel__section">
                <h3 className="localeContextPanel__sectionLabel">Location</h3>
                <p className="localeContextPanel__prose">{location.basicInfo.trim()}</p>
              </section>
            ) : null}
            {characters.length + parties.length > 0 ? (
              <section className="localeContextPanel__section">
                <h3 className="localeContextPanel__sectionLabel">Present</h3>
                <ul className="localeContextPanel__list">
                  {[...characters, ...parties].map((g) => (
                    <li key={g.id}>
                      <strong>{g.name}</strong>
                      {g.summary ? (
                        <div className="localeContextPanel__listSub">{g.summary}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="localeContextPanel__prose localeContextPanel__muted">
                No one else in view.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
