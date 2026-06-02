import { z } from "zod";

/**
 * Schema for the evaluator's JSON response. Designed to be MAXIMALLY
 * forgiving: every field has a sensible default so a model that returns
 * `{}` (or, more often, omits a field it thinks is obvious) still
 * yields a parseable outcome rather than crashing the turn.
 *
 * The strict version (with required fields and a max-length cap) lived
 * here originally but kept tripping on real LLM responses — e.g.
 * Gemini-Flash returning only `verdict + reason`, or GPT-4o-mini
 * returning a flat shape without `interpretation`. We treat the
 * schema as the *target* shape and fill defaults at parse time.
 */
export const CanonicalIntentCandidateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("region.move"),
    dx: z.number().int(),
    dy: z.number().int(),
  }),
  z.object({
    kind: z.literal("region.travelTo"),
    x: z.number().int(),
    y: z.number().int(),
    locationId: z.string().optional(),
  }),
  z.object({
    kind: z.literal("region.enterLocation"),
    locationId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("location.move"),
    dx: z.number().int(),
    dy: z.number().int(),
  }),
  z.object({
    kind: z.literal("location.enterTile"),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("location.leave"),
    direction: z.enum(["north", "south", "east", "west"]).optional(),
  }),
  z.object({
    kind: z.literal("scene.leaveTile"),
  }),
  z.object({
    kind: z.literal("scene.button"),
    verb: z.string(),
    groupId: z.string().optional(),
  }),
]);

export const PlayerConditionPatchSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  severity: z.string().optional(),
  effects: z.array(z.string()).default([]),
  notes: z.string().optional(),
  expiresAt: z.number().optional(),
});

// Enum schemas with `.catch()` defaults so an unknown value from the
// LLM (e.g. `"distraction"` for an interrupt kind, or `"impossible"`
// for a verdict) falls back to a sensible default instead of throwing.
// `.default()` only covers MISSING values; `.catch()` covers INVALID
// ones. Together they make the schema tolerate any non-string nonsense.
const VerdictEnum = z
  .enum(["trivial_success", "success", "partial", "failure", "refused"])
  .catch("trivial_success")
  .default("trivial_success");

const ConfidenceEnum = z
  .enum(["low", "medium", "high"])
  .catch("medium")
  .default("medium");

const InterruptKindEnum = z
  .enum(["encounter", "ambush", "event", "none"])
  .catch("none")
  .default("none");

const InterruptTimingEnum = z
  .enum(["before_action", "after_action", "replaces_action"])
  .catch("after_action")
  .default("after_action");

const InterpretationSchema = z
  .object({
    summary: z.string().default(""),
    canonicalIntent: CanonicalIntentCandidateSchema.optional().catch(undefined),
    confidence: ConfidenceEnum,
  })
  .default({ summary: "", confidence: "medium" });

const InterruptSchema = z
  .object({
    kind: InterruptKindEnum,
    timing: InterruptTimingEnum,
    requiresDialogue: z.boolean().catch(false).default(false),
    hint: z.string().optional().catch(undefined),
  })
  .default({
    kind: "none",
    timing: "after_action",
    requiresDialogue: false,
  });

export const ActionOutcomeSchema = z.object({
  interpretation: InterpretationSchema,
  verdict: VerdictEnum,
  reason: z.string().default(""),
  blockingConditionIds: z.array(z.string()).catch([]).default([]),
  appliesConditions: z.array(PlayerConditionPatchSchema).catch([]).default([]),
  interrupt: InterruptSchema,
});

export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;

/**
 * Produce a synthetic outcome when the evaluator call fails outright
 * (network, schema parse). The narrator continues with `trivial_success`
 * so the player's action proceeds — losing the evaluator's judgment is
 * better than soft-locking the turn.
 */
export function defaultOutcome(summary: string): ActionOutcome {
  return {
    interpretation: {
      summary,
      confidence: "medium",
    },
    verdict: "trivial_success",
    reason: "(evaluator unavailable — proceeding under default success)",
    blockingConditionIds: [],
    appliesConditions: [],
    interrupt: {
      kind: "none",
      timing: "after_action",
      requiresDialogue: false,
    },
  };
}

/**
 * Best-effort coercion of an unknown JSON blob into an `ActionOutcome`.
 * Strips code-fence wrappers, tolerates shapes that flatten
 * `interpretation` into the root, and applies schema defaults. Throws
 * only if the input cannot even be parsed as a JSON object.
 */
export function parseOutcome(input: unknown): ActionOutcome {
  if (typeof input !== "object" || input === null) {
    throw new Error("evaluator response was not a JSON object");
  }
  const obj = input as Record<string, unknown>;

  // Some models flatten `summary` / `confidence` to the root. Pull them
  // back into `interpretation` if they exist at the top level and not
  // already inside `interpretation`.
  if (!obj.interpretation) {
    const flat: Record<string, unknown> = {};
    if (typeof obj.summary === "string") flat.summary = obj.summary;
    if (typeof obj.confidence === "string") flat.confidence = obj.confidence;
    if (obj.canonicalIntent && typeof obj.canonicalIntent === "object") {
      flat.canonicalIntent = obj.canonicalIntent;
    }
    if (Object.keys(flat).length > 0) {
      obj.interpretation = flat;
    }
  }

  // `interpretation` as a bare string → wrap it.
  if (typeof obj.interpretation === "string") {
    obj.interpretation = { summary: obj.interpretation };
  }

  return ActionOutcomeSchema.parse(obj);
}
