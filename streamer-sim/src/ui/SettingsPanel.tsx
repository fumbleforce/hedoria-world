import { useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import type { ContentTier, LogLevel, TextBackend } from "../game/types";
import { PROMPTS, PROMPT_IDS, type PromptId } from "../game/prompts";
import { diag } from "../diag/log";

const TIERS: Array<{ id: ContentTier; label: string; blurb: string }> = [
  { id: "wholesome", label: "Wholesome", blurb: "PG. No flirting, creeps are harmless." },
  { id: "flirty", label: "Flirty", blurb: "Cheeky innuendo, simps, PG-13." },
  { id: "risque", label: "Risqué", blurb: "Bold & suggestive; pushy creeps & stalkers. Implied." },
  { id: "unhinged", label: "No Limits", blurb: "Ceiling removed — anything the player drives can happen. Not forced; just uncapped." },
  { id: "custom", label: "Custom", blurb: "Use your own steering text below." },
];

type Tab = "general" | "prompts";

export function SettingsPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.settingsOpen);
  const [tab, setTab] = useState<Tab>("general");
  if (!open) return null;

  return (
    <div className="modal" onClick={() => useStore.getState().setSettingsOpen(false)}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>⚙ Settings</h2>
          <div className="tabs">
            <button className={`tab ${tab === "general" ? "tab--on" : ""}`} onClick={() => setTab("general")}>
              General
            </button>
            <button className={`tab ${tab === "prompts" ? "tab--on" : ""}`} onClick={() => setTab("prompts")}>
              Prompts
            </button>
          </div>
          <button className="modal__close" onClick={() => useStore.getState().setSettingsOpen(false)}>
            ✕
          </button>
        </div>
        {tab === "general" ? <GeneralTab controller={controller} /> : <PromptsTab />}
      </div>
    </div>
  );
}

function GeneralTab({ controller }: { controller: GameController }) {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const generating = useStore((s) => s.generatingRoom);
  const roomImage = useStore((s) => s.roomImage);

  return (
    <>
      <label className="field">
        <span>Streamer name</span>
        <input value={settings.streamerName} onChange={(e) => set({ streamerName: e.target.value })} />
      </label>

      <label className="field">
        <span>Persona / bio</span>
        <textarea
          rows={3}
          value={settings.streamerPersona}
          onChange={(e) => set({ streamerPersona: e.target.value })}
        />
      </label>

      <div className="field">
        <span>Content intensity</span>
        <div className="tierGrid">
          {TIERS.map((t) => (
            <button
              key={t.id}
              className={`tier ${settings.contentTier === t.id ? "tier--active" : ""}`}
              onClick={() => set({ contentTier: t.id })}
            >
              <b>{t.label}</b>
              <small>{t.blurb}</small>
            </button>
          ))}
        </div>
      </div>

      {settings.contentTier === "custom" && (
        <label className="field">
          <span>Custom steering (injected verbatim into chat/story prompts)</span>
          <textarea
            rows={4}
            value={settings.customSteering}
            placeholder="Describe the tone and direction you want…"
            onChange={(e) => set({ customSteering: e.target.value })}
          />
        </label>
      )}

      <hr className="rule" />

      <label className="field">
        <span>Text backend</span>
        <select value={settings.textBackend} onChange={(e) => set({ textBackend: e.target.value as TextBackend })}>
          <option value="mock">Mock (no key, fully offline)</option>
          <option value="gemini">Gemini (VITE_GEMINI_API_KEY)</option>
          <option value="openrouter">OpenRouter (dev proxy)</option>
        </select>
      </label>

      <div className="field2">
        <label className="field">
          <span>Gemini model</span>
          <input value={settings.geminiModel} onChange={(e) => set({ geminiModel: e.target.value })} />
        </label>
        <label className="field">
          <span>OpenRouter model</span>
          <input value={settings.openRouterModel} onChange={(e) => set({ openRouterModel: e.target.value })} />
        </label>
      </div>

      <hr className="rule" />

      <div className="field">
        <span>Room art (LLM-generated background)</span>
        {roomImage && (
          <img
            src={roomImage}
            alt="generated room"
            style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 10, marginBottom: 8 }}
          />
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn--primary"
            disabled={generating || !controller.canGenerateRoom}
            onClick={() => void controller.generateRoom()}
          >
            {generating ? "Generating…" : roomImage ? "🖼 Regenerate room" : "🖼 Generate room"}
          </button>
          {roomImage && (
            <button className="btn" disabled={generating} onClick={() => controller.clearRoom()}>
              Use default art
            </button>
          )}
        </div>
        {!controller.canGenerateRoom && (
          <span className="hint">
            Set a Gemini or OpenRouter key (Settings backend above) to enable image generation.
          </span>
        )}
      </div>

      <div className="field2">
        <label className="field">
          <span>Gemini image model</span>
          <input value={settings.geminiImageModel} onChange={(e) => set({ geminiImageModel: e.target.value })} />
        </label>
        <label className="field">
          <span>OpenRouter image model</span>
          <input value={settings.openRouterImageModel} onChange={(e) => set({ openRouterImageModel: e.target.value })} />
        </label>
      </div>

      <hr className="rule" />

      <label className="field">
        <span>Console log level</span>
        <select
          value={settings.consoleLevel}
          onChange={(e) => {
            const level = e.target.value as LogLevel;
            set({ consoleLevel: level });
            diag.configure({ consoleLevel: level });
          }}
        >
          <option value="debug">debug (everything)</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error only</option>
        </select>
      </label>

      <p className="hint">
        Changes apply immediately. Open the browser console (F12) to watch the game's
        internals; the same stream is echoed to the dev-server terminal and logs/events.jsonl.
      </p>
    </>
  );
}

function PromptsTab() {
  const overrides = useStore((s) => s.promptOverrides);
  const setOverride = useStore((s) => s.setPromptOverride);
  const [selected, setSelected] = useState<PromptId>(PROMPT_IDS[0]);
  const def = PROMPTS[selected];
  const value = overrides[selected] ?? def.base;
  const isOverridden = overrides[selected] !== undefined;

  return (
    <div className="prompts">
      <div className="prompts__tabs">
        {PROMPT_IDS.map((id) => (
          <button
            key={id}
            className={`tab ${selected === id ? "tab--on" : ""}`}
            onClick={() => setSelected(id)}
          >
            {PROMPTS[id].label}
            {overrides[id] !== undefined ? " ✏️" : ""}
          </button>
        ))}
      </div>
      <p className="hint">{def.description}</p>
      <p className="hint">
        Placeholders <code>{"{{name}}"}</code>, <code>{"{{persona}}"}</code>,{" "}
        <code>{"{{steering}}"}</code> are filled at runtime.
      </p>
      <textarea
        className="prompts__editor"
        rows={16}
        value={value}
        onChange={(e) => setOverride(selected, e.target.value)}
      />
      <div className="prompts__actions">
        <button className="btn" disabled={!isOverridden} onClick={() => setOverride(selected, null)}>
          Reset to default
        </button>
        <span className="hint">{isOverridden ? "Using your override." : "Using built-in default."}</span>
      </div>
    </div>
  );
}
