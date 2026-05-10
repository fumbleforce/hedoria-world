import type { QuestMarker } from "../grid/tilePrimitives";
import type { WorldQuest } from "../schema/worldSchema";

/**
 * Engine-level recipes for how each quest archetype manifests in the
 * world. The recipe answers two questions:
 *
 *   1. How many tiles should the populator overlay with QuestMarker, and
 *      what role/params does each marker carry? — `markersFor`.
 *   2. When does an objective tick happen, and by how much? — `tickFor`.
 *
 * The actual *narration* of the quest happens in the LLM-driven scene
 * runner; archetypes don't dictate kinds or labels (the populator chose
 * those at filler time). This keeps the engine and the LLM in their
 * respective lanes.
 */

export type Archetype = NonNullable<WorldQuest["archetype"]>;

export type ArchetypeMarker = {
  marker: QuestMarker;
  /**
   * Soft hint for the populator about which kinds make narrative sense
   * for this marker. Empty array means "any passable tile".
   */
  preferredKindHints: string[];
};

/**
 * Decide how many markers to spawn and what role each one plays. The
 * populator then picks tiles that match `preferredKindHints` first,
 * falling back to any passable tile.
 */
export function markersFor(quest: WorldQuest, questId: string): ArchetypeMarker[] {
  const archetype = quest.archetype;
  if (!archetype) return [];
  const params = quest.archetypeParams ?? {};
  const count = numberFrom(params.count, 1);

  switch (archetype) {
    case "kill": {
      const monster = stringFrom(params.monsterType, "hostile");
      return repeat(count, () => ({
        marker: {
          questId,
          role: "monster",
          params: {
            monsterType: monster,
            count: 1,
            remaining: 1,
            hint: `home to a ${monster}`,
          },
        },
        preferredKindHints: kindHintsForMonster(monster),
      }));
    }
    case "fetch": {
      const item = stringFrom(params.itemId, "trinket");
      return repeat(count, () => ({
        marker: {
          questId,
          role: "item",
          params: {
            itemId: item,
            count: 1,
            remaining: 1,
            hint: `where a ${item} might be found`,
          },
        },
        preferredKindHints: ["abandoned", "ruin", "shrine", "cache", "lair"],
      }));
    }
    case "clear": {
      return [
        {
          marker: {
            questId,
            role: "target",
            params: {
              count,
              remaining: count,
              hint: "stronghold of the threat",
            },
          },
          preferredKindHints: ["camp", "lair", "ruin", "outpost"],
        },
      ];
    }
    case "escort": {
      return [
        {
          marker: {
            questId,
            role: "target",
            params: {
              hint: "destination for the escort",
            },
          },
          // Escort target should be a location-anchor — populator special-cases this.
          preferredKindHints: ["__anchor__"],
        },
      ];
    }
    case "delivery": {
      return [
        {
          marker: {
            questId,
            role: "target",
            params: {
              hint: "delivery destination",
            },
          },
          preferredKindHints: ["__anchor__"],
        },
      ];
    }
    case "investigate": {
      return repeat(Math.max(1, count), (i) => ({
        marker: {
          questId,
          role: "objective",
          params: {
            count: i + 1,
            hint: "place worth investigating",
          },
        },
        preferredKindHints: ["ruin", "shrine", "cairn", "lair"],
      }));
    }
  }
}

/**
 * How a successful tick (combat-victory, item-pickup, cell-entered, etc.)
 * affects the matching quest objective. Returned `delta` is signed so
 * giving items back can negate progress.
 */
export type ArchetypeTickReason =
  | { kind: "monster-defeated"; questId: string; cellMarker: QuestMarker }
  | { kind: "item-acquired"; questId: string; itemId: string; cellMarker: QuestMarker }
  | { kind: "cell-entered"; questId: string; cellMarker: QuestMarker }
  | { kind: "delivered"; questId: string; cellMarker: QuestMarker };

export type ArchetypeTick = {
  questId: string;
  /** Objective key under `questProgress[questId][key]`. */
  key: string;
  delta: number;
};

export function tickFor(reason: ArchetypeTickReason): ArchetypeTick | null {
  switch (reason.kind) {
    case "monster-defeated":
      return { questId: reason.questId, key: "killed", delta: 1 };
    case "item-acquired":
      return { questId: reason.questId, key: "collected", delta: 1 };
    case "cell-entered":
      return { questId: reason.questId, key: "investigated", delta: 1 };
    case "delivered":
      return { questId: reason.questId, key: "delivered", delta: 1 };
  }
}

/**
 * Whether the totals stored in `questProgress[questId]` satisfy the
 * archetype's completion condition. Used by the dispatcher (not yet
 * wired into auto-complete; the LLM still decides when to call
 * `complete_quest`, but it can use this hint).
 */
export function isComplete(
  archetype: Archetype | undefined,
  params: Record<string, unknown>,
  progress: Record<string, number>,
): boolean {
  if (!archetype) return false;
  const target = numberFrom(params.count, 1);
  switch (archetype) {
    case "kill":
      return (progress.killed ?? 0) >= target;
    case "fetch":
      return (progress.collected ?? 0) >= target;
    case "clear":
      return (progress.killed ?? 0) >= target;
    case "investigate":
      return (progress.investigated ?? 0) >= target;
    case "escort":
    case "delivery":
      return (progress.delivered ?? 0) >= 1;
  }
}

// ---------------------------------------------------------------- helpers

function numberFrom(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function stringFrom(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function repeat<T>(n: number, fn: (i: number) => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(0, n); i += 1) out.push(fn(i));
  return out;
}

/**
 * Quick-and-dirty mapping from monster type to plausible tile kinds the
 * filler is likely to have produced. Intentionally short — the populator
 * falls back to "any passable tile" if no hint matches.
 */
function kindHintsForMonster(monster: string): string[] {
  const m = monster.toLowerCase();
  if (m.includes("boar") || m.includes("wolf") || m.includes("deer")) {
    return ["forest", "thicket", "grove", "meadow", "marsh"];
  }
  if (m.includes("bandit") || m.includes("brigand") || m.includes("raider")) {
    return ["camp", "ruin", "wayside", "crossroads"];
  }
  if (m.includes("undead") || m.includes("skeleton") || m.includes("wraith")) {
    return ["ruin", "barrow", "cairn", "graveyard", "crypt"];
  }
  if (m.includes("rat") || m.includes("vermin")) {
    return ["cellar", "sewer", "warehouse"];
  }
  return [];
}
