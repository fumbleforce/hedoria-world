import { z } from "zod";
import { LlmAdapter } from "../llm/adapter";

const VerificationSchema = z.object({
  complete: z.boolean(),
  reason: z.string(),
});

export async function verifyQuestCompletion(
  adapter: LlmAdapter,
  completionCondition: string,
  evidence: string,
): Promise<{ complete: boolean; reason: string }> {
  const response = await adapter.complete({
    system:
      "Validate whether the evidence satisfies the completion condition. Return strict JSON {complete, reason}.",
    messages: [
      {
        role: "user",
        content: `Completion condition: ${completionCondition}\nEvidence: ${evidence}`,
      },
    ],
    jsonMode: true,
  });
  return VerificationSchema.parse(JSON.parse(response.text) as unknown);
}
