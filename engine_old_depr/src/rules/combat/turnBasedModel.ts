import type { DeterministicRng } from "../../rng/rng";
import type { CombatAction, CombatState, TickModel } from "./tickModel";

function abilityRoll(rng: DeterministicRng, bonus: number): number {
  return rng.int(1, 20) + bonus;
}

export const turnBasedModel: TickModel = {
  id: "turn-based",
  step(state: CombatState, action: CombatAction, rng: DeterministicRng): CombatState {
    if (action.kind === "wait") {
      return {
        ...state,
        turn: state.turn + 1,
        log: [...state.log, `${action.sourceId} waits.`],
      };
    }

    const source = state.actors.find((actor) => actor.id === action.sourceId);
    const target = state.actors.find((actor) => actor.id === action.targetId);
    if (!source || !target) {
      return state;
    }

    const roll = abilityRoll(rng, action.bonus);
    const actors = state.actors.map((actor) => ({ ...actor }));
    const targetActor = actors.find((actor) => actor.id === target.id);
    const hit = roll >= target.ac;

    let logLine: string;
    if (hit && targetActor) {
      targetActor.hp = Math.max(0, targetActor.hp - action.damage);
      logLine = `${source.name} hits ${target.name} for ${action.damage}.`;
    } else {
      logLine = `${source.name} misses ${target.name}.`;
    }

    return {
      turn: state.turn + 1,
      actors,
      log: [...state.log, logLine],
    };
  },
};
