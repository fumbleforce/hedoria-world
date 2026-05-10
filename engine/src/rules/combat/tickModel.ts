import type { DeterministicRng } from "../../rng/rng";

export type CombatActor = {
  id: string;
  name: string;
  hp: number;
  hpMax: number;
  ac: number;
  tier: string;
  npcType?: string;
};

export type CombatState = {
  turn: number;
  actors: CombatActor[];
  log: string[];
};

export type CombatAction =
  | { kind: "attack"; sourceId: string; targetId: string; bonus: number; damage: number }
  | { kind: "wait"; sourceId: string };

export interface TickModel {
  readonly id: "turn-based" | "rtwp";
  step(state: CombatState, action: CombatAction, rng: DeterministicRng): CombatState;
}
