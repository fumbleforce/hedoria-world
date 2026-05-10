import { PackSchema, type PackData } from "../schema/packSchema";

export type LoaderDiagnostics = {
  warnings: string[];
  errors: string[];
  enumValues: Record<string, string[]>;
};

export type LoadedPack = {
  data: PackData;
  diagnostics: LoaderDiagnostics;
};

const enumTrackerFields = [
  { key: "locations.detailType", getter: (pack: PackData) => Object.values(pack.locations).map((l) => l.detailType) },
  { key: "locations.complexityType", getter: (pack: PackData) => Object.values(pack.locations).map((l) => l.complexityType) },
  { key: "npcs.tier", getter: (pack: PackData) => Object.values(pack.npcs).map((n) => n.tier) },
];

export function validatePack(raw: unknown): LoadedPack {
  const warnings: string[] = [];
  const errors: string[] = [];
  const parsed = PackSchema.safeParse(raw);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    throw new Error(`Pack validation failed:\n${errors.join("\n")}`);
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
      warnings.push(`dangling quest giver ref: quests.${id}.questGiverNPC -> ${quest.questGiverNPC}`);
    }
    if (quest.questLocation && !data.locations[quest.questLocation]) {
      warnings.push(
        `dangling quest location ref: quests.${id}.questLocation -> ${quest.questLocation}`,
      );
    }
  }

  return { data, diagnostics: { warnings, errors, enumValues } };
}

export async function loadPackFromUrl(url: string): Promise<LoadedPack> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch pack from ${url} (${response.status})`);
  }
  const json = await response.json();
  return validatePack(json);
}
