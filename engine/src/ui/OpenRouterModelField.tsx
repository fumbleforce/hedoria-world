import { useEffect, useMemo, useState } from "react";
import {
  acceptsImageInput,
  emitsImageOutput,
  formatContextLength,
  formatOptionLabel,
  formatPricing,
  isReasoningModel,
  loadOpenRouterCatalog,
  selectImageModels,
  selectTextModels,
  supportsJsonMode,
  supportsTools,
  type OpenRouterCatalog,
  type OpenRouterModelEntry,
} from "../llm/openRouterCatalog";

const CUSTOM_VALUE = "__custom__";

const AUTO_ROUTER: OpenRouterModelEntry = {
  id: "openrouter/auto",
  name: "OpenRouter · Auto Router (picks per request)",
  description: "Routes each request to the cheapest model that can handle it.",
  outputModalities: ["text"],
  inputModalities: ["text"],
  supportedParameters: [],
  contextLength: 0,
  pricePromptUsd: null,
  pricePromptCompletionUsd: null,
};

type Kind = "text" | "image";

type Props = {
  kind: Kind;
  value: string;
  onChange: (modelId: string) => void;
};

/**
 * Live model picker backed by the OpenRouter catalog. Falls back to a free-text
 * field when the catalog hasn't loaded (or the persisted id isn't listed).
 */
export function OpenRouterModelField({ kind, value, onChange }: Props) {
  const [catalog, setCatalog] = useState<OpenRouterCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadOpenRouterCatalog()
      .then((c) => {
        if (cancelled) return;
        if (!c) {
          setError(
            "Could not load OpenRouter model catalog (is the dev server running?)",
          );
          return;
        }
        setCatalog(c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo<OpenRouterModelEntry[]>(() => {
    if (!catalog) return [];
    const list = kind === "text" ? selectTextModels(catalog) : selectImageModels(catalog);
    if (kind === "text") {
      // Drop any catalog entry for the auto router; we always prepend our own
      // labelled copy at the top so the dropdown opens on a sensible default.
      const withoutAuto = list.filter((m) => m.id !== AUTO_ROUTER.id);
      return [AUTO_ROUTER, ...withoutAuto];
    }
    return list;
  }, [catalog, kind]);

  const ids = useMemo(() => new Set(options.map((o) => o.id)), [options]);
  const selectValue = options.length === 0 || !ids.has(value)
    ? CUSTOM_VALUE
    : value;

  const selectedEntry = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  return (
    <>
      <label className="settingsPanel__field">
        <span className="settingsPanel__label">Model</span>
        <select
          className="settingsPanel__select"
          value={selectValue}
          title={value}
          disabled={options.length === 0}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM_VALUE) return;
            onChange(next);
          }}
        >
          {options.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {formatOptionLabel(entry)}
            </option>
          ))}
          <option value={CUSTOM_VALUE}>Custom model id…</option>
        </select>
      </label>
      {selectedEntry ? <ModelDetailRow entry={selectedEntry} /> : null}
      {selectValue === CUSTOM_VALUE ? (
        <label className="settingsPanel__field">
          <span className="settingsPanel__label">Custom id</span>
          <input
            className="settingsPanel__select"
            type="text"
            value={value}
            spellCheck={false}
            placeholder="provider/model-name"
            title="Paste any model id from openrouter.ai/models"
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      ) : null}
      {error ? (
        <p className="settingsPanel__hint" style={{ color: "var(--fg-3)" }}>
          {error} — paste a model id manually below.
        </p>
      ) : null}
      {!error && options.length === 0 ? (
        <p className="settingsPanel__hint">Loading OpenRouter catalog…</p>
      ) : null}
    </>
  );
}

/**
 * Compact "what does this model actually do" badge strip + description
 * that appears below the dropdown once a real catalog entry is in
 * focus. We use it both in this stand-alone field and in the per-kind
 * row, so the visual language stays consistent across all model
 * pickers.
 */
export function ModelDetailRow({ entry }: { entry: OpenRouterModelEntry }) {
  const badges: Array<{ icon: string; label: string; tone?: "warn" | "info" }> =
    [];
  if (isReasoningModel(entry)) {
    badges.push({
      icon: "🧠",
      label: "Thinking model — streams reasoning before visible prose",
      tone: "warn",
    });
  }
  if (acceptsImageInput(entry)) {
    badges.push({ icon: "🖼", label: "Image input" });
  }
  if (emitsImageOutput(entry)) {
    badges.push({ icon: "🎨", label: "Image output" });
  }
  if (supportsTools(entry)) {
    badges.push({ icon: "🛠", label: "Tool calls" });
  }
  if (supportsJsonMode(entry)) {
    badges.push({ icon: "{ }", label: "JSON mode" });
  }
  const ctx = formatContextLength(entry);
  const price = formatPricing(entry);

  return (
    <div className="modelDetail">
      {badges.length > 0 ? (
        <div className="modelDetail__badges">
          {badges.map((b) => (
            <span
              key={b.label}
              className={
                "modelDetail__badge" +
                (b.tone === "warn" ? " modelDetail__badge--warn" : "")
              }
              title={b.label}
            >
              <span className="modelDetail__badgeIcon" aria-hidden>
                {b.icon}
              </span>
              <span className="modelDetail__badgeText">{b.label}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="modelDetail__meta">
        {ctx ? <span>{ctx}</span> : null}
        {price ? <span>{price}</span> : null}
      </div>
      {entry.description ? (
        <p className="modelDetail__desc" title={entry.description}>
          {entry.description.length > 220
            ? entry.description.slice(0, 217).trimEnd() + "…"
            : entry.description}
        </p>
      ) : null}
    </div>
  );
}
