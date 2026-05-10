import {
  DENSITY_LEVELS,
  EXIT_KINDS,
  LIGHTING_PRIMARIES,
  SCENE_ARCHETYPES,
  SCENE_SCOPES,
  SKY_KINDS,
  SURFACE_CONDITIONS,
  SURFACE_MATERIALS,
  TEMPLATE_IDS,
  WEATHER_KINDS,
  type SceneScope,
} from "../sceneSpec";

export type ScenePromptContext = {
  scope: SceneScope;
  prose: string;
  worldTone?: string;
  parentRegion?: { name: string; spec: unknown };
  parentLocation?: { name: string; spec: unknown };
  ids: {
    regionId?: string;
    locationId?: string;
    areaId?: string;
  };
};

const ENUM_BLOCK = [
  `archetype: ${SCENE_ARCHETYPES.join(" | ")}`,
  `surface.material: ${SURFACE_MATERIALS.join(" | ")}`,
  `surface.condition: ${SURFACE_CONDITIONS.join(" | ")}`,
  `sky.kind: ${SKY_KINDS.join(" | ")}`,
  `weather.kind: ${WEATHER_KINDS.join(" | ")}`,
  `density: ${DENSITY_LEVELS.join(" | ")}`,
  `lighting.primary: ${LIGHTING_PRIMARIES.join(" | ")}`,
  `feature.template: ${TEMPLATE_IDS.join(" | ")}`,
  `exit.kind: ${EXIT_KINDS.join(" | ")}`,
  `scope: ${SCENE_SCOPES.join(" | ")}`,
].join("\n");

const SHARED_RULES = `
You are the Voyage scene classifier. Translate sparse prose about a place into a single SceneSpec JSON object using ONLY the controlled vocabulary below. Output JSON only — no prose, no comments, no extra keys.

ABSOLUTE RULES:
- Output a single JSON object that matches the SceneSpec schema exactly.
- Use only values from the enums in the vocabulary block. Never invent new values.
- Never reference world-specific names (no "tavern", "elven", "imperial", etc.). Use only generic vocabulary.
- Numeric ranges: feature.x and feature.z in [-1, 1]. brightness, intensity, weather.intensity in [0, 1]. scale > 0 in world units.
- Palette colours are #RRGGBB hex strings, 1-3 entries.
- 4-12 features per scope is plenty. Less is better than wrong.
- Do not duplicate features at identical (x, z); spread them across the unit disc.

SCOPE-SPECIFIC RULES:
- region: REQUIRED to provide surface, sky, lighting (this is the overworld ground source). Features should be ambient natural (mountains, tree clusters, rock clusters), not built. scale ≈ 40-80.
- location: OMIT surface, sky, weather, lighting (inherit from region). Features are dense built features (towers, houses, walls, fountains, gates). scale ≈ 12-25.
- area outdoors: OMIT surface, sky, weather, lighting (inherit). Add a few district sub-features. scale ≈ 8-15.
- area interior (archetype interior-room | interior-hall | corridor | underground): REQUIRED to override surface, sky, lighting (it is a closed room, not the open world). Features are interior props (pillar-cluster, lamp, statue, door-portal). scale ≈ 6-12.

VOCABULARY:
${ENUM_BLOCK}
`.trim();

