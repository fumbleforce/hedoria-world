import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatContextLength,
  formatImagePrice,
  formatModalities,
  formatTokenPricePerM,
  isImageOnlyModel,
  loadOpenRouterCatalog,
  refreshOpenRouterCatalog,
  selectImageModels,
  selectTextModels,
  type OpenRouterCatalog,
  type OpenRouterModelEntry,
} from "../llm/openRouterCatalog";

const AUTO_ROUTER: OpenRouterModelEntry = {
  id: "openrouter/auto",
  name: "OpenRouter · Auto Router",
  description: "Picks a model per request.",
  contextLength: null,
  outputModalities: ["text"],
  inputModalities: ["text"],
  pricing: { prompt: "0", completion: "0" },
};

type Kind = "text" | "image";

type Props = {
  kind: Kind;
  label: string;
  value: string;
  onChange: (modelId: string) => void;
};

function filterModels(models: OpenRouterModelEntry[], query: string): OpenRouterModelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q),
  );
}

function outputModalityLabel(entry: OpenRouterModelEntry, kind: Kind): string {
  if (kind === "image" && isImageOnlyModel(entry)) return "image-only";
  return formatModalities(entry.outputModalities);
}

function ModelStats({ entry, kind }: { entry: OpenRouterModelEntry; kind: Kind }) {
  return (
    <span className="orModel__stats">
      <span className={`orModel__chip ${kind === "image" && isImageOnlyModel(entry) ? "orModel__chip--imgonly" : ""}`}>
        {outputModalityLabel(entry, kind)}
      </span>
      {kind === "text" ? (
        <>
          <span>{formatContextLength(entry.contextLength)}</span>
          <span>in {formatTokenPricePerM(entry.pricing.prompt)}</span>
          <span>out {formatTokenPricePerM(entry.pricing.completion)}</span>
        </>
      ) : (
        <span>{formatImagePrice(entry)}</span>
      )}
    </span>
  );
}

/**
 * Searchable OpenRouter model picker backed by the live catalog. Shows context,
 * pricing, and output modalities per row. Falls back to free-text when the
 * catalog hasn't loaded or the saved id isn't listed.
 */
export function OpenRouterModelField({ kind, label, value, onChange }: Props) {
  const [catalog, setCatalog] = useState<OpenRouterCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadOpenRouterCatalog()
      .then((c) => {
        if (cancelled) return;
        if (!c) {
          setError("Could not load OpenRouter catalog (is the dev server running?)");
          setCustom(true);
          return;
        }
        setCatalog(c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setCustom(true);
      });
    return () => { cancelled = true; };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const c = await refreshOpenRouterCatalog();
      if (c) setCatalog(c);
      else setError("Refresh failed — is the dev server running?");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  };

  const options = useMemo<OpenRouterModelEntry[]>(() => {
    if (!catalog) return [];
    const list = kind === "text" ? selectTextModels(catalog) : selectImageModels(catalog);
    if (kind === "text") {
      const withoutAuto = list.filter((m) => m.id !== AUTO_ROUTER.id);
      return [AUTO_ROUTER, ...withoutAuto];
    }
    return list;
  }, [catalog, kind]);

  const ids = useMemo(() => new Set(options.map((o) => o.id)), [options]);
  const selected = options.find((m) => m.id === value);
  const filtered = useMemo(() => filterModels(options, query), [options, query]);

  useEffect(() => {
    if (!catalog || custom) return;
    if (value && !ids.has(value)) setCustom(true);
  }, [catalog, custom, ids, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setCustom(false);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="field orModel" ref={rootRef}>
      <span>{label}</span>

      {custom || options.length === 0 ? (
        <input
          type="text"
          value={value}
          spellCheck={false}
          placeholder="provider/model-name"
          title="Paste any model id from openrouter.ai/models"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <>
          <button
            type="button"
            className="orModel__trigger"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="orModel__triggerMain">
              <b>{selected?.name ?? value}</b>
              {selected && selected.name !== selected.id && (
                <small className="orModel__triggerId">{selected.id}</small>
              )}
            </span>
            <span className="orModel__chev">{open ? "▴" : "▾"}</span>
          </button>

          {open && (
            <div className="orModel__panel">
              <div className="orModel__searchRow">
                <input
                  className="orModel__search"
                  type="search"
                  placeholder="Search models…"
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setOpen(false);
                    if (e.key === "Enter" && filtered[0]) pick(filtered[0].id);
                  }}
                />
                <button
                  type="button"
                  className="orModel__refresh"
                  title="Refresh model list from OpenRouter"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  {refreshing ? "…" : "↻"}
                </button>
              </div>
              <ul className="orModel__list" role="listbox">
                {filtered.length === 0 ? (
                  <li className="orModel__empty">No models match “{query}”</li>
                ) : (
                  filtered.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`orModel__row ${entry.id === value ? "orModel__row--on" : ""}`}
                        role="option"
                        aria-selected={entry.id === value}
                        onClick={() => pick(entry.id)}
                      >
                        <span className="orModel__rowTop">
                          <span className="orModel__rowName">{entry.name}</span>
                          <span className="orModel__rowId">{entry.id}</span>
                        </span>
                        <ModelStats entry={entry} kind={kind} />
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </>
      )}

      {selected && !custom && (
        <p className="hint orModel__detail">
          <ModelStats entry={selected} kind={kind} />
          {selected.description ? <> · {selected.description.slice(0, 120)}</> : null}
        </p>
      )}

      {!custom && options.length > 0 && (
        <button type="button" className="chiplink orModel__custom" onClick={() => setCustom(true)}>
          Enter custom id…
        </button>
      )}
      {custom && catalog && (
        <button
          type="button"
          className="chiplink orModel__custom"
          onClick={() => {
            setCustom(false);
            if (ids.has(value)) setOpen(false);
          }}
        >
          Pick from catalog…
        </button>
      )}

      {error ? <p className="hint orModel__err">{error}</p> : null}
      {!error && !catalog ? <p className="hint">Loading OpenRouter catalog…</p> : null}
    </div>
  );
}
