import { useEffect, useMemo, useState } from "react";
import {
  loadOpenRouterCatalog,
  selectImageModels,
  selectTextModels,
  type OpenRouterCatalog,
  type OpenRouterModelEntry,
} from "../llm/openRouterCatalog";

const CUSTOM_VALUE = "__custom__";

const AUTO_ROUTER: OpenRouterModelEntry = {
  id: "openrouter/auto",
  name: "OpenRouter · Auto Router (picks per request)",
  outputModalities: ["text"],
  inputModalities: ["text"],
};

type Kind = "text" | "image";

type Props = {
  kind: Kind;
  value: string;
  onChange: (modelId: string) => void;
};

function formatLabel(entry: OpenRouterModelEntry): string {
  if (entry.name && entry.name !== entry.id) return `${entry.name} — ${entry.id}`;
  return entry.id;
}

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
              {formatLabel(entry)}
            </option>
          ))}
          <option value={CUSTOM_VALUE}>Custom model id…</option>
        </select>
      </label>
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
