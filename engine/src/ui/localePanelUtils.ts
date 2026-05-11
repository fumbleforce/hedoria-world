import type { WorldLocation } from "../schema/worldSchema";

export function locationAreaDescriptions(loc: WorldLocation | undefined): string {
  if (!loc?.areas) return "";
  return Object.values(loc.areas)
    .map((a) => a.description?.trim())
    .filter((s): s is string => !!s)
    .join("\n\n");
}
