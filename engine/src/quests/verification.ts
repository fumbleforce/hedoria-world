import { z } from "zod";
import { LlmAdapter } from "../llm/adapter";
import type { WorldData } from "../schema/worldSchema";
import { buildSystemPrompt } from "../llm/promptBuilder";
import { MECHANICS_ENGINE_PROMPTS } from "../llm/mechanicsEnginePrompts";

const VerificationSchema = z.object({
  complete: z.boolean(),
  reason: z.string(),
});

export async function verifyQuestCompletion(
  adapter: LlmAdapter,
  world: WorldData,
  completionCondition: string,
  evidence: string,
): Promise<{ complete: boolean; reason: string }> {
  const response = await adapter.complete(
    {
      system: buildSystemPrompt({
        world,
        operation: "quest.verify",
        engineHeader: MECHANICS_ENGINE_PROMPTS.questVerify(),
      }),
      messages: [
        {
          role: "user",
          content: `Completion condition: ${completionCondition}\nEvidence: ${evidence}`,
        },
      ],
      jsonMode: true,
    },
    { kind: "quest-verify" },
  );
  return VerificationSchema.parse(JSON.parse(response.text) as unknown);
}
