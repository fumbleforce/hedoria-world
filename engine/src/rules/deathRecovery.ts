import type { WorldData } from "../schema/worldSchema";
import { LlmAdapter } from "../llm/adapter";
import { buildSystemPrompt } from "../llm/promptBuilder";
import { STORY_ENGINE_PROMPTS } from "../llm/storyEnginePrompts";

export type RecoveryResult = {
  narration: string;
  restoredHealth: boolean;
  transportLocation: string | null;
  debuff: { id: string; durationDays: number };
};

export async function resolveDeathRecovery(
  adapter: LlmAdapter,
  world: WorldData,
  encounterSummary: string,
): Promise<RecoveryResult> {
  const knownLocations = Object.entries(world.locations)
    .filter(([, loc]) => loc.known)
    .map(([id]) => id);

  const transportLocation = knownLocations[0] ?? null;
  const response = await adapter.complete(
    {
      system: buildSystemPrompt({
        world,
        operation: "death.recovery",
        engineHeader: STORY_ENGINE_PROMPTS.deathRecovery(),
        extraTail: world.death.instructions || undefined,
      }),
      messages: [{ role: "user", content: encounterSummary }],
    },
    { kind: "death-recovery" },
  );
  return {
    narration: response.text,
    restoredHealth: !world.death.permadeath,
    transportLocation,
    debuff: { id: "recently-broken", durationDays: 3 },
  };
}
