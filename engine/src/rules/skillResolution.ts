import { z } from "zod";
import { LlmAdapter } from "../llm/adapter";
import type { WorldData } from "../schema/worldSchema";
import { buildSystemPrompt } from "../llm/promptBuilder";
import { ENGINE_PROMPTS } from "../llm/systemPrompts";

const SkillResolutionSchema = z.object({
  outcome: z.enum(["success", "fail", "partial"]),
  narration: z.string(),
  side_effects: z.array(z.record(z.string(), z.unknown())).default([]),
});

export async function resolveSkillCheck(
  adapter: LlmAdapter,
  world: WorldData,
  skill: string,
  difficulty: number,
  stake: string,
  context: string,
) {
  const response = await adapter.complete(
    {
      system: buildSystemPrompt({
        world,
        operation: "skill.check",
        engineHeader: ENGINE_PROMPTS.skillCheck(),
      }),
      messages: [
        {
          role: "user",
          content: `Skill: ${skill}\nDifficulty: ${difficulty}\nStake: ${stake}\nContext: ${context}`,
        },
      ],
      jsonMode: true,
    },
    { kind: "skill-check" },
  );
  const parsed = SkillResolutionSchema.parse(JSON.parse(response.text) as unknown);
  return parsed;
}
