import { DeterministicRng } from "../rng/rng";
import {
  SceneSpecSchema,
  type SceneArchetype,
  type SceneScope,
  type SceneSpec,
  type SurfaceCondition,
  type SurfaceMaterial,
  type TemplateId,
} from "./sceneSpec";

export type ProceduralInput = {
  scope: SceneScope;
  prose: string;
  seed: string;
  parentRegion?: SceneSpec;
  parentLocation?: SceneSpec;
};

const ARCHETYPE_KEYWORDS: Array<[RegExp, SceneArchetype]> = [
  [/\b(corridor|passage|hallway|airlock)\b/iu, "corridor"],
  [/\b(cave|cavern|tunnel|underground|cellar|crypt|catacomb|mine)\b/iu, "underground"],
  [/\b(hall|chamber|throne|sanctum|nave|vault)\b/iu, "interior-hall"],
  [/\b(interior|room|cabin|inside)\b/iu, "interior-room"],
  [/\b(void|space|station|ship|orbit|asteroid|wreck|hulk)\b/iu, "void"],
  [/\b(sky|aerial|airborne|cloud|floating|skyborn|sky-island)\b/iu, "aerial"],
  [/\b(reef|sea|ocean|lagoon|underwater|aquatic)\b/iu, "aquatic"],
  [/\b(city|fortress|castle|citadel|temple|complex|metropolis)\b/iu, "packed-built"],
  [/\b(village|town|hamlet|outpost|station|farmstead|settlement|hub|ward)\b/iu, "open-built"],
];

const MATERIAL_KEYWORDS: Array<[RegExp, SurfaceMaterial]> = [
  [/\b(metal|steel|iron|alloy|chrome|titanium|brass)\b/iu, "metal"],
  [/\b(wood|timber|plank|log)\b/iu, "wood"],
  [/\b(crystal|crystal[-s]?|crystalline|gem|geode)\b/iu, "crystal"],
  [/\b(ice|frozen|glacier|frost)\b/iu, "ice"],
  [/\b(sand|desert|dune)\b/iu, "sand"],
  [/\b(water|lake|river|sea|pond|pool|lagoon|reef|ocean|aquatic)\b/iu, "water"],
  [/\b(void|null|empty|vacuum)\b/iu, "void"],
  [/\b(energy|plasma|psionic|aether|leyline)\b/iu, "energy"],
  [/\b(stone|marble|granite|basalt|cobble|brick|tile)\b/iu, "stone"],
  [/\b(grass|meadow|moss|earth|soil|dirt|loam|plain|valley|wood|forest|grove|jungle|savanna)\b/iu, "earth"],
];

const CONDITION_KEYWORDS: Array<[RegExp, SurfaceCondition]> = [
  [/\b(ruin|ruined|wreck|wrecked|broken|shattered|fall(?:en)?|collaps(?:ed|ing))\b/iu, "ruined"],
  [/\b(scorched|burnt|burned|charred|ash|cinder)\b/iu, "scorched"],
  [/\b(overgrown|moss|vine|jungle|wild|grown over)\b/iu, "overgrown"],
  [/\b(worn|old|weather(?:ed)?|aged|battered|cracked|tarnish|tarnished)\b/iu, "worn"],
];

const BUILT_TEMPLATES: TemplateId[] = [
  "house",
  "tower",
  "stall",
  "wall-section",
  "fountain",
  "lamp",
  "statue",
  "pillar-cluster",
  "platform",
];
const NATURAL_TEMPLATES: TemplateId[] = [
  "tree-cluster",
  "rock-cluster",
  "mountain-silhouette",
  "pond",
  "cliff",
];
const INTERIOR_TEMPLATES: TemplateId[] = [
  "pillar-cluster",
  "lamp",
  "statue",
  "fountain",
  "pyre",
];
const SCIFI_TEMPLATES: TemplateId[] = [
  "machine",
  "pod",
  "energy-conduit",
  "obelisk",
  "crystal-cluster",
];

function pickFirstMatch<T>(rules: Array<[RegExp, T]>, prose: string, fallback: T): T {
  for (const [re, val] of rules) {
    if (re.test(prose)) return val;
  }
  return fallback;
}

