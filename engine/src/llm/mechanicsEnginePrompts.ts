/**
 * Short system headers for **rules / resolution** LLM calls (skill checks,
 * quest verification). Not narration and not tile cartography.
 */
export const MECHANICS_ENGINE_PROMPTS = {
  skillCheck(): string {
    return "Resolve the skill check and return strict JSON {outcome, narration, side_effects}.";
  },

  questVerify(): string {
    return "Validate whether the evidence satisfies the completion condition. Return strict JSON {complete, reason}.";
  },
};
