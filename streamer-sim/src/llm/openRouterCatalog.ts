/**
 * Live OpenRouter model catalog. Fetched once and reused for the lifetime of
 * the page. In prod (supabaseConfigured) the catalog comes from the edge
 * function `/models` endpoint (JWT required). In dev it uses the Vite proxy
 * at `/__openrouter/models`.
 *
 * Cached in localStorage (24h) as a fallback when offline. Concurrent callers
 * are deduped via the in-memory `inflight` promise.
 */

import { diag } from "../diag/log";
import { supabaseConfigured } from "../lib/supabase";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const DEV_PROXY_PATH = "/__openrouter/models";
// v2: bumped when the upstream query changed to include image-only models.
const LS_KEY = "limelight.openRouterModelCatalog.v2";
const LS_TTL_MS = 24 * 60 * 60 * 1000;
let catalogRequestSeq = 0;

export type OpenRouterModelPricing = {
  prompt: string;
  completion: string;
  image?: string;
  request?: string;
};

export type OpenRouterModelEntry = {
  id: string;
  name: string;
  description: string;
  contextLength: number | null;
  outputModalities: string[];
  inputModalities: string[];
  pricing: OpenRouterModelPricing;
};

export type OpenRouterCatalog = {
  models: OpenRouterModelEntry[];
  fetchedAt: number;
};

type UpstreamModel = {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number | null;
  architecture?: {
    output_modalities?: string[];
    input_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    image_output?: string;
    request?: string;
  };
};

function normalizeUpstream(raw: unknown): OpenRouterModelEntry[] {
  const root = raw as { data?: UpstreamModel[] };
  const arr = Array.isArray(root.data) ? root.data : [];
  const out: OpenRouterModelEntry[] = [];
  for (const m of arr) {
    const id = typeof m.id === "string" ? m.id.trim() : "";
    if (!id) continue;
    const p = m.pricing ?? {};
    out.push({
      id,
      name: typeof m.name === "string" && m.name.trim() ? m.name.trim() : id,
      description: typeof m.description === "string" ? m.description.trim() : "",
      contextLength: typeof m.context_length === "number" ? m.context_length : null,
      outputModalities: Array.isArray(m.architecture?.output_modalities)
        ? m.architecture.output_modalities.filter((x): x is string => typeof x === "string")
        : [],
      inputModalities: Array.isArray(m.architecture?.input_modalities)
        ? m.architecture.input_modalities.filter((x): x is string => typeof x === "string")
        : [],
      pricing: {
        prompt: typeof p.prompt === "string" ? p.prompt : "0",
        completion: typeof p.completion === "string" ? p.completion : "0",
        image: typeof p.image === "string" ? p.image
          : typeof p.image_output === "string" ? p.image_output
          : typeof p.request === "string" ? p.request
          : undefined,
      },
    });
  }
  return out;
}

function readLsCache(): OpenRouterCatalog | null {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OpenRouterCatalog>;
    if (!parsed || typeof parsed.fetchedAt !== "number" || !Array.isArray(parsed.models)) return null;
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
    /* quota / disabled */
  }
}

let inflight: Promise<OpenRouterCatalog | null> | null = null;
let resolved: OpenRouterCatalog | null = null;

export function loadOpenRouterCatalog(accessToken?: string): Promise<OpenRouterCatalog | null> {
  const callerId = `cat-${++catalogRequestSeq}`;
  if (resolved) return Promise.resolve(resolved);
  if (inflight) return inflight;

  const cached = readLsCache();
  if (cached) {
    resolved = cached;
    diag.info("llm", "openrouter catalog localStorage hit", {
      callerId,
      models: cached.models.length,
      ageMs: Date.now() - cached.fetchedAt,
    });
    return Promise.resolve(cached);
  }

  diag.info("llm", "openrouter catalog cold fetch starting", { callerId });
  inflight = fetchFresh(callerId, accessToken);
  return inflight;
}