const DEFAULT_PALETTES: Record<SurfaceMaterial, string[]> = {
  stone: ["#8a8275", "#5e574c", "#a59c8a"],
  earth: ["#5e7a3a", "#3f5a26", "#82994a"],
  sand: ["#d6c089", "#a08855", "#e7d8a8"],
  metal: ["#3a3e48", "#22252c", "#5a6070"],
  wood: ["#5b3e2a", "#3f2a1d", "#7a553b"],
  water: ["#3b6dba", "#2a4f8a", "#82b1e5"],
  ice: ["#bfd9e8", "#94b3c9", "#dde9f2"],
  crystal: ["#a8d8ff", "#6f7fff", "#e0e6ff"],
  energy: ["#7be9ff", "#4cb9d6", "#caf6ff"],
  void: ["#0c0f1a", "#1a1d2c", "#262b40"],
};

const DEFAULT_SKY_PALETTES: Record<string, string[]> = {
  "open-sky": ["#9bc1ee", "#cfe2f3", "#f5d5a7"],
  starfield: ["#03060e", "#0a1230", "#1a2155"],
  "indoor-vault": ["#101218", "#161821", "#1d2030"],
  "tunnel-rock": ["#0a0908", "#1c1813", "#2c241c"],
  cloudy: ["#7c8ea4", "#a4b4c8", "#cbd6e2"],
  stormy: ["#3a4554", "#4d5a6c", "#6a7a90"],
  auroral: ["#1a2a55", "#3a6e90", "#9eddc7"],
  void: ["#03060e", "#0a1230", "#1a2155"],
};

function makeRng(seed: string): DeterministicRng {
  return new DeterministicRng(seed);
}

function pickDensity(archetype: SceneArchetype): "void" | "sparse" | "moderate" | "dense" | "packed" {
  switch (archetype) {
    case "packed-built":
      return "packed";
    case "open-built":
      return "moderate";
    case "open-natural":
      return "sparse";
    case "interior-room":
    case "interior-hall":
    case "corridor":
    case "underground":
      return "sparse";
    case "void":
    case "aerial":
      return "void";
    case "aquatic":
      return "sparse";
    default:
      return "sparse";
  }
}

function pickSky(archetype: SceneArchetype): {
  kind: keyof typeof DEFAULT_SKY_PALETTES;
  brightness: number;
} {
  switch (archetype) {
    case "void":
      return { kind: "void", brightness: 0.18 };
    case "aerial":
      return { kind: "cloudy", brightness: 0.85 };
    case "underground":
      return { kind: "tunnel-rock", brightness: 0.1 };
    case "interior-room":
    case "interior-hall":
    case "corridor":
      return { kind: "indoor-vault", brightness: 0.15 };
    default:
      return { kind: "open-sky", brightness: 0.85 };
  }
}

function pickLighting(archetype: SceneArchetype): {
  primary: SceneSpec["lighting"] extends undefined ? never : NonNullable<SceneSpec["lighting"]>["primary"];
  intensity: number;
} {
  switch (archetype) {
    case "void":
      return { primary: "ambient-only", intensity: 0.5 };
    case "underground":
      return { primary: "torch", intensity: 0.55 };
    case "interior-room":
    case "interior-hall":
    case "corridor":
      return { primary: "torch", intensity: 0.6 };
    case "aerial":
      return { primary: "sun-cool", intensity: 0.85 };
    default:
      return { primary: "sun-warm", intensity: 0.85 };
  }
}

function pickTemplates(archetype: SceneArchetype, prose: string): TemplateId[] {
  const isScifi = /\b(metal|machine|station|ship|reactor|conduit|circuit|energy|module|console)\b/iu.test(prose);
  if (archetype === "underground" || archetype === "interior-room" || archetype === "interior-hall" || archetype === "corridor") {
    return INTERIOR_TEMPLATES;
  }
  if (archetype === "void" || archetype === "aerial") {
    return SCIFI_TEMPLATES;
  }
  if (archetype === "open-built" || archetype === "packed-built") {
    return isScifi ? SCIFI_TEMPLATES : BUILT_TEMPLATES;
  }
  return NATURAL_TEMPLATES;
}

