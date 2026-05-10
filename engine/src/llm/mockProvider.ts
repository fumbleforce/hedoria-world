import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

export class MockProvider implements LlmProvider {
  readonly id = "mock-local";

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (request.jsonMode) {
      return {
        text: JSON.stringify({
          entityType: "npc",
          entityId: "generated-scout",
          data: {
            name: "Kaelen Scout",
            type: "",
            currentLocation: "Red Harvest",
            currentArea: "Market Street",
            tier: "trivial",
            level: 1,
            hpMax: 80,
            abilities: ["Watchful Eye"],
            known: true,
          },
        }),
      };
    }
    return {
      text: `Mock response to: ${request.messages.at(-1)?.content ?? ""}`,
    };
  }
}
