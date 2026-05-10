import type { PackData } from "../schema/packSchema";
import { LlmAdapter } from "../llm/adapter";

export type RecoveryResult = {
  narration: string;
  restoredHealth: boolean;
  transportLocation: string | null;
  debuff: { id: string; durationDays: number };
};

export async function resolveDeathRecovery(
  adapter: LlmAdapter,
  pack: PackData,
  encounterSummary: string,
): Promise<RecoveryResult> {
  const knownLocations = Object.entries(pack.locations)
    .filter(([, loc]) => loc.known)
    .map(([id]) => id);

  const transportLocation = knownLocations[0] ?? null;
  const response = await adapter.complete(
    {
      system: pack.death.instructions || "Narrate defeat and recovery.",
      messages: [{ role: "user", content: encounterSummary }],
    },
    { kind: "death-recovery" },
  );
  return {
    narration: response.text,
    restoredHealth: !pack.death.permadeath,
    transportLocation,
    debuff: { id: "recently-broken", durationDays: 3 },
  };
}
