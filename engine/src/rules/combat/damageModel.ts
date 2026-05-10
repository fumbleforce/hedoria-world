import type { WorldData, WorldNpcType } from "../../schema/worldSchema";

function parseDice(input: string): { count: number; sides: number; flat: number } {
  const match = input.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) {
    return { count: 1, sides: 6, flat: 0 };
  }
  return {
    count: Number(match[1]),
    sides: Number(match[2]),
    flat: Number(match[3] ?? 0),
  };
}

function applyTypeModifier(
  baseDamage: number,
  damageType: string,
  npcType?: WorldNpcType,
): number {
  if (!npcType) return baseDamage;
  if (npcType.immunities.includes(damageType)) return 0;
  if (npcType.vulnerabilities.includes(damageType))
    return Math.round(baseDamage * 1.5);
  if (npcType.resistances.includes(damageType))
    return Math.max(1, Math.round(baseDamage * 0.5));
  return baseDamage;
}

export function rollDamage(
  die: string,
  damageType: string,
  world: WorldData,
  targetNpcTypeName?: string,
  random = Math.random,
): number {
  const spec = parseDice(die);
  let total = spec.flat;
  for (let i = 0; i < spec.count; i += 1) {
    total += Math.floor(random() * spec.sides) + 1;
  }
  const npcType = targetNpcTypeName ? world.npcTypes[targetNpcTypeName] : undefined;
  return applyTypeModifier(total, damageType, npcType);
}