async function fetchFresh(callerId: string, accessToken?: string): Promise<OpenRouterCatalog | null> {
  const startedAt = performance.now();
  try {
    const url = supabaseConfigured
      ? `${SUPABASE_URL}/functions/v1/openrouter-proxy/models`
      : DEV_PROXY_PATH;
    const headers: Record<string, string> = { "X-Request-Id": `or-models-${callerId}` };
    if (supabaseConfigured && accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      diag.error("llm", `openrouter catalog HTTP ${response.status}`, { callerId });
      return null;
    }
    const json = (await response.json()) as unknown;
    const models = normalizeUpstream(json);
    if (models.length === 0) {
      diag.error("llm", "openrouter catalog returned 0 models", { callerId });
      return null;
    }
    const catalog: OpenRouterCatalog = { models, fetchedAt: Date.now() };
    resolved = catalog;
    writeLsCache(catalog);
    diag.info("llm", "openrouter catalog fetched", {
      callerId,
      models: models.length,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return catalog;
  } catch (err) {
    diag.error("llm", "openrouter catalog fetch threw", {
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

/** Drop the in-memory + localStorage cache and fetch a fresh catalog. */
export function refreshOpenRouterCatalog(accessToken?: string): Promise<OpenRouterCatalog | null> {
  resolved = null;
  inflight = null;
  try {
    globalThis.localStorage?.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  inflight = fetchFresh(`refresh-${++catalogRequestSeq}`, accessToken);
  return inflight;
}

export function findOpenRouterModel(modelId: string): OpenRouterModelEntry | undefined {
  return resolved?.models.find((m) => m.id === modelId);
}

/** Chat / tool models (text output, skip pure image generators). */
export function selectTextModels(catalog: OpenRouterCatalog): OpenRouterModelEntry[] {
  return catalog.models
    .filter((m) => {
      const out = m.outputModalities;
      if (out.length === 0) return false;
      if (out.length === 1 && out[0] === "image") return false;
      return out.includes("text");
    })
    .sort(compareById);
}

/** Models that emit images. */
export function selectImageModels(catalog: OpenRouterCatalog): OpenRouterModelEntry[] {
  return catalog.models
    .filter((m) => m.outputModalities.includes("image"))
    .sort(compareById);
}

/** True when a model emits images but not text (Seedream, Flux, etc.). */
export function isImageOnlyModel(entry: OpenRouterModelEntry): boolean {
  return entry.outputModalities.includes("image") && !entry.outputModalities.includes("text");
}

/**
 * OpenRouter `modalities` for an image-generation request.
 * Image-only models (Seedream, Flux, …) must use `["image"]`; Gemini image
 * models need `["image","text"]`. See openrouter.ai/docs image generation.
 */
export function imageRequestModalities(modelId: string): ("image" | "text")[] {
  const entry = findOpenRouterModel(modelId);
  if (entry) {
    return isImageOnlyModel(entry) ? ["image"] : ["image", "text"];
  }
  // Catalog not loaded yet — guess from slug; default to image-only (safer).
  if (/gemini.*image/i.test(modelId)) return ["image", "text"];
  return ["image"];
}

/** Ordered modality sets to try when the catalog guess or upstream rejects a combo. */
export function imageRequestModalitiesFallbacks(modelId: string): ("image" | "text")[][] {
  const primary = imageRequestModalities(modelId);
  const alt: ("image" | "text")[] = primary.length === 1 ? ["image", "text"] : ["image"];
  if (alt.join() === primary.join()) return [primary];
  return [primary, alt];
}

export function isOpenRouterModalityError(message: string): boolean {
  return /output modalities|modalities:/i.test(message);
}

function compareById(a: OpenRouterModelEntry, b: OpenRouterModelEntry): number {
  return a.id.localeCompare(b.id);
}

/** USD per million tokens (OpenRouter prices are per-token decimals). */
export function formatTokenPricePerM(tokenPrice: string | undefined): string {
  if (!tokenPrice) return "—";
  const n = Number(tokenPrice);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "free";
  const perM = n * 1_000_000;
  if (perM < 0.01) return `$${perM.toFixed(4)}/M`;
  if (perM < 1) return `$${perM.toFixed(3)}/M`;
  return `$${perM.toFixed(2)}/M`;
}

export function formatContextLength(n: number | null): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ctx`;
  if (n >= 1000) return `${Math.round(n / 1000)}k ctx`;
  return `${n} ctx`;
}

export function formatModalities(mods: string[]): string {
  return mods.length ? mods.join("+") : "—";
}

export function formatImagePrice(entry: OpenRouterModelEntry): string {
  const img = entry.pricing.image;
  if (!img) return "—";
  const n = Number(img);
  if (!Number.isFinite(n)) return img;
  if (n === 0) return "free";
  // Flat per-image fees are whole dollars; tiny decimals are per-token.
  if (n >= 0.001) return `$${n.toFixed(3)}/img`;
  return `$${(n * 1_000_000).toFixed(2)}/M`;
}