function placeFeatures(
  rng: DeterministicRng,
  templates: TemplateId[],
  count: number,
): SceneSpec["features"] {
  const out: SceneSpec["features"] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + rng.next() * 0.4;
    const radius = 0.3 + rng.next() * 0.55;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const key = `${Math.round(x * 10)}|${Math.round(z * 10)}`;
    if (used.has(key)) continue;
    used.add(key);
    const template = templates[rng.int(0, templates.length - 1)];
    out.push({
      template,
      x: Math.max(-1, Math.min(1, x)),
      z: Math.max(-1, Math.min(1, z)),
      rotation: rng.next() * Math.PI * 2,
      scale: 0.85 + rng.next() * 0.4,
    });
  }
  return out;
}

function pickArchetypeForScope(scope: SceneScope, prose: string, parent?: SceneSpec): SceneArchetype {
  const detected = pickFirstMatch(ARCHETYPE_KEYWORDS, prose, scope === "region" ? "open-natural" : "open-built");
  if (scope === "region") {
    if (detected === "void" || detected === "aerial" || detected === "aquatic" || detected === "open-natural") {
      return detected;
    }
    return "open-natural";
  }
  if (scope === "location") {
    if (detected === "open-built" || detected === "packed-built") return detected;
    if (parent?.archetype === "void") return "open-built";
    return "open-built";
  }
  // area
  if (
    detected === "interior-room" ||
    detected === "interior-hall" ||
    detected === "corridor" ||
    detected === "underground"
  ) {
    return detected;
  }
  return parent?.archetype ?? "open-built";
}

export function proceduralSpec(input: ProceduralInput): SceneSpec {
  const rng = makeRng(`${input.seed}::${input.scope}`);
  const archetype = pickArchetypeForScope(input.scope, input.prose, input.parentLocation ?? input.parentRegion);
  const material = pickFirstMatch(
    MATERIAL_KEYWORDS,
    input.prose,
    archetype === "void"
      ? "metal"
      : archetype === "underground"
        ? "stone"
        : archetype === "open-natural"
          ? "earth"
          : "stone",
  );
  const condition = pickFirstMatch(CONDITION_KEYWORDS, input.prose, "pristine");
  const sky = pickSky(archetype);
  const lighting = pickLighting(archetype);
  const density = pickDensity(archetype);
  const templates = pickTemplates(archetype, input.prose);
  const featureCount = input.scope === "region" ? 5 : input.scope === "location" ? 6 : 4;
  const features = placeFeatures(rng, templates, featureCount);

  const interior =
    input.scope === "area" &&
    (archetype === "interior-room" ||
      archetype === "interior-hall" ||
      archetype === "corridor" ||
      archetype === "underground");

  const includesScopeFields = input.scope === "region" || interior;

  const base: SceneSpec = {
    scope: input.scope,
    archetype,
    surface: includesScopeFields
      ? {
          material,
          condition,
          palette: DEFAULT_PALETTES[material] ?? DEFAULT_PALETTES.stone,
        }
      : undefined,
    sky: includesScopeFields
      ? {
          kind: sky.kind as SceneSpec["sky"] extends undefined ? never : NonNullable<SceneSpec["sky"]>["kind"],
          palette: DEFAULT_SKY_PALETTES[sky.kind] ?? DEFAULT_SKY_PALETTES["open-sky"],
          brightness: sky.brightness,
        }
      : undefined,
    weather: includesScopeFields ? { kind: "none", intensity: 0 } : undefined,
    density,
    scale:
      input.scope === "region"
        ? 60
        : input.scope === "location"
          ? 18
          : interior
            ? 9
            : 12,
    lighting: includesScopeFields
      ? { primary: lighting.primary, intensity: lighting.intensity }
      : undefined,
    features,
    exits: [],
    ambientAudio:
      archetype === "void"
        ? "void-silence"
        : archetype === "underground"
          ? "wind-soft"
          : archetype === "open-built" || archetype === "packed-built"
            ? "city-bustle"
            : "wind-soft",
  };

  // Validate to be safe — if it fails for some weird reason, we still want to surface the issue.
  return SceneSpecSchema.parse(base);
}
