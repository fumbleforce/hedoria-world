const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

const VISUAL_TERMS = new Set([
  "alley",
  "alleys",
  "archive",
  "avenue",
  "barn",
  "barracks",
  "basalt",
  "basin",
  "bay",
  "beach",
  "bridge",
  "bridges",
  "building",
  "buildings",
  "canyon",
  "canal",
  "cave",
  "cavern",
  "cellar",
  "cliff",
  "cliffs",
  "coast",
  "column",
  "columns",
  "courtyard",
  "courtyards",
  "district",
  "dock",
  "docks",
  "dungeon",
  "embankment",
  "farmland",
  "field",
  "fields",
  "forest",
  "fort",
  "fortress",
  "fountain",
  "gate",
  "gates",
  "garden",
  "gardens",
  "granite",
  "grassland",
  "harbor",
  "hall",
  "halls",
  "hill",
  "hills",
  "house",
  "houses",
  "ice",
  "island",
  "jungle",
  "lake",
  "lane",
  "marble",
  "marsh",
  "market",
  "meadow",
  "mine",
  "mountain",
  "mountains",
  "mud",
  "orchard",
  "palace",
  "path",
  "paths",
  "pavement",
  "pier",
  "plain",
  "plains",
  "plaza",
  "port",
  "quarry",
  "quay",
  "quarter",
  "reef",
  "river",
  "road",
  "roads",
  "roof",
  "roofs",
  "ruin",
  "ruins",
  "sand",
  "sea",
  "settlement",
  "shore",
  "shrine",
  "slate",
  "snow",
  "square",
  "stairs",
  "stall",
  "stalls",
  "stone",
  "street",
  "streets",
  "swamp",
  "temple",
  "timber",
  "tower",
  "towers",
  "trail",
  "valley",
  "vault",
  "vegetation",
  "village",
  "wall",
  "walls",
  "warehouse",
  "water",
  "wetland",
  "wood",
  "yard",
  "yards",
]);

const GENERIC_TERMS = new Set([
  "mixed",
  "terrain",
  "structures",
  "place",
  "area",
  "zone",
  "ground",
]);

const BOILERPLATE_AREA_DESCRIPTIONS = new Set([
  "a new area in the location.",
  "new area",
]);

function clampWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

export function toMapTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t));
}

function takeSignalTerms(tokens: string[], maxWords: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (!VISUAL_TERMS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= maxWords) break;
  }
  return out;
}

function firstSignalSentence(text: string): string {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of sentences) {
    const tokenCount = takeSignalTerms(toMapTokens(s), 3).length;
    if (tokenCount >= 2) return s;
  }
  return sentences[0] ?? "";
}

export function extractVisualBrief(text: string, maxWords: number = 14): string {
  const tokens = toMapTokens(text);
  const picked = takeSignalTerms(tokens, maxWords);
  if (picked.length === 0) return "mixed terrain and structures";
  return clampWords(picked.join(" "), maxWords);
}

export function extractRegionalContext(
  regionProse: string,
  locationProse: string,
  maxWords: number = 12,
): string {
  const regionTokens = toMapTokens(regionProse);
  const locationSet = new Set(toMapTokens(locationProse));
  const shared = takeSignalTerms(
    regionTokens.filter((t) => locationSet.has(t)),
    maxWords,
  );
  if (shared.length >= Math.min(4, maxWords)) {
    return clampWords(shared.join(" "), maxWords);
  }
  const regionOnly = takeSignalTerms(regionTokens, maxWords);
  if (regionOnly.length === 0) return "surrounding mixed terrain";
  return clampWords(regionOnly.join(" "), maxWords);
}

function isTooGeneric(phrase: string): boolean {
  const tokens = phrase.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const nonGeneric = tokens.filter((t) => !GENERIC_TERMS.has(t));
  return nonGeneric.length < Math.min(2, tokens.length);
}

export function buildAnchorBrief(
  regionProse: string,
  locationProse: string,
): { visualBrief: string; regionalContext: string; sourceExcerpt?: string } {
  const visualBrief = extractVisualBrief(locationProse, 14);
  const regionalContext = extractRegionalContext(regionProse, locationProse, 12);
  if (!isTooGeneric(visualBrief) || !isTooGeneric(regionalContext)) {
    return { visualBrief, regionalContext };
  }
  const excerpt = clampWords(firstSignalSentence(locationProse), 12).trim();
  return {
    visualBrief,
    regionalContext,
    ...(excerpt ? { sourceExcerpt: excerpt } : {}),
  };
}

export function buildLocationLayoutBrief(args: {
  locationProse: string;
  areaDescriptions: string[];
}): string {
  const areaText = args.areaDescriptions
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !BOILERPLATE_AREA_DESCRIPTIONS.has(s.toLowerCase()))
    .join(" ");
  const visual = extractVisualBrief(`${args.locationProse} ${areaText}`, 16);
  const context = extractRegionalContext(areaText, args.locationProse, 10);
  return `layout signals: ${visual}; connective context: ${context}`;
}
