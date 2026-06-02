import { useMemo } from "react";
import type {
  BackendPreference,
  LlmBackend,
  ModelSelection,
} from "../state/store";
import {
  imageModelSelectOptions,
  textModelSelectOptions,
} from "../llm/geminiModelOptions";
import {
  formatOptionLabel,
  selectImageModels,
  selectTextModels,
  type OpenRouterCatalog,
  type OpenRouterModelEntry,
} from "../llm/openRouterCatalog";
import { ModelDetailRow } from "./OpenRouterModelField";
import { DEFAULT_OPENROUTER_TEXT_MODEL } from "../llm/openRouterDefaults";

const USE_DEFAULT_VALUE = "__use_default__";
const CUSTOM_VALUE = "__custom__";

const AUTO_ROUTER_ID = "openrouter/auto";
const AUTO_ROUTER_LABEL = "OpenRouter · Auto Router";

type Kind = "text" | "image";

type Props = {
  label: string;
  kind: Kind;
  /** Top-level backend the panel currently has selected. */
  topLevelBackend: LlmBackend;
  /** The current per-kind selection (backend preference + model id). */
  selection: ModelSelection;
  /** The top-level chat / image model id, used as the "Default" fallback. */
  topLevelGeminiModel: string;
  topLevelOpenRouterModel: string;
  /** OpenRouter catalog if available (text or image options filtered upstream). */
  openRouterCatalog: OpenRouterCatalog | null;
  onChange: (next: ModelSelection) => void;
};

/**
 * One row of the per-call-kind LLM matrix. Mirrors the UX of the top
 * Backend + Model selectors: a backend dropdown plus a model dropdown
 * curated for whichever backend the row resolves to. A "Use backend
 * default" sentinel keeps the model id empty so the provider router
 * falls back to the top-level chat/image model — switching backends
 * never carries a stale slug across (the original cause of the
 * `openai/gpt-4o-mini` going to Gemini and 400-ing out).
 */
export function PerKindModelRow({
  label,
  kind,
  topLevelBackend,
  selection,
  topLevelGeminiModel,
  topLevelOpenRouterModel,
  openRouterCatalog,
  onChange,
}: Props) {
  const effectiveBackend: LlmBackend =
    selection.backend === "default" ? topLevelBackend : selection.backend;
  const fallbackModel =
    effectiveBackend === "openrouter"
      ? topLevelOpenRouterModel || DEFAULT_OPENROUTER_TEXT_MODEL
      : topLevelGeminiModel;

  const setBackend = (next: BackendPreference) => {
    // Reset the model id whenever the backend changes — a model slug
    // is only valid for one backend, so carrying it across silently
    // breaks routing.
    onChange({ backend: next, model: "" });
  };

  const setModel = (next: string) => {
    onChange({ backend: selection.backend, model: next });
  };

  const openRouterEntries = useMemo<OpenRouterModelEntry[]>(() => {
    if (effectiveBackend !== "openrouter") return [];
    if (!openRouterCatalog) return [];
    const list =
      kind === "text"
        ? selectTextModels(openRouterCatalog)
        : selectImageModels(openRouterCatalog);
    if (kind === "text") {
      // We keep the "Auto Router" first; if the upstream catalog
      // exposes it we drop the dup so it isn't listed twice.
      return list.filter((m) => m.id !== AUTO_ROUTER_ID);
    }
    return list;
  }, [effectiveBackend, kind, openRouterCatalog]);

  const openRouterOptions = useMemo(() => {
    if (effectiveBackend !== "openrouter") return [];
    if (openRouterEntries.length === 0) return [];
    const fromCatalog = openRouterEntries.map((m) => ({
      id: m.id,
      label: formatOptionLabel(m),
    }));
    return kind === "text"
      ? [{ id: AUTO_ROUTER_ID, label: AUTO_ROUTER_LABEL }, ...fromCatalog]
      : fromCatalog;
  }, [effectiveBackend, kind, openRouterEntries]);

  const selectedOpenRouterEntry = useMemo<OpenRouterModelEntry | null>(() => {
    if (effectiveBackend !== "openrouter") return null;
    if (!selection.model) return null;
    return openRouterEntries.find((m) => m.id === selection.model) ?? null;
  }, [effectiveBackend, openRouterEntries, selection.model]);

  const geminiOptions = useMemo(() => {
    if (effectiveBackend !== "gemini") return [];
    return kind === "text"
      ? textModelSelectOptions(selection.model || topLevelGeminiModel)
      : imageModelSelectOptions(selection.model || topLevelGeminiModel);
  }, [effectiveBackend, kind, selection.model, topLevelGeminiModel]);

  const isCustom =
    selection.model.trim().length > 0 &&
    (effectiveBackend === "openrouter"
      ? openRouterOptions.length > 0 &&
        !openRouterOptions.some((o) => o.id === selection.model)
      : !geminiOptions.includes(selection.model));

  const selectValue = selection.model
    ? isCustom
      ? CUSTOM_VALUE
      : selection.model
    : USE_DEFAULT_VALUE;

  return (
    <div className="settingsPanel__field perKindRow">
      <span className="settingsPanel__label">{label}</span>
      <div className="perKindRow__controls">
        <select
          className="settingsPanel__select perKindRow__backend"
          value={selection.backend}
          onChange={(e) => setBackend(e.target.value as BackendPreference)}
          title="Backend for this call kind. Default follows the top-level selector."
        >
          <option value="default">Default (follow top-level)</option>
          <option value="gemini">Gemini</option>
          <option value="openrouter">OpenRouter</option>
        </select>
        <select
          className="settingsPanel__select perKindRow__model"
          value={selectValue}
          title={selection.model || `Default — ${fallbackModel}`}
          onChange={(e) => {
            const next = e.target.value;
            if (next === USE_DEFAULT_VALUE) {
              setModel("");
            } else if (next === CUSTOM_VALUE) {
              // Trigger the custom input below; keep current id if it
              // was already a custom string, otherwise blank it so the
              // user has to type.
              setModel(isCustom ? selection.model : selection.model);
            } else {
              setModel(next);
            }
          }}
        >
          <option value={USE_DEFAULT_VALUE}>
            Default — {fallbackModel || "(no model)"}
          </option>
          {effectiveBackend === "gemini"
            ? geminiOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))
            : openRouterOptions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
          <option value={CUSTOM_VALUE}>Custom model id…</option>
        </select>
      </div>
      {isCustom ? (
        <input
          className="settingsPanel__input perKindRow__custom"
          value={selection.model}
          spellCheck={false}
          placeholder={
            effectiveBackend === "openrouter"
              ? "provider/model-name"
              : "gemini-…"
          }
          onChange={(e) => setModel(e.target.value)}
        />
      ) : null}
      {selectedOpenRouterEntry ? (
        <div className="perKindRow__detail">
          <ModelDetailRow entry={selectedOpenRouterEntry} />
        </div>
      ) : null}
      {effectiveBackend === "openrouter" &&
      !openRouterCatalog &&
      openRouterOptions.length === 0 ? (
        <p className="settingsPanel__hint">Loading OpenRouter catalog…</p>
      ) : null}
    </div>
  );
}
