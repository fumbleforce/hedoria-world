import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { IndexedWorld } from "../world/indexer";
import type { EngagementGroup, SceneTileState } from "../state/store";
import type { TileGrid } from "../grid/tilePrimitives";
import { getTile } from "../grid/tilePrimitives";
import type { TileImageCache } from "../grid/tileImageCache";
import type { SceneBackgroundCache } from "../scene/sceneBackgroundCache";
import {
  computeSceneRoomLayout,
  SCENE_ROOM_COLS,
  SCENE_ROOM_ROWS,
} from "../scene/sceneRoomLayout";
import { useStore } from "../state/store";
import type { WorldNpc } from "../schema/worldSchema";

type Props = {
  world: IndexedWorld;
  sortedGroups: EngagementGroup[];
  sceneBackgroundCache: SceneBackgroundCache;
  tileImageCache: TileImageCache;
  locationGrid: TileGrid | null;
  sceneTile: SceneTileState;
  currentLocationId: string;
};

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
}

function portraitDisplay(npc: WorldNpc | undefined): {
  url: string | null;
  initials: string;
  name: string;
} {
  const name = npc?.name?.trim() || "";
  const portrait = npc?.portrait?.trim();
  const url =
    portrait && (portrait.startsWith("http") || portrait.startsWith("data:"))
      ? portrait
      : null;
  return { url, initials: initialsFromName(name || "?"), name };
}

export function SceneRoomPanel({
  world,
  sortedGroups,
  sceneBackgroundCache,
  tileImageCache,
  locationGrid,
  sceneTile,
  currentLocationId,
}: Props) {
  const characterPortrait = useStore((s) => s.character?.portraitDataUrl);
  const characterName = useStore((s) => s.character?.name);

  const layout = useMemo(
    () => computeSceneRoomLayout(sortedGroups),
    [sortedGroups],
  );

  const location = world.locations[currentLocationId];
  const locationName = location?.name ?? currentLocationId;
  const locationBrief = location?.basicInfo ?? "";

  const bgRequest = useMemo(
    () => ({
      locationId: currentLocationId,
      locationName,
      locationBrief,
      tileX: sceneTile.x,
      tileY: sceneTile.y,
      tileKind: sceneTile.kind,
      tileLabel: sceneTile.label,
    }),
    [
      currentLocationId,
      locationBrief,
      locationName,
      sceneTile.kind,
      sceneTile.label,
      sceneTile.x,
      sceneTile.y,
    ],
  );

  const [, forceBgTick] = useState(0);

  useEffect(() => {
    const unsub = sceneBackgroundCache.subscribe(() => forceBgTick((n) => n + 1));
    void sceneBackgroundCache
      .getUrl(bgRequest)
      .catch(() => null)
      .finally(() => {
        forceBgTick((n) => n + 1);
      });
    return unsub;
  }, [sceneBackgroundCache, bgRequest]);

  const bgUrl = sceneBackgroundCache.peek(bgRequest);

  const underlyingTile = useMemo(() => {
    if (!locationGrid) return null;
    return getTile(locationGrid, sceneTile.x, sceneTile.y);
  }, [locationGrid, sceneTile.x, sceneTile.y]);

  const tilePeekUrl =
    underlyingTile && locationGrid
      ? tileImageCache.peekTile(locationGrid, sceneTile.x, sceneTile.y, underlyingTile)
      : null;

  const groupsById = useMemo(() => {
    const m = new Map<string, EngagementGroup>();
    for (const g of sortedGroups) {
      m.set(g.id, g);
    }
    return m;
  }, [sortedGroups]);

  const cells: ReactNode[] = [];
  for (let row = 0; row < SCENE_ROOM_ROWS; row += 1) {
    for (let col = 0; col < SCENE_ROOM_COLS; col += 1) {
      const key = `c-${col}-${row}`;
      if (col === layout.playerCol && row === layout.playerRow) {
        cells.push(
          <div key={key} className="sceneRoomPanel__cell sceneRoomPanel__cell--player">
            <div
              className={
                characterPortrait
                  ? "sceneRoomPanel__disc sceneRoomPanel__disc--withImage"
                  : "sceneRoomPanel__disc"
              }
              style={
                characterPortrait
                  ? {
                      backgroundImage: `url("${characterPortrait}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
              aria-label={characterName ? `${characterName} (you)` : "You"}
            >
              {!characterPortrait ? (
                <svg
                  className="sceneRoomPanel__discGlyph"
                  viewBox="0 0 32 32"
                  aria-hidden="true"
                >
                  <circle cx="16" cy="12" r="5" />
                  <path d="M6 28 C 6 20, 26 20, 26 28 Z" />
                </svg>
              ) : null}
            </div>
            <span className="sceneRoomPanel__cellLabel">You</span>
          </div>,
        );
        continue;
      }

      const placement = layout.placements.find((p) => p.col === col && p.row === row);
      if (!placement) {
        cells.push(<div key={key} className="sceneRoomPanel__cell sceneRoomPanel__cell--empty" />);
        continue;
      }

      const group = groupsById.get(placement.groupId);
      if (!group) {
        cells.push(<div key={key} className="sceneRoomPanel__cell sceneRoomPanel__cell--empty" />);
        continue;
      }

      cells.push(
        <div key={key} className="sceneRoomPanel__cell sceneRoomPanel__cell--npc">
          <GroupFaces world={world} group={group} />
          <span className="sceneRoomPanel__cellLabel">{group.name}</span>
        </div>,
      );
    }
  }

  /** Generated scene plate, else location tile art from the map cache. */
  const displayBgUrl = bgUrl ?? tilePeekUrl;
  const bgQuoted = displayBgUrl
    ? `url("${displayBgUrl.replace(/"/g, '\\"')}")`
    : undefined;

  return (
    <div className="sceneRoomPanel">
      <div
        className={
          bgQuoted ? "sceneRoomPanel__backdrop" : "sceneRoomPanel__backdrop sceneRoomPanel__backdrop--placeholder"
        }
        style={{
          backgroundImage: bgQuoted,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="sceneRoomPanel__portraitGridWrap">
        <div
          className="sceneRoomPanel__portraitGrid"
          style={{
            gridTemplateColumns: `repeat(${SCENE_ROOM_COLS}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${SCENE_ROOM_ROWS}, minmax(0, 1fr))`,
          }}
        >
          {cells}
        </div>
      </div>
    </div>
  );
}

function GroupFaces({
  world,
  group,
}: {
  world: IndexedWorld;
  group: EngagementGroup;
}) {
  const ids = group.npcIds.slice(0, 3);
  if (ids.length === 0) {
    return (
      <div className="sceneRoomPanel__crowdGlyph" aria-hidden="true">
        ···
      </div>
    );
  }

  return (
    <div
      className={
        ids.length > 1
          ? "sceneRoomPanel__faceStack sceneRoomPanel__faceStack--many"
          : "sceneRoomPanel__faceStack"
      }
    >
      {ids.map((id) => {
        const npc = world.world.npcs[id];
        const { url, initials } = portraitDisplay(npc);
        return (
          <div
            key={id}
            className={
              url ? "sceneRoomPanel__disc sceneRoomPanel__disc--small sceneRoomPanel__disc--withImage" : "sceneRoomPanel__disc sceneRoomPanel__disc--small"
            }
            style={
              url
                ? {
                    backgroundImage: `url("${url.replace(/"/g, '\\"')}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          >
            {!url ? <span className="sceneRoomPanel__initials">{initials}</span> : null}
          </div>
        );
      })}
    </div>
  );
}
