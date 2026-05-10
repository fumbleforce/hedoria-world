import { z } from "zod";

export const SCENE_SCOPES = ["region", "location", "area"] as const;
export type SceneScope = (typeof SCENE_SCOPES)[number];

export const SCENE_ARCHETYPES = [
  "open-natural",
  "open-built",
  "packed-built",
  "interior-room",
  "interior-hall",
  "corridor",
  "underground",
  "aquatic",
  "void",
  "aerial",
] as const;
export type SceneArchetype = (typeof SCENE_ARCHETYPES)[number];

export const SURFACE_MATERIALS = [
  "stone",
  "earth",
  "sand",
  "metal",
  "wood",
  "water",
  "ice",
  "crystal",
  "energy",
  "void",
] as const;
export type SurfaceMaterial = (typeof SURFACE_MATERIALS)[number];

export const SURFACE_CONDITIONS = [
  "pristine",
  "worn",
  "ruined",
  "scorched",
  "overgrown",
] as const;
export type SurfaceCondition = (typeof SURFACE_CONDITIONS)[number];

export const SKY_KINDS = [
  "open-sky",
  "starfield",
  "indoor-vault",
  "tunnel-rock",
  "cloudy",
  "stormy",
  "auroral",
  "void",
] as const;
export type SkyKind = (typeof SKY_KINDS)[number];

export const WEATHER_KINDS = [
  "none",
  "rain",
  "snow",
  "dust",
  "ash",
  "fog",
  "embers",
] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export const DENSITY_LEVELS = [
  "void",
  "sparse",
  "moderate",
  "dense",
  "packed",
] as const;
export type DensityLevel = (typeof DENSITY_LEVELS)[number];

export const LIGHTING_PRIMARIES = [
  "sun-warm",
  "sun-cool",
  "moon",
  "torch",
  "neon",
  "bioluminescent",
  "ambient-only",
] as const;
export type LightingPrimary = (typeof LIGHTING_PRIMARIES)[number];

export const TEMPLATE_IDS = [
  "pillar-cluster",
  "tower",
  "spire",
  "dome-hall",
  "house",
  "stall",
  "bridge",
  "gate-arch",
  "wall-section",
  "stair",
  "platform",
  "statue",
  "fountain",
  "lamp",
  "door-portal",
  "tree-cluster",
  "rock-cluster",
  "cliff",
  "mountain-silhouette",
  "crater",
  "pond",
  "pod",
  "machine",
  "crystal-cluster",
  "energy-conduit",
  "obelisk",
  "pyre",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const EXIT_KINDS = [
  "doorway",
  "edge-passage",
  "portal",
  "stair-up",
  "stair-down",
  "world-edge",
] as const;
export type ExitKind = (typeof EXIT_KINDS)[number];

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u, "expected #RRGGBB hex colour");

export const SurfaceSchema = z.object({
  material: z.enum(SURFACE_MATERIALS),
  condition: z.enum(SURFACE_CONDITIONS),
  palette: z.array(HexColor).min(1).max(3),
});
export type Surface = z.infer<typeof SurfaceSchema>;

export const SkySchema = z.object({
  kind: z.enum(SKY_KINDS),
  palette: z.array(HexColor).min(1).max(3),
  brightness: z.number().min(0).max(1),
});
export type Sky = z.infer<typeof SkySchema>;

export const WeatherSchema = z.object({
  kind: z.enum(WEATHER_KINDS),
  intensity: z.number().min(0).max(1),
});
export type Weather = z.infer<typeof WeatherSchema>;

export const LightingSchema = z.object({
  primary: z.enum(LIGHTING_PRIMARIES),
  intensity: z.number().min(0).max(1),
});
export type Lighting = z.infer<typeof LightingSchema>;

export const FeatureSchema = z.object({
  template: z.enum(TEMPLATE_IDS),
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
  rotation: z.number().optional(),
  scale: z.number().positive().optional(),
  label: z.string().optional(),
  materialOverride: z.string().optional(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const ExitSchema = z.object({
  toAreaId: z.string().optional(),
  toLocationId: z.string().optional(),
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
  kind: z.enum(EXIT_KINDS),
});
export type Exit = z.infer<typeof ExitSchema>;

export const SceneSpecSchema = z
  .object({
    scope: z.enum(SCENE_SCOPES),
    archetype: z.enum(SCENE_ARCHETYPES),
    surface: SurfaceSchema.optional(),
    sky: SkySchema.optional(),
    weather: WeatherSchema.optional(),
    density: z.enum(DENSITY_LEVELS),
    scale: z.number().positive(),
    lighting: LightingSchema.optional(),
    features: z.array(FeatureSchema).default([]),
    exits: z.array(ExitSchema).default([]),
    ambientAudio: z.string().optional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.scope === "region") {
      const required = ["surface", "sky", "lighting"] as const;
      for (const field of required) {
        if (!spec[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `region SceneSpec must include '${field}' (regions own the overworld ground)`,
            path: [field],
          });
        }
      }
    }
    if (spec.scope === "area") {
      const isInteriorArchetype =
        spec.archetype === "interior-room" ||
        spec.archetype === "interior-hall" ||
        spec.archetype === "corridor" ||
        spec.archetype === "underground";
      if (isInteriorArchetype) {
        for (const field of ["surface", "sky", "lighting"] as const) {
          if (!spec[field]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `interior area SceneSpec must override '${field}'`,
              path: [field],
            });
          }
        }
      }
    }
  });

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

