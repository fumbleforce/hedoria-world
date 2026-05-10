import { z } from "zod";
import { findTranscriptByPromptHash, putTranscript } from "../persist/saveLoad";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

const LlmResponseSchema = z.object({
  text: z.string().default(""),
  toolCalls: z.array(ToolCallSchema).optional(),
});

function hashPrompt(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

export class LlmAdapter {
  private readonly provider: LlmProvider;
  private readonly saveId: string;

  constructor(provider: LlmProvider, saveId: string) {
    this.provider = provider;
    this.saveId = saveId;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const promptBlob = JSON.stringify(request);
    const promptHash = hashPrompt(promptBlob);
    const cached = await findTranscriptByPromptHash(this.saveId, promptHash);
    if (cached) {
      const parsed = LlmResponseSchema.safeParse(JSON.parse(cached.response) as unknown);
      if (parsed.success) {
        return parsed.data;
      }
    }

    const raw = await this.provider.complete(request);
    const parsed = LlmResponseSchema.parse(raw);
    await putTranscript({
      saveId: this.saveId,
      callId: crypto.randomUUID(),
      promptHash,
      model: this.provider.id,
      prompt: promptBlob,
      response: JSON.stringify(parsed),
      generatedAt: Date.now(),
    });
    return parsed;
  }
}
