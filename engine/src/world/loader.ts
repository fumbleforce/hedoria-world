import { WorldSchema, type WorldData } from "../schema/worldSchema";

export type LoaderDiagnostics = {
  warnings: string[];
  errors: string[];
  enumValues: Record<string, string[]>;
};

export type LoadedWorld = {
  data: WorldData;
  diagnostics: LoaderDiagnostics;
};

const enumTrackerFields = [
  {
    key: "locations.detailType",
    getter: (world: WorldData) =>
      Object.values(world.locations).map((l) => l.detailType),
  },
  {
    key: "locations.complexityType",
    getter: (world: WorldData) =>
      Object.values(world.locations).map((l) => l.complexityType),
  },
  {
    key: "npcs.tier",
    getter: (world: WorldData) => Object.values(world.npcs).map((n) => n.tier),
  },
];

export function validateWorld(raw: unknown): LoadedWorld {
  const warnings: string[] = [];
  const errors: string[] = [];
  const parsed = WorldSchema.safeParse(raw);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    throw new Error(`World validation failed:\n${errors.join("\n")}`);
  }

  const data = parsed.data;
  const enumValues: Record<string, string[]> = {};
  for (const field of enumTrackerFields) {
    enumValues[field.key] = [...new Set(field.getter(data))].sort();
  }

  for (const [id, npc] of Object.entries(data.npcs)) {
    if (npc.faction && !data.factions[npc.faction]) {
      warnings.push(`dangling npc faction ref: npcs.${id}.faction -> ${npc.faction}`);
    }
    if (npc.currentLocation && !data.locations[npc.currentLocation]) {
      warnings.push(
        `dangling npc location ref: npcs.${id}.currentLocation -> ${npc.currentLocation}`,
      );
    }
    if (npc.type && !data.npcTypes[npc.type]) {
      warnings.push(`dangling npc type ref: npcs.${id}.type -> ${npc.type}`);
    }
  }

  for (const [id, quest] of Object.entries(data.quests)) {
    if (quest.questGiverNPC && !data.npcs[quest.questGiverNPC]) {
      warnings.push(
        `dangling quest giver ref: quests.${id}.questGiverNPC -> ${quest.questGiverNPC}`,
      );
    }
    if (quest.questLocation && !data.locations[quest.questLocation]) {
      warnings.push(
        `dangling quest location ref: quests.${id}.questLocation -> ${quest.questLocation}`,
      );
    }
  }

  return { data, diagnostics: { warnings, errors, enumValues } };
}

/**
 * Fetches a world JSON from an arbitrary URL and validates it. The two
 * pack-aware helpers below are the preferred entry points; this exists
 * for direct use against `/config.json` (legacy) or test fixtures.
 */
export async function loadWorldFromUrl(
  url: string = "/config.json",
): Promise<LoadedWorld> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch world from ${url} (${response.status})`);
  }
  const json = await response.json();
  return validateWorld(json);
}

/**
 * Lightweight summary of a pack served by `GET /__packs`. The engine
 * uses these to populate the world-selector dropdown and to choose a
 * sensible default at boot.
 */
export type PackInfo = {
  packId: string;
  packName: string;
  schemaVersion: string | null;
  engineCompatibility: string | null;
  seed: string | null;
};

/**
 * Discover every pack under `/packs/<id>/manifest.json`. The list is
 * always sorted by `packId` server-side; we just surface the result.
 */
export async function loadPacks(): Promise<PackInfo[]> {
  const response = await fetch("/__packs", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to list packs (${response.status})`);
  }
  const body = (await response.json()) as { packs: PackInfo[] };
  return body.packs ?? [];
}

/**
 * Load and validate the source config for a specific pack. The Vite
 * dev plugin resolves the manifest's `sourceConfig` path on the
 * server side so the client never needs to know the on-disk layout.
 */
export async function loadWorldFromPack(packId: string): Promise<LoadedWorld> {
  return loadWorldFromUrl(`/__pack/${encodeURIComponent(packId)}`);
}
