import type { WorldData } from "../schema/worldSchema";
import { DeterministicRng } from "../rng/rng";

export function enforceNameFilter(
  name: string,
  promptHash: string,
  world: WorldData,
): string {
  const [firstName, ...rest] = name.split(" ");
  const filter = world.nameFilterSettings[firstName];
  if (!filter || filter.replacements.length === 0) {
    return name;
  }
  const rng = new DeterministicRng(promptHash);
  const replacement = rng.pick(filter.replacements);
  return [replacement, ...rest].join(" ").trim();
}