export type ComposedFeature = Feature & {
  source: SceneScope;
};

export type ComposedSceneSpec = {
  effectiveScope: SceneScope;
  archetype: SceneArchetype;
  surface: Surface;
  sky: Sky;
  weather: Weather;
  density: DensityLevel;
  scale: number;
  lighting: Lighting;
  features: ComposedFeature[];
  exits: Exit[];
  ambientAudio?: string;
  sources: {
    region?: SceneSpec;
    location?: SceneSpec;
    area?: SceneSpec;
  };
};

const DEFAULT_WEATHER: Weather = { kind: "none", intensity: 0 };

function pickFirst<T>(values: Array<T | undefined>, fallback: T): T {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return fallback;
}

/**
 * Merge a region (required) with optional location and area specs into a single
 * ComposedSceneSpec the renderer can consume directly. Surface / sky / lighting
 * fall through region -> location -> area unless an interior area overrides.
 * Features merge: region features (ambient natural), then location features
 * (footprint built structures), then area features (district sub-detail).
 */
export function composeSceneSpec(input: {
  region: SceneSpec;
  location?: SceneSpec;
  area?: SceneSpec;
}): ComposedSceneSpec {
  const { region, location, area } = input;
  if (region.scope !== "region") {
    throw new Error(
      `composeSceneSpec expected region scope, got '${region.scope}'`,
    );
  }
  if (location && location.scope !== "location") {
    throw new Error(
      `composeSceneSpec expected location scope for location arg, got '${location.scope}'`,
    );
  }
  if (area && area.scope !== "area") {
    throw new Error(
      `composeSceneSpec expected area scope for area arg, got '${area.scope}'`,
    );
  }

  const isInteriorArea = !!area && (
    area.archetype === "interior-room" ||
    area.archetype === "interior-hall" ||
    area.archetype === "corridor" ||
    area.archetype === "underground"
  );

  const surface = pickFirst(
    [area?.surface, location?.surface, region.surface],
    region.surface!,
  );
  const sky = pickFirst(
    [area?.sky, location?.sky, region.sky],
    region.sky!,
  );
  const lighting = pickFirst(
    [area?.lighting, location?.lighting, region.lighting],
    region.lighting!,
  );
  const weather = pickFirst(
    [area?.weather, location?.weather, region.weather],
    DEFAULT_WEATHER,
  );

  const features: ComposedFeature[] = [];
  if (!isInteriorArea) {
    for (const feature of region.features) {
      features.push({ ...feature, source: "region" });
    }
    if (location) {
      for (const feature of location.features) {
        features.push({ ...feature, source: "location" });
      }
    }
  }
  if (area) {
    for (const feature of area.features) {
      features.push({ ...feature, source: "area" });
    }
  }

  // Interior areas only expose their own exits — otherwise an indoor scene
  // would inherit the parent location's "doorway" exit (the very door that
  // brought us in here) and render it as a stray marker inside the cellar.
  const exits: Exit[] = isInteriorArea
    ? [...(area?.exits ?? [])]
    : [
        ...region.exits,
        ...(location?.exits ?? []),
        ...(area?.exits ?? []),
      ];

  const effectiveScope: SceneScope = area
    ? "area"
    : location
      ? "location"
      : "region";
  const archetype = area?.archetype ?? location?.archetype ?? region.archetype;
  const density = area?.density ?? location?.density ?? region.density;
  const scale = area?.scale ?? location?.scale ?? region.scale;
  const ambientAudio =
    area?.ambientAudio ?? location?.ambientAudio ?? region.ambientAudio;

  return {
    effectiveScope,
    archetype,
    surface,
    sky,
    weather,
    density,
    scale,
    lighting,
    features,
    exits,
    ambientAudio,
    sources: { region, location, area },
  };
}

export function isInteriorArchetype(archetype: SceneArchetype): boolean {
  return (
    archetype === "interior-room" ||
    archetype === "interior-hall" ||
    archetype === "corridor" ||
    archetype === "underground"
  );
}
