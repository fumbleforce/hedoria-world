import { z } from "zod";
import { LlmAdapter } from "../llm/adapter";
import { putExpansionEntity } from "../persist/saveLoad";
import type { PackData } from "../schema/packSchema";
import type { ExpansionEntityRow, ExpansionEntityType } from "../world/indexer";
import { enforceNameFilter } from "./nameFilter";

const ExpansionOutputSchema = z.object({
  entityType: z.enum(["npc", "npcType", "region", "location", "faction", "item"]),
  entityId: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export type ExpansionTrigger =
  | { kind: "frontier"; source: string }
  | { kind: "reference"; source: string }
  | { kind: "deepening"; source: string }
  | { kind: "bestiary-growth"; source: string };

function promptForTrigger(trigger: ExpansionTrigger): string {
  if (trigger.kind === "frontier") {
    return `Generate one nearby region or location connected to ${trigger.source}.`;
  }
  if (trigger.kind === "reference") {
    return `Generate the missing referenced entity: ${trigger.source}.`;
  }
  if (trigger.kind === "deepening") {
    return `Deepen the existing NPC ${trigger.source} with missing fields.`;
  }
  return `Generate a biome-fitting npcType for ${trigger.source}.`;
}

export async function runExpansion(
  adapter: LlmAdapter,
  trigger: ExpansionTrigger,
  saveId: string,
  pack: PackData,
): Promise<ExpansionEntityRow | null> {
  const response = await adapter.complete({
    system: "Return strict JSON with entityType, entityId, and data. Keep references in-pack.",
    messages: [{ role: "user", content: promptForTrigger(trigger) }],
    jsonMode: true,
  });

  let parsed: z.infer<typeof ExpansionOutputSchema>;
  try {
    parsed = ExpansionOutputSchema.parse(JSON.parse(response.text) as unknown);
  } catch {
    return null;
  }

  if (parsed.entityType === "npc" && typeof parsed.data.name === "string") {
    parsed.data.name = enforceNameFilter(
      parsed.data.name,
      `${trigger.kind}:${parsed.entityId}`,
      pack,
    );
  }

  const row: ExpansionEntityRow = {
    saveId,
    entityType: parsed.entityType as ExpansionEntityType,
    entityId: parsed.entityId,
    data: parsed.data,
    _source: "expansion",
    _provenance: {
      generatedAt: new Date().toISOString(),
      model: "adapter",
      promptHash: `${trigger.kind}:${parsed.entityId}`,
      parentTrigger: trigger.kind,
    },
  };
  await putExpansionEntity(row);
  return row;
}