const FEW_SHOT: Array<{ user: string; assistant: string }> = [
  {
    user: `scope: region
ids: { regionId: "Tin Valley" }
prose: "A valley of green earth and scattered woods, framed by distant mountains."
worldTone: "low fantasy"`,
    assistant: JSON.stringify({
      scope: "region",
      archetype: "open-natural",
      surface: { material: "earth", condition: "overgrown", palette: ["#5e7a3a", "#3f5a26", "#82994a"] },
      sky: { kind: "open-sky", palette: ["#9bc1ee", "#cfe2f3", "#f5d5a7"], brightness: 0.85 },
      weather: { kind: "none", intensity: 0 },
      density: "sparse",
      scale: 60,
      lighting: { primary: "sun-warm", intensity: 0.85 },
      features: [
        { template: "tree-cluster", x: -0.7, z: -0.6, scale: 1.4 },
        { template: "tree-cluster", x: 0.65, z: 0.6, scale: 1.2 },
        { template: "mountain-silhouette", x: 0.0, z: -0.95, scale: 1.6 },
        { template: "rock-cluster", x: -0.6, z: 0.55, scale: 0.9 },
      ],
      exits: [],
      ambientAudio: "wind-soft",
    }),
  },
  {
    user: `scope: region
ids: { regionId: "Asteroid Belt" }
prose: "A dead drift of broken rock and silent metal in open void."
worldTone: "hard sci-fi"`,
    assistant: JSON.stringify({
      scope: "region",
      archetype: "void",
      surface: { material: "metal", condition: "scorched", palette: ["#1a1c24", "#2d2f3a", "#4a4d5e"] },
      sky: { kind: "starfield", palette: ["#03060e", "#0a1230", "#1a2155"], brightness: 0.18 },
      weather: { kind: "none", intensity: 0 },
      density: "sparse",
      scale: 60,
      lighting: { primary: "ambient-only", intensity: 0.6 },
      features: [
        { template: "rock-cluster", x: -0.85, z: -0.7, scale: 1.6 },
        { template: "rock-cluster", x: 0.8, z: 0.85, scale: 1.4 },
        { template: "obelisk", x: 0.0, z: -0.9, scale: 0.9 },
      ],
      exits: [],
      ambientAudio: "void-silence",
    }),
  },
  {
    user: `scope: location
ids: { regionId: "Tin Valley", locationId: "Tinford" }
prose: "A small trade village clustered around a stone fountain and a market."
parentRegion: { archetype: "open-natural", surface.material: "earth" }`,
    assistant: JSON.stringify({
      scope: "location",
      archetype: "open-built",
      density: "moderate",
      scale: 18,
      features: [
        { template: "fountain", x: 0.0, z: 0.0, scale: 0.9, label: "Village Fountain" },
        { template: "house", x: -0.55, z: -0.45, rotation: 0.4, scale: 1.0 },
        { template: "house", x: 0.55, z: -0.5, rotation: -0.4, scale: 1.0 },
        { template: "house", x: -0.55, z: 0.55, scale: 0.9 },
        { template: "stall", x: 0.4, z: 0.5, scale: 0.95, label: "Market" },
        { template: "lamp", x: -0.25, z: 0.0 },
        { template: "lamp", x: 0.25, z: 0.0 },
      ],
      exits: [],
    }),
  },
  {
    user: `scope: area
ids: { regionId: "Tin Valley", locationId: "Tinford", areaId: "Cellar Hall" }
prose: "A damp stone hall lit by a single torch. Rats nest in the corners."`,
    assistant: JSON.stringify({
      scope: "area",
      archetype: "underground",
      surface: { material: "stone", condition: "worn", palette: ["#3a342c", "#28241e", "#5a4f40"] },
      sky: { kind: "tunnel-rock", palette: ["#0a0908", "#1c1813", "#2c241c"], brightness: 0.08 },
      weather: { kind: "none", intensity: 0 },
      density: "sparse",
      scale: 10,
      lighting: { primary: "torch", intensity: 0.55 },
      features: [
        { template: "pillar-cluster", x: -0.6, z: 0.0, scale: 0.7 },
        { template: "pillar-cluster", x: 0.6, z: 0.0, scale: 0.7 },
        { template: "pyre", x: 0.0, z: 0.4, scale: 0.9, label: "Brazier" },
        { template: "door-portal", x: 0.0, z: -0.85, label: "Up to Square" },
      ],
      exits: [{ x: 0.0, z: -0.85, kind: "stair-up" }],
      ambientAudio: "wind-soft",
    }),
  },
];

export function buildSystemPrompt(): string {
  const fewShotBlock = FEW_SHOT.map(
    (ex) => `Example input:\n${ex.user}\n\nExample output:\n${ex.assistant}`,
  ).join("\n\n---\n\n");
  return `${SHARED_RULES}\n\nEXAMPLES:\n\n${fewShotBlock}`;
}

export function buildUserPrompt(ctx: ScenePromptContext): string {
  const lines: string[] = [];
  lines.push(`scope: ${ctx.scope}`);
  lines.push(`ids: ${JSON.stringify(ctx.ids)}`);
  if (ctx.worldTone) {
    lines.push(`worldTone: ${ctx.worldTone}`);
  }
  if (ctx.parentRegion) {
    lines.push(
      `parentRegion: ${JSON.stringify({ name: ctx.parentRegion.name, spec: ctx.parentRegion.spec })}`,
    );
  }
  if (ctx.parentLocation) {
    lines.push(
      `parentLocation: ${JSON.stringify({ name: ctx.parentLocation.name, spec: ctx.parentLocation.spec })}`,
    );
  }
  lines.push(`prose: ${JSON.stringify(ctx.prose)}`);
  return lines.join("\n");
}

export function buildRepairPrompt(rawResponse: string, validationError: string): string {
  return [
    "The previous SceneSpec response failed validation. Return a corrected JSON object that conforms to the schema.",
    `validationError: ${validationError}`,
    `previousResponse: ${rawResponse}`,
    "Output the corrected JSON only.",
  ].join("\n");
}
