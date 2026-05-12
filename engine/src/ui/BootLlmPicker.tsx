import { useEffect } from "react";
import { useStore, type LlmBackend } from "../state/store";
import {
  imageModelSelectOptions,
  normalizeGeminiTextModel,
  textModelSelectOptions,
} from "../llm/geminiModelOptions";
import { OpenRouterModelField } from "./OpenRouterModelField";

const hasGeminiEnvKey = Boolean(
  (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim(),
);

/**
 * Slim LLM backend / model picker rendered on the boot screen so a user
 * stuck on a non-responsive provider can switch and reload without ever
 * reaching the in-game Settings panel. All controls write straight to the
 * same store fields the runtime SettingsPanel uses, so the change persists
 * across the upcoming reload.
 *
 * Boot is held by an in-flight LLM call (e.g. `openrouter/auto` hanging on
 * scene-classify), and there is no clean way to cancel that promise from
 * here, so the path forward is "pick a working model, reload". Reload
 * resets the boot promise; the new model is what the next request will use.
 *
 * Reuses the `settingsPanel__*` classes so the picker visually matches the
 * runtime Settings panel and we don't ship a parallel set of styles.
 */
export function BootLlmPicker() {
  const geminiTextModel = useStore((s) => s.geminiTextModel);
  const geminiImageModel = useStore((s) => s.geminiImageModel);
  const setGeminiTextModel = useStore((s) => s.setGeminiTextModel);
  const setGeminiImageModel = useStore((s) => s.setGeminiImageModel);
  const textLlmBackend = useStore((s) => s.textLlmBackend);
  const imageLlmBackend = useStore((s) => s.imageLlmBackend);
  const openRouterTextModel = useStore((s) => s.openRouterTextModel);
  const openRouterImageModel = useStore((s) => s.openRouterImageModel);
  const setTextLlmBackend = useStore((s) => s.setTextLlmBackend);
  const setImageLlmBackend = useStore((s) => s.setImageLlmBackend);
  const setOpenRouterTextModel = useStore((s) => s.setOpenRouterTextModel);
  const setOpenRouterImageModel = useStore((s) => s.setOpenRouterImageModel);

  const normalizedGeminiTextModel = normalizeGeminiTextModel(geminiTextModel);

  useEffect(() => {
    if (
      normalizedGeminiTextModel &&
      normalizedGeminiTextModel !== geminiTextModel
    ) {
      setGeminiTextModel(normalizedGeminiTextModel);
    }
  }, [geminiTextModel, normalizedGeminiTextModel, setGeminiTextModel]);

  return (
    <div className="settingsPanel" style={{ marginTop: 12, textAlign: "left" }}>
      <section className="settingsPanel__section">
        <h3 className="settingsPanel__heading">Text LLM</h3>
        <label className="settingsPanel__field">
          <span className="settingsPanel__label">Backend</span>
          <select
            className="settingsPanel__select"
            value={textLlmBackend}
            title="Where text completions are sent"
            onChange={(e) => {
              const next = e.target.value as LlmBackend;
              if (next === textLlmBackend) return;
              setTextLlmBackend(next);
            }}
          >
            <option value="gemini">Gemini (browser key)</option>
            <option value="openrouter">OpenRouter (dev proxy)</option>
          </select>
        </label>
        {textLlmBackend === "gemini" ? (
          <label className="settingsPanel__field">
            <span className="settingsPanel__label">Model</span>
            <select
              className="settingsPanel__select"
              value={normalizedGeminiTextModel}
              disabled={!hasGeminiEnvKey}
              title={normalizedGeminiTextModel}
              onChange={(e) => {
                const next = e.target.value;
                if (next === normalizedGeminiTextModel) return;
                setGeminiTextModel(next);
              }}
            >
              {textModelSelectOptions(normalizedGeminiTextModel).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <OpenRouterModelField
            kind="text"
            value={openRouterTextModel}
            onChange={setOpenRouterTextModel}
          />
        )}
      </section>

      <section className="settingsPanel__section">
        <h3 className="settingsPanel__heading">Image LLM</h3>
        <label className="settingsPanel__field">
          <span className="settingsPanel__label">Backend</span>
          <select
            className="settingsPanel__select"
            value={imageLlmBackend}
            title="Where image generation is sent"
            onChange={(e) => {
              const next = e.target.value as LlmBackend;
              if (next === imageLlmBackend) return;
              setImageLlmBackend(next);
            }}
          >
            <option value="gemini">Gemini (browser key)</option>
            <option value="openrouter">OpenRouter (dev proxy)</option>
          </select>
        </label>
        {imageLlmBackend === "gemini" ? (
          <label className="settingsPanel__field">
            <span className="settingsPanel__label">Model</span>
            <select
              className="settingsPanel__select"
              value={geminiImageModel}
              disabled={!hasGeminiEnvKey}
              title={geminiImageModel}
              onChange={(e) => {
                const next = e.target.value;
                if (next === geminiImageModel) return;
                setGeminiImageModel(next);
              }}
            >
              {imageModelSelectOptions(geminiImageModel).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <OpenRouterModelField
            kind="image"
            value={openRouterImageModel}
            onChange={setOpenRouterImageModel}
          />
        )}
      </section>
    </div>
  );
}
