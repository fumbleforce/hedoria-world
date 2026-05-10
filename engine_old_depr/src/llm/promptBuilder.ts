import type { PackData } from "../schema/packSchema";

function stringifyInstruction(block: unknown): string {
  if (typeof block === "string") return block;
  if (block && typeof block === "object") return JSON.stringify(block, null, 2);
  return "";
}

export function buildSystemPrompt(pack: PackData, operation: string, context = ""): string {
  const worldBackground =
    typeof pack.storyStarts?.Random === "object"
      ? JSON.stringify(pack.storyStarts.Random)
      : "";
  const instruction = stringifyInstruction(pack.aiInstructions[operation] ?? {});
  return [
    "You are the narration and arbitration model for a deterministic RPG engine.",
    `Operation: ${operation}`,
    `World background: ${worldBackground}`,
    `Instruction block:\n${instruction}`,
    context ? `Context:\n${context}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
