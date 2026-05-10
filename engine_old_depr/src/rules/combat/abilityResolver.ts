import type { PackData } from "../../schema/packSchema";

export type ResolvedAbility =
  | { mode: "reference"; abilityId: string; cooldown: number; bonus: number }
  | { mode: "inline"; text: string };

export function resolveNpcAbility(abilityName: string, pack: PackData): ResolvedAbility {
  const ability = pack.abilities[abilityName];
  if (ability) {
    return {
      mode: "reference",
      abilityId: abilityName,
      cooldown: ability.cooldown,
      bonus: ability.bonus,
    };
  }
  return {
    mode: "inline",
    text: abilityName,
  };
}
