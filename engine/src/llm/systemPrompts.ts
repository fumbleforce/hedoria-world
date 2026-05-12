/**
 * Re-exports for engine-authored LLM system headers. Import from the specific
 * module when adding code so story, mechanics, and tile cartography stay
 * separate:
 *
 * - {@link STORY_ENGINE_PROMPTS} — map traversal + scene DM + defeat prose
 * - {@link MECHANICS_ENGINE_PROMPTS} — skill checks, quest verification
 * - {@link TILE_CARTOGRAPHY_PROMPTS} — region/location grid JSON classify
 */
export { STORY_ENGINE_PROMPTS } from "./storyEnginePrompts";
export { MECHANICS_ENGINE_PROMPTS } from "./mechanicsEnginePrompts";
export { TILE_CARTOGRAPHY_PROMPTS } from "./tileCartographyPrompts";
