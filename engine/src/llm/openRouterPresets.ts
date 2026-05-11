/**
 * Legacy id rewrites for OpenRouter model ids previously shipped that no
 * longer exist in the live catalog. The UI now derives its dropdowns from the
 * catalog (`openRouterCatalog.ts`); this map only fixes localStorage values
 * that were written by older builds.
 *
 * The catalog-driven `migrateOpenRouterModelsInStore` runs first and replaces
 * any unknown id with a live one, so these aliases are mostly belt-and-braces.
 */
const LEGACY_OPENROUTER_TEXT_IDS: Record<string, string> = {
  "anthropic/claude-3.5-sonnet": "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-sonnet-20241022": "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-sonnet-20240620": "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-haiku-20241022": "anthropic/claude-3.5-haiku",
};

export function normalizeOpenRouterTextModelId(id: string): string {
  const t = id.trim();
  return LEGACY_OPENROUTER_TEXT_IDS[t] ?? t;
}

const LEGACY_OPENROUTER_IMAGE_IDS: Record<string, string> = {
  "black-forest-labs/flux.2-pro": "google/gemini-2.5-flash-image",
  "black-forest-labs/flux.2-flex": "google/gemini-2.5-flash-image",
  "sourceful/riverflow-v2-standard-preview": "google/gemini-2.5-flash-image",
  "sourceful/riverflow-v2-fast": "google/gemini-2.5-flash-image",
  "sourceful/riverflow-v2-pro": "google/gemini-2.5-flash-image",
};

export function normalizeOpenRouterImageModelId(id: string): string {
  const t = id.trim();
  return LEGACY_OPENROUTER_IMAGE_IDS[t] ?? t;
}
