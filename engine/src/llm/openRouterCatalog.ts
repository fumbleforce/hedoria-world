/**
 * Live OpenRouter model catalog. Fetched once via the dev-server proxy at
 * `/__openrouter/models` and reused for the lifetime of the page.
 *
 * The full upstream payload includes pricing, context length, etc. We only
 * keep what the UI needs (id, friendly name, output modalities) so the cache
 * stays small enough to mirror into localStorage as a 24h fallback for
 * offline reloads.
 *
 * Concurrent callers are deduped via the in-memory `inflight` promise. We
 * deliberately do NOT trigger a background refresh when the LS cache is
 * still warm — that path was firing a second proxy hit on every boot which
 * looks alarming in the dev-server log and offers no real benefit (a hard
 * reload always picks up a fresh catalog).
 */

import { diag } from "../diag/log";

const PROXY_PATH = "/__openrouter/models";
const LS_KEY = "engine.openRouterModelCatalog";
const LS_TTL_MS = 24 * 60 * 60 * 1000;
let catalogRequestSeq = 0;

export type OpenRouterModelEntry = {
  id: string;
  name: string;
  outputModalities: string[];
  inputModalities: string[];
};

export type OpenRouterCatalog = {
  models: OpenRouterModelEntry[];
  fetchedAt: number;
};

type UpstreamArchitecture = {
  output_modalities?: string[];
  input_modalities?: string[];
};

type UpstreamModel = {
  id?: string;
  name?: string;
  architecture?: UpstreamArchitecture;
};

function normalizeUpstream(raw: unknown): OpenRouterModelEntry[] {
  const root = raw as { data?: UpstreamModel[] };
  const arr = Array.isArray(root.data) ? root.data : [];
  const out: OpenRouterModelEntry[] = [];
  for (const m of arr) {
    const id = typeof m.id === "string" ? m.id.trim() : "";
    if (!id) continue;
    out.push({
      id,
      name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : id,
      outputModalities: Array.isArray(m.architecture?.output_modalities)
        ? m.architecture.output_modalities.filter(
            (x): x is string => typeof x === "string",
          )
        : [],
      inputModalities: Array.isArray(m.architecture?.input_modalities)
        ? m.architecture.input_modalities.filter(
            (x): x is string => typeof x === "string",
          )
        : [],
    });
  }
  return out;
}

function readLsCache(): OpenRouterCatalog | null {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OpenRouterCatalog>;
    if (
      !parsed ||
      typeof parsed.fetchedAt !== "number" ||
      !Array.isArray(parsed.models)
    ) {
      return null;
    }
    if (Date.now() - parsed.fetchedAt > LS_TTL_MS) return null;
    return { models: parsed.models, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeLsCache(catalog: OpenRouterCatalog): void {
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(catalog));
  } catch {
    // ignore quota / disabled
  }
}

let inflight: Promise<OpenRouterCatalog | null> | null = null;
let resolved: OpenRouterCatalog | null = null;

/**
 * Fetch the catalog once. Subsequent calls return the same promise; subsequent
 * synchronous reads can use {@link getCachedOpenRouterCatalog}.
 */
export function loadOpenRouterCatalog(): Promise<OpenRouterCatalog | null> {
  const callerId = `cat-${++catalogRequestSeq}`;
  if (resolved) {
    diag.debug("llm", `openrouter catalog memory hit`, {
      callerId,
      models: resolved.models.length,
    });
    return Promise.resolve(resolved);
  }
  if (inflight) {
    diag.debug("llm", `openrouter catalog joining inflight fetch`, { callerId });
    return inflight;
  }

  const cached = readLsCache();
  if (cached) {
    resolved = cached;
    diag.info("llm", `openrouter catalog localStorage hit`, {
      callerId,
      models: cached.models.length,
      ageMs: Date.now() - cached.fetchedAt,
    });
    return Promise.resolve(cached);
  }

  diag.info("llm", `openrouter catalog cold fetch starting`, { callerId });
  inflight = fetchFresh(callerId);
  return inflight;
}

async function fetchFresh(callerId: string): Promise<OpenRouterCatalog | null> {
  const startedAt = performance.now();
  try {
    const response = await fetch(PROXY_PATH, {
      headers: { "X-Request-Id": `or-models-${callerId}` },
    });
    if (!response.ok) {
      diag.error("llm", `openrouter catalog HTTP ${response.status}`, { callerId });
      return null;
    }
    const json = (await response.json()) as unknown;
    const models = normalizeUpstream(json);
    if (models.length === 0) {
      diag.error("llm", `openrouter catalog returned 0 models`, { callerId });
      return null;
    }
    const catalog: OpenRouterCatalog = { models, fetchedAt: Date.now() };
    resolved = catalog;
    writeLsCache(catalog);
    diag.info("llm", `openrouter catalog fetched`, {
      callerId,
      models: models.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return catalog;
  } catch (err) {
    diag.error("llm", `openrouter catalog fetch threw`, {
      callerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    inflight = null;
  }
}

export function getCachedOpenRouterCatalog(): OpenRouterCatalog | null {
  return resolved;
}

/** Models suitable for chat / tool calls (text output, no image-only entries). */
export function selectTextModels(catalog: OpenRouterCatalog): OpenRouterModelEntry[] {
  return catalog.models
    .filter((m) => {
      const out = m.outputModalities;
      if (out.length === 0) return false;
      // Skip pure image generators; keep text + multimodal models.
      if (out.length === 1 && out[0] === "image") return false;
      return out.includes("text");
    })
    .sort(compareById);
}

/** Models that emit images. All current entries also output text. */
export function selectImageModels(catalog: OpenRouterCatalog): OpenRouterModelEntry[] {
  return catalog.models
    .filter((m) => m.outputModalities.includes("image"))
    .sort(compareById);
}

function compareById(a: OpenRouterModelEntry, b: OpenRouterModelEntry): number {
  return a.id.localeCompare(b.id);
}
