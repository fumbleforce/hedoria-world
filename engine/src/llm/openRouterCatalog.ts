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
// Bumped to v2 when we extended the entry shape with pricing, context
// length, description, supported_parameters. Older v1 caches lack
// those fields and would render as "unknown $/ctx" everywhere; force a
// refetch by reading from a new key.
const LS_KEY = "engine.openRouterModelCatalog.v2";
const LS_KEY_LEGACY_V1 = "engine.openRouterModelCatalog";
const LS_TTL_MS = 24 * 60 * 60 * 1000;
let catalogRequestSeq = 0;

export type OpenRouterModelEntry = {
  id: string;
  name: string;
  /** Short marketing description from upstream. May be empty. */
  description: string;
  outputModalities: string[];
  inputModalities: string[];
  /**
   * OpenRouter exposes a `supported_parameters` array per model. We
   * keep the raw list (e.g. ["tools","tool_choice","reasoning",
   * "include_reasoning","response_format","stream"]) so callers can do
   * shape-checks without re-fetching.
   *
   * The most interesting flags for the picker:
   *  - `reasoning` / `include_reasoning` → this is a "thinking" model.
   *  - `tools` / `tool_choice` → usable for narrator function calls.
   *  - `response_format` → can be forced into json mode.
   */
  supportedParameters: string[];
  /** Upstream context window in tokens (e.g. 128_000). 0 = unknown. */
  contextLength: number;
  /**
   * Per-token prices in USD as upstream-quoted decimal strings (e.g.
   * "0.0000005"). Stored as strings so callers can choose how to
   * format. `null` means unknown.
   */
  pricePromptUsd: string | null;
  pricePromptCompletionUsd: string | null;
};

export type OpenRouterCatalog = {
  models: OpenRouterModelEntry[];
  fetchedAt: number;
};

type UpstreamArchitecture = {
  output_modalities?: string[];
  input_modalities?: string[];
};

type UpstreamPricing = {
  prompt?: string;
  completion?: string;
};

type UpstreamModel = {
  id?: string;
  name?: string;
  description?: string;
  architecture?: UpstreamArchitecture;
  context_length?: number;
  pricing?: UpstreamPricing;
  supported_parameters?: string[];
  /**
   * Older endpoint versions sometimes reported supported parameters
   * under `top_provider.supported_parameters` instead of at the root
   * level. We tolerate both.
   */
  top_provider?: { supported_parameters?: string[] };
};

function pickStringArray(...candidates: Array<unknown>): string[] {
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const out = c.filter((x): x is string => typeof x === "string");
      if (out.length > 0) return out;
    }
  }
  return [];
}

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
      description:
        typeof m.description === "string" ? m.description.trim() : "",
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
      supportedParameters: pickStringArray(
        m.supported_parameters,
        m.top_provider?.supported_parameters,
      ),
      contextLength:
        typeof m.context_length === "number" && Number.isFinite(m.context_length)
          ? m.context_length
          : 0,
      pricePromptUsd:
        typeof m.pricing?.prompt === "string" ? m.pricing.prompt : null,
      pricePromptCompletionUsd:
        typeof m.pricing?.completion === "string" ? m.pricing.completion : null,
    });
  }
  return out;
}

function readLsCache(): OpenRouterCatalog | null {
  try {
    // Sweep the legacy v1 entry so we don't leave a stale 200KB blob
    // sitting in localStorage forever.
    globalThis.localStorage?.removeItem(LS_KEY_LEGACY_V1);
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

// ────────────────────────────────────────────────────────────────────
// Capability helpers used by the model picker UI.
// ────────────────────────────────────────────────────────────────────

const REASONING_SUPPORTED_PARAMS = new Set([
  "reasoning",
  "include_reasoning",
  "thinking",
]);

/**
 * Whether this entry is a "thinking" model — one that emits a chain
 * of internal reasoning before its visible output. Detected via
 * `supported_parameters` first (authoritative for OpenRouter) and
 * with a defensive id-suffix fallback for any catalog rows that
 * predate the supported-parameters expansion.
 */
export function isReasoningModel(entry: OpenRouterModelEntry): boolean {
  for (const p of entry.supportedParameters) {
    if (REASONING_SUPPORTED_PARAMS.has(p)) return true;
  }
  const id = entry.id.toLowerCase();
  return (
    id.includes(":thinking") ||
    id.includes("-thinking") ||
    id.endsWith("-reasoner") ||
    id.includes("-reasoning")
  );
}

/** Whether the model can natively accept images on the input side. */
export function acceptsImageInput(entry: OpenRouterModelEntry): boolean {
  return entry.inputModalities.includes("image");
}

/** Whether the model emits images. */
export function emitsImageOutput(entry: OpenRouterModelEntry): boolean {
  return entry.outputModalities.includes("image");
}

/** Whether the model can be driven with OpenAI-style tool calls. */
export function supportsTools(entry: OpenRouterModelEntry): boolean {
  return (
    entry.supportedParameters.includes("tools") ||
    entry.supportedParameters.includes("tool_choice")
  );
}

/** Whether the model can be forced into JSON-only output. */
export function supportsJsonMode(entry: OpenRouterModelEntry): boolean {
  return entry.supportedParameters.includes("response_format");
}

/** Render the context window as "128k", "1M", etc. Empty string if 0. */
export function formatContextLength(entry: OpenRouterModelEntry): string {
  const n = entry.contextLength;
  if (!n || n <= 0) return "";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M ctx`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k ctx`;
  }
  return `${n} ctx`;
}

/**
 * Format the per-1M-token input/output price as a compact "$P/$C/M".
 * Returns empty when both are unknown or zero (free models).
 */
export function formatPricing(entry: OpenRouterModelEntry): string {
  const fmt = (raw: string | null): string | null => {
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n === 0) return "free";
    // Upstream prices are per-token; humans think in $/1M tokens.
    const per1M = n * 1_000_000;
    if (per1M >= 100) return `$${per1M.toFixed(0)}`;
    if (per1M >= 10) return `$${per1M.toFixed(1)}`;
    return `$${per1M.toFixed(2)}`;
  };
  const inp = fmt(entry.pricePromptUsd);
  const out = fmt(entry.pricePromptCompletionUsd);
  if (!inp && !out) return "";
  if (inp && out && inp === "free" && out === "free") return "free";
  return `${inp ?? "?"} / ${out ?? "?"} per 1M`;
}

/**
 * Compose a compact text label suitable for a native `<option>`. Browsers
 * cannot render real icons inside `<option>` elements, so we lean on
 * emoji glyphs as the lingua franca:
 *
 *   🧠 reasoning / thinking model
 *   🖼 accepts image input
 *   🛠 tools (function calls)
 *   { } json-mode (response_format)
 *
 * Followed by friendly name, id, context window, and pricing.
 */
export function formatOptionLabel(entry: OpenRouterModelEntry): string {
  const badges: string[] = [];
  if (isReasoningModel(entry)) badges.push("🧠");
  if (acceptsImageInput(entry)) badges.push("🖼");
  if (supportsTools(entry)) badges.push("🛠");
  if (supportsJsonMode(entry)) badges.push("{}");
  const trailing: string[] = [];
  const ctx = formatContextLength(entry);
  if (ctx) trailing.push(ctx);
  const price = formatPricing(entry);
  if (price) trailing.push(price);
  const main =
    entry.name && entry.name !== entry.id
      ? `${entry.name} — ${entry.id}`
      : entry.id;
  return `${badges.length > 0 ? badges.join(" ") + " " : ""}${main}${trailing.length > 0 ? "  ·  " + trailing.join(" · ") : ""}`;
}
