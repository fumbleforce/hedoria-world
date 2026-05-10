import type { WorldData } from "../../schema/worldSchema";

export type ResolvedAbility =
  | { mode: "reference"; abilityId: string; cooldown: number; bonus: number }
  | { mode: "inline"; text: string };

export function resolveNpcAbility(
  abilityName: string,
  world: WorldData,
): ResolvedAbility {
  const ability = world.abilities[abilityName];
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
