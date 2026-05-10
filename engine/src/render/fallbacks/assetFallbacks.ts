import type { PackLocation } from "../../schema/packSchema";

export type BiomeFallback = {
  key: string;
  groundColor: string;
  skyColor: string;
};

const BIOME_FALLBACKS: BiomeFallback[] = [
  { key: "forest", groundColor: "#3d6b3a", skyColor: "#a8c4a2" },
  { key: "wood", groundColor: "#3d6b3a", skyColor: "#a8c4a2" },
  { key: "desert", groundColor: "#c9a872", skyColor: "#f6d7a3" },
  { key: "mountain", groundColor: "#7d8088", skyColor: "#c5d2dc" },
  { key: "river", groundColor: "#4d7ea8", skyColor: "#9bbfd9" },
  { key: "lake", groundColor: "#4d7ea8", skyColor: "#9bbfd9" },
  { key: "coast", groundColor: "#6a8caf", skyColor: "#bcd4e6" },
  { key: "sea", groundColor: "#3d6b8a", skyColor: "#9bbfd9" },
  { key: "marsh", groundColor: "#4c6a53", skyColor: "#a8b8a4" },
  { key: "swamp", groundColor: "#4c6a53", skyColor: "#a8b8a4" },
  { key: "snow", groundColor: "#d8e4ee", skyColor: "#e8eef5" },
  { key: "ice", groundColor: "#d8e4ee", skyColor: "#e8eef5" },
  { key: "ash", groundColor: "#3d3530", skyColor: "#5a4c45" },
  { key: "ruin", groundColor: "#5a4f45", skyColor: "#8a7d70" },
  { key: "marble", groundColor: "#b8b3aa", skyColor: "#e0dcd0" },
  { key: "city", groundColor: "#a89c8a", skyColor: "#d6cebd" },
  { key: "stone", groundColor: "#9a9590", skyColor: "#c8c2bc" },
  { key: "plain", groundColor: "#8a9460", skyColor: "#d4d8b6" },
  { key: "grass", groundColor: "#6e8e4a", skyColor: "#c0d0a8" },
  { key: "default", groundColor: "#7a7568", skyColor: "#bcb6a8" },
];

export type PropFallback = {
  hint: string;
  color: string;
  shape: "tower" | "house" | "spire" | "stall" | "stone";
};

const AREA_PROP_FALLBACKS: PropFallback[] = [
  { hint: "tavern", color: "#7a4d2f", shape: "house" },
  { hint: "inn", color: "#7a4d2f", shape: "house" },
  { hint: "market", color: "#8d6f2f", shape: "stall" },
  { hint: "plaza", color: "#bcb098", shape: "stone" },
  { hint: "square", color: "#bcb098", shape: "stone" },
  { hint: "archive", color: "#4a5166", shape: "tower" },
  { hint: "library", color: "#4a5166", shape: "tower" },
  { hint: "palace", color: "#c0bbaa", shape: "spire" },
  { hint: "temple", color: "#a8a298", shape: "spire" },
  { hint: "tower", color: "#736a5a", shape: "tower" },
  { hint: "college", color: "#6a6258", shape: "tower" },
  { hint: "stable", color: "#6e4a2f", shape: "house" },
  { hint: "barrack", color: "#5a503e", shape: "house" },
  { hint: "wall", color: "#85827a", shape: "stone" },
  { hint: "gate", color: "#85827a", shape: "stone" },
  { hint: "bridge", color: "#85827a", shape: "stone" },
  { hint: "quarter", color: "#8a7d6a", shape: "house" },
  { hint: "house", color: "#8a7d6a", shape: "house" },
  { hint: "yard", color: "#8a7d6a", shape: "stall" },
  { hint: "default", color: "#7d6e58", shape: "house" },
];

export function biomeForLocation(location: PackLocation): BiomeFallback {
  const haystack = `${location.basicInfo} ${location.region} ${location.name} ${(location.sceneTags ?? []).join(" ")}`.toLowerCase();
  for (const fallback of BIOME_FALLBACKS) {
    if (fallback.key !== "default" && haystack.includes(fallback.key)) {
      return fallback;
    }
  }
  return BIOME_FALLBACKS[BIOME_FALLBACKS.length - 1];
}

export function fallbackPropForArea(areaDescription: string): PropFallback {
  const haystack = areaDescription.toLowerCase();
  for (const fallback of AREA_PROP_FALLBACKS) {
    if (fallback.hint !== "default" && haystack.includes(fallback.hint)) {
      return fallback;
    }
  }
  return AREA_PROP_FALLBACKS[AREA_PROP_FALLBACKS.length - 1];
}

