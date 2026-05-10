import { z } from "zod";

export const AreaSchema = z.object({
  description: z.string().default(""),
  paths: z.array(z.string()).default([]),
  spawn: z
    .array(
      z.object({
        ref: z.string(),
        chance: z.number().min(0).max(1),
      }),
    )
    .optional(),
});

export const LocationSchema = z.object({
  name: z.string(),
  basicInfo: z.string().default(""),
  x: z.number().default(0),
  y: z.number().default(0),
  radius: z.number().default(1),
  region: z.string().default(""),
  complexityType: z.string().default("basic"),
  detailType: z.string().default("basic"),
  known: z.boolean().default(true),
  embeddingId: z.string().optional(),
  sceneTags: z.array(z.string()).optional(),
  areas: z.record(z.string(), AreaSchema).optional(),
});

export const RegionSchema = z.object({
  name: z.string(),
  basicInfo: z.string().default(""),
  x: z.number().default(0),
  y: z.number().default(0),
  realm: z.string().default(""),
  factions: z.array(z.string()).default([]),
  known: z.boolean().default(true),
});

export const RealmSchema = z.object({
  name: z.string(),
  basicInfo: z.string().default(""),
});

export const BonusSchema = z.object({
  type: z.string(),
  variable: z.string(),
  value: z.number().optional(),
  amount: z.number().optional(),
});

export const ItemSchema = z.object({
  name: z.string(),
  category: z.string().default("Tool"),
  slot: z.string().default("trinket"),
  description: z.string().default(""),
  bonuses: z.array(BonusSchema).default([]),
});

export const AbilityRequirementSchema = z.object({
  type: z.string(),
  variable: z.string(),
  amount: z.number(),
});

export const AbilitySchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  requirements: z.array(AbilityRequirementSchema).default([]),
  bonus: z.number().default(0),
  cooldown: z.number().default(0),
});

export const TraitSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  quirk: z.string().default(""),
  skills: z.array(z.object({ skill: z.string(), modifier: z.number() })).default([]),
  attributes: z
    .array(z.object({ attribute: z.string(), modifier: z.number() }))
    .default([]),
  resources: z.array(z.object({ resource: z.string(), modifier: z.number() })).default([]),
  abilities: z.array(z.string()).default([]),
});

export const SkillSchema = z.object({
  name: z.string(),
  type: z.string().default("utility"),
  attribute: z.string().default("wisdom"),
  description: z.string().default(""),
});

export const NpcTypeSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  vulnerabilities: z.array(z.string()).default([]),
  resistances: z.array(z.string()).default([]),
  immunities: z.array(z.string()).default([]),
  silhouette: z.enum(["humanoid", "beast", "mass", "construct"]).optional(),
  biomes: z.array(z.string()).optional(),
});

export const NpcSchema = z.object({
  name: z.string(),
  type: z.string().default(""),
  currentLocation: z.string().default(""),
  currentArea: z.string().default(""),
  gender: z.string().optional(),
  tier: z.string().default("trivial"),
  level: z.number().default(1),
  hpMax: z.number().default(100),
  faction: z.string().optional(),
  personality: z.array(z.string()).default([]),
  abilities: z.array(z.string()).default([]),
  known: z.boolean().default(true),
  portrait: z.string().optional(),
});

export const QuestSchema = z.object({
  name: z.string(),
  questSource: z.string(),
  questStatement: z.string(),
  mainObjective: z.string(),
  completionCondition: z.string(),
  questDesignBrief: z.string(),
  detailType: z.enum(["basic", "detailed"]).default("basic"),
  questLocation: z.string().nullable().optional(),
  questGiverNPC: z.string(),
});

const TierDefaultSchema = z.object({
  attributes: z.record(z.string(), z.number()).default({}),
  skillRank: z.number().default(1),
  ac: z.number().default(10),
  attacksPerTurn: z.number().default(1),
  damageDie: z.string().default("1d6+0"),
});

export const PackSchema = z.object({
  configVersion: z.string().optional(),
  abilities: z.record(z.string(), AbilitySchema).default({}),
  factions: z.record(z.string(), z.object({ name: z.string(), basicInfo: z.string().optional() })).default({}),
  items: z.record(z.string(), ItemSchema).default({}),
  locations: z.record(z.string(), LocationSchema).default({}),
  npcTypes: z.record(z.string(), NpcTypeSchema).default({}),
  npcs: z.record(z.string(), NpcSchema).default({}),
  quests: z.record(z.string(), QuestSchema).default({}),
  realms: z.record(z.string(), RealmSchema).default({}),
  regions: z.record(z.string(), RegionSchema).default({}),
  skills: z.record(z.string(), SkillSchema).default({}),
  traits: z.record(z.string(), TraitSchema).default({}),
  encounterElements: z.record(z.string(), z.string()).default({}),
  storyStarts: z.record(z.string(), z.unknown()).default({}),
  nameFilterSettings: z.record(z.string(), z.object({ replacements: z.array(z.string()) })).default({}),
  combatSettings: z
    .object({
      damageTypes: z.array(z.string()).default([]),
      tierDefaults: z.record(z.string(), TierDefaultSchema).optional(),
      tickModel: z.enum(["turn-based", "rtwp"]).optional(),
    })
    .default({ damageTypes: [] }),
  resourceSettings: z.record(z.string(), z.unknown()).default({}),
  attributeSettings: z
    .object({
      attributeNames: z.array(z.string()).default([]),
    })
    .default({ attributeNames: [] }),
  aiInstructions: z.record(z.string(), z.unknown()).default({}),
  worldLore: z.record(z.string(), z.unknown()).default({}),
  death: z
    .object({
      permadeath: z.boolean().default(false),
      instructions: z.string().default(""),
    })
    .default({ permadeath: false, instructions: "" }),
});

export type PackData = z.infer<typeof PackSchema>;
export type PackNpc = z.infer<typeof NpcSchema>;
export type PackNpcType = z.infer<typeof NpcTypeSchema>;
export type PackLocation = z.infer<typeof LocationSchema>;
export type PackRegion = z.infer<typeof RegionSchema>;
