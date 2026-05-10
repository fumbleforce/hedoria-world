import type { PackData, PackLocation, PackNpc } from "../schema/packSchema";

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
  pack: PackData;
  npcsByLocation: Map<string, PackNpc[]>;
  npcsByArea: Map<string, PackNpc[]>;
  areaGraph: Map<string, Map<string, string[]>>;
  factionsById: Map<string, { name: string; basicInfo?: string }>;
  abilitiesById: Map<string, unknown>;
  itemsById: Map<string, unknown>;
  regionsByXY: Array<{ id: string; x: number; y: number }>;
  locations: Record<string, PackLocation>;
};

function upsertMergedPack(base: PackData, expansionRows: ExpansionEntityRow[]): PackData {
  const merged: PackData = structuredClone(base);

  for (const row of expansionRows) {
    if (row.entityType === "npc") {
      merged.npcs[row.entityId] = row.data as PackData["npcs"][string];
    } else if (row.entityType === "npcType") {
      merged.npcTypes[row.entityId] = row.data as PackData["npcTypes"][string];
    } else if (row.entityType === "region") {
      merged.regions[row.entityId] = row.data as PackData["regions"][string];
    } else if (row.entityType === "location") {
      merged.locations[row.entityId] = row.data as PackData["locations"][string];
    } else if (row.entityType === "faction") {
      merged.factions[row.entityId] = row.data as PackData["factions"][string];
    } else if (row.entityType === "item") {
      merged.items[row.entityId] = row.data as PackData["items"][string];
    }
  }

  return merged;
}

export function buildWorldIndex(basePack: PackData, expansionRows: ExpansionEntityRow[]): IndexedWorld {
  const pack = upsertMergedPack(basePack, expansionRows);
  const npcsByLocation = new Map<string, PackNpc[]>();
  const npcsByArea = new Map<string, PackNpc[]>();
  const areaGraph = new Map<string, Map<string, string[]>>();

  for (const [id, npc] of Object.entries(pack.npcs)) {
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

  for (const [locationId, location] of Object.entries(pack.locations)) {
    const graph = new Map<string, string[]>();
    for (const [areaId, area] of Object.entries(location.areas ?? {})) {
      graph.set(areaId, [...area.paths]);
    }
    areaGraph.set(locationId, graph);
  }

  return {
    pack,
    npcsByLocation,
    npcsByArea,
    areaGraph,
    factionsById: new Map(Object.entries(pack.factions)),
    abilitiesById: new Map(Object.entries(pack.abilities)),
    itemsById: new Map(Object.entries(pack.items)),
    regionsByXY: Object.entries(pack.regions).map(([id, region]) => ({ id, x: region.x, y: region.y })),
    locations: pack.locations,
  };
}
