import type { WorldData } from "../schema/worldSchema";

function stringifyInstruction(block: unknown): string {
  if (typeof block === "string") return block;
  if (block && typeof block === "object") return JSON.stringify(block, null, 2);
  return "";
}

export function buildSystemPrompt(
  world: WorldData,
  operation: string,
  context = "",
): string {
  const worldBackground =
    typeof world.storyStarts?.Random === "object"
      ? JSON.stringify(world.storyStarts.Random)
      : "";
  const instruction = stringifyInstruction(world.aiInstructions[operation] ?? {});
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
