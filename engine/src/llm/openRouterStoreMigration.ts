import {
  DEFAULT_OPENROUTER_IMAGE_MODEL,
  DEFAULT_OPENROUTER_TEXT_MODEL,
} from "./openRouterDefaults";
import {
  loadOpenRouterCatalog,
  selectImageModels,
  selectTextModels,
  type OpenRouterCatalog,
  type OpenRouterModelEntry,
} from "./openRouterCatalog";
import { useStore } from "../state/store";

/**
 * Validate persisted OpenRouter model ids against the live catalog so a stale
 * or hallucinated slug (a recurring problem) gets rewritten to a working model
 * before the first request.
 *
 * - Auto Router (`openrouter/auto`) is always considered valid for text.
 * - Other ids are kept if the catalog lists them.
 * - Otherwise we substitute the first matching model from the live catalog;
 *   the configured default is preferred when present.
 */
export async function migrateOpenRouterModelsInStore(): Promise<void> {
  const catalog = await loadOpenRouterCatalog();
  if (!catalog) return;

  const store = useStore.getState();

  if (store.textLlmBackend === "openrouter") {
    const fixed = pickValidId(
      store.openRouterTextModel,
      DEFAULT_OPENROUTER_TEXT_MODEL,
      selectTextModels(catalog),
      catalog,
      { allowAutoRouter: true },
    );
    if (fixed && fixed !== store.openRouterTextModel.trim()) {
      store.setOpenRouterTextModel(fixed);
    }
  }

  if (store.imageLlmBackend === "openrouter") {
    const fixed = pickValidId(
      store.openRouterImageModel,
      DEFAULT_OPENROUTER_IMAGE_MODEL,
      selectImageModels(catalog),
      catalog,
      { allowAutoRouter: false },
    );
    if (fixed && fixed !== store.openRouterImageModel.trim()) {
      store.setOpenRouterImageModel(fixed);
    }
  }
}

function pickValidId(
  current: string,
  fallback: string,
  candidates: OpenRouterModelEntry[],
  catalog: OpenRouterCatalog,
  opts: { allowAutoRouter: boolean },
): string | null {
  const trimmed = current.trim();
  if (trimmed === "openrouter/auto" && opts.allowAutoRouter) return trimmed;

  const allIds = new Set(catalog.models.map((m) => m.id));
  if (trimmed && allIds.has(trimmed)) return trimmed;

  const candidateIds = new Set(candidates.map((m) => m.id));
  if (candidateIds.has(fallback)) return fallback;
  return candidates[0]?.id ?? null;
}
