import { z } from "zod";
import { LlmAdapter } from "../llm/adapter";

const SkillResolutionSchema = z.object({
  outcome: z.enum(["success", "fail", "partial"]),
  narration: z.string(),
  side_effects: z.array(z.record(z.string(), z.unknown())).default([]),
});

export async function resolveSkillCheck(
  adapter: LlmAdapter,
  skill: string,
  difficulty: number,
  stake: string,
  context: string,
) {
  const response = await adapter.complete({
    system:
      "Resolve the skill check and return strict JSON {outcome, narration, side_effects}.",
    messages: [
      {
        role: "user",
        content: `Skill: ${skill}\nDifficulty: ${difficulty}\nStake: ${stake}\nContext: ${context}`,
      },
    ],
    jsonMode: true,
  });
  const parsed = SkillResolutionSchema.parse(JSON.parse(response.text) as unknown);
  return parsed;
}
