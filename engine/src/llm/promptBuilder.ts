import type { WorldData } from "../schema/worldSchema";

export type PromptOperation =
  | "story.traversal"
  | "story.scene"
  | "tile.region"
  | "tile.location"
  | "skill.check"
  | "quest.verify"
  | "death.recovery";

const OPERATION_TO_INSTRUCTIONS: Record<
  PromptOperation,
  { blocks: string[]; appendNarratorStyle: boolean }
> = {
  "story.traversal": { blocks: ["generateStory"], appendNarratorStyle: true },
  "story.scene": {
    blocks: ["generateStory", "generateNPCIntents", "ItemGenerationAndUsage"],
    appendNarratorStyle: true,
  },
  "tile.region": {
    blocks: ["generateRegionDetails"],
    appendNarratorStyle: false,
  },
  "tile.location": {
    blocks: ["generateLocationDetails"],
    appendNarratorStyle: false,
  },
  "skill.check": { blocks: ["generateActionInfo"], appendNarratorStyle: false },
  "quest.verify": { blocks: [], appendNarratorStyle: false },
  "death.recovery": { blocks: ["generateStory"], appendNarratorStyle: true },
};

function flattenInstructionBlock(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return JSON.stringify(raw, null, 2);
  }
  const entries = Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const parts: string[] = [];
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t) parts.push(`### ${k}\n${t}`);
    } else if (typeof v === "object" && !Array.isArray(v)) {
      const nested = flattenInstructionBlock(v);
      if (nested) parts.push(`### ${k}\n${nested}`);
    } else {
      parts.push(`### ${k}\n${JSON.stringify(v, null, 2)}`);
    }
  }
  return parts.join("\n\n");
}

export function buildSystemPrompt(args: {
  world: WorldData;
  operation: PromptOperation;
  engineHeader: string;
  extraTail?: string;
}): string {
  const { world, operation, engineHeader, extraTail } = args;
  const meta = OPERATION_TO_INSTRUCTIONS[operation];
  const sections: string[] = [engineHeader.trimEnd()];

  for (const block of meta.blocks) {
    const raw = world.aiInstructions[block];
    if (raw === undefined || raw === null) continue;
    const body = flattenInstructionBlock(raw);
    if (!body) continue;
    sections.push(`## World guidance: ${block}\n\n${body}`);
  }

  if (meta.appendNarratorStyle) {
    const ns = world.narratorStyle?.trim();
    if (ns) {
      sections.push(`## Narrator Style\n\n${ns}`);
    }
  }

  if (extraTail?.trim()) {
    sections.push(extraTail.trimEnd());
  }

  return sections.filter(Boolean).join("\n\n");
}
