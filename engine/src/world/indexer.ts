import type {
  WorldData,
  WorldLocation,
  WorldNpc,
  WorldRegion,
} from "../schema/worldSchema";

export type ExpansionEntityType =
  | "npc"
  | "npcType"
  | "region"
  | "location"
  | "faction"
  | "item";

export type ExpansionEntityRow = {
  saveId: string;
  entityType: ExpansionEntityType;
  entityId: string;
  data: Record<string, unknown>;
  _source: "expansion";
  _provenance?: {
    generatedAt: string;
    model: string;
    promptHash: string;
    parentTrigger: string;
  };
};

export type IndexedWorld = {
  world: WorldData;
  npcsByLocation: Map<string, WorldNpc[]>;
  npcsByArea: Map<string, WorldNpc[]>;
  areaGraph: Map<string, Map<string, string[]>>;
  factionsById: Map<string, { name: string; basicInfo?: string }>;
  abilitiesById: Map<string, unknown>;
  itemsById: Map<string, unknown>;
  /** Locations grouped by their `region` string. Empty array if a region has none. */
  locationsByRegion: Map<string, Array<{ id: string; loc: WorldLocation }>>;
  regionsById: Record<string, WorldRegion>;
  locations: Record<string, WorldLocation>;
};

function upsertMergedWorld(
  base: WorldData,
  expansionRows: ExpansionEntityRow[],
): WorldData {
  const merged: WorldData = structuredClone(base);

  for (const row of expansionRows) {
    if (row.entityType === "npc") {
      merged.npcs[row.entityId] = row.data as WorldData["npcs"][string];
    } else if (row.entityType === "npcType") {
      merged.npcTypes[row.entityId] = row.data as WorldData["npcTypes"][string];
    } else if (row.entityType === "region") {
      merged.regions[row.entityId] = row.data as WorldData["regions"][string];
    } else if (row.entityType === "location") {
      merged.locations[row.entityId] = row.data as WorldData["locations"][string];
    } else if (row.entityType === "faction") {
      merged.factions[row.entityId] = row.data as WorldData["factions"][string];
    } else if (row.entityType === "item") {
      merged.items[row.entityId] = row.data as WorldData["items"][string];
    }
  }

  return merged;
}

export function buildWorldIndex(
  baseWorld: WorldData,
  expansionRows: ExpansionEntityRow[],
): IndexedWorld {
  const world = upsertMergedWorld(baseWorld, expansionRows);
  const npcsByLocation = new Map<string, WorldNpc[]>();
  const npcsByArea = new Map<string, WorldNpc[]>();
  const areaGraph = new Map<string, Map<string, string[]>>();

  for (const [id, npc] of Object.entries(world.npcs)) {
    if (!npc.currentLocation) continue;
    const locList = npcsByLocation.get(npc.currentLocation) ?? [];
    locList.push(npc);
    npcsByLocation.set(npc.currentLocation, locList);
    if (npc.currentArea) {
      const areaKey = `${npc.currentLocation}/${npc.currentArea}`;
      const areaList = npcsByArea.get(areaKey) ?? [];
      areaList.push(npc);
      npcsByArea.set(areaKey, areaList);
    }
    if (!npc.name) {
      npc.name = id;
    }
  }

  for (const [locationId, location] of Object.entries(world.locations)) {
    const graph = new Map<string, string[]>();
    for (const [areaId, area] of Object.entries(location.areas ?? {})) {
      graph.set(areaId, [...area.paths]);
    }
    areaGraph.set(locationId, graph);
  }

  const locationsByRegion = new Map<string, Array<{ id: string; loc: WorldLocation }>>();
  for (const [id, loc] of Object.entries(world.locations)) {
    const regionId = loc.region || "";
    if (!regionId) continue;
    const arr = locationsByRegion.get(regionId) ?? [];
    arr.push({ id, loc });
    locationsByRegion.set(regionId, arr);
  }

  return {
    world,
    npcsByLocation,
    npcsByArea,
    areaGraph,
    factionsById: new Map(Object.entries(world.factions)),
    abilitiesById: new Map(Object.entries(world.abilities)),
    itemsById: new Map(Object.entries(world.items)),
    locationsByRegion,
    regionsById: world.regions,
    locations: world.locations,
  };
}
