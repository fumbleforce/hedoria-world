import type { PackData } from "../schema/packSchema";
import { DeterministicRng } from "../rng/rng";

export function enforceNameFilter(name: string, promptHash: string, pack: PackData): string {
  const [firstName, ...rest] = name.split(" ");
  const filter = pack.nameFilterSettings[firstName];
  if (!filter || filter.replacements.length === 0) {
    return name;
  }
  const rng = new DeterministicRng(promptHash);
  const replacement = rng.pick(filter.replacements);
  return [replacement, ...rest].join(" ").trim();
}
