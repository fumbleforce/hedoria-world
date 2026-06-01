import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { SETTINGS_TABS } from "../game/settingsTabs";
import { clearLlmStats } from "../llm/stats";
import type { GameController } from "../game/controller";
import type { LogLevel, Metrics, TextBackend } from "../game/types";
import { isNoLimits } from "../game/content";
import { formatClock } from "../game/time";
import { CONTENT_TIERS_SETTINGS } from "../game/content";
import { DIFFICULTY_LEVELS } from "../game/balance";
import { PROMPTS, PROMPT_IDS, type PromptId } from "../game/prompts";
import {
  clearImagePromptOverrides,
  getImagePreset,
  hasImagePromptOverrides,
  isCustomArtStyle,
  type ImagePromptField,
} from "../llm/imagePresets";
import { ArtStylePicker } from "./ArtStylePicker";
import { useStoredImage } from "../persist/useStoredImage";
import { listImages, loadPortrait, IMAGE_KIND_LABEL, IMAGE_KIND_ORDER, type StoredImage } from "../persist/imageStore";
import { GenderPicker } from "./GenderPicker";
import { OptionPick } from "./OptionPick";
import { pickClass } from "./pickClass";
import { relationshipLevel } from "../game/characters";
import { ZONES, type ZoneId } from "../game/studio";
import { RoomMapEditor } from "./RoomMapEditor";
import { BrandTab } from "./BrandFields";
import { diag } from "../diag/log";
import { THEMES } from "./themes";
import { OpenRouterModelField } from "./OpenRouterModelField";

export function SettingsPanel({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.settingsOpen);
  const tab = useStore((s) => s.settingsTab);
  const setTab = useStore((s) => s.setSettingsTab);
  if (!open) return null;

  return (
    <div className="modal" onClick={() => useStore.getState().setSettingsOpen(false)}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>⚙ Settings</h2>
          <div className="tabs">
            {SETTINGS_TABS.map((t) => (
              <button key={t.id} className={pickClass(tab === t.id, "tab")} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <button className="modal__close" onClick={() => useStore.getState().setSettingsOpen(false)}>✕</button>
        </div>
        {tab === "general" && <GeneralTab />}
        {tab === "prompts" && <PromptsTab controller={controller} />}
        {tab === "room" && <RoomTab controller={controller} />}
        {tab === "character" && <CharacterTab controller={controller} />}
        {tab === "brand" && <BrandTab controller={controller} />}
        {tab === "gallery" && <GalleryTab controller={controller} />}
        {tab === "llm" && <LlmTab />}
        {tab === "dev" && <DevTab controller={controller} />}
      </div>
    </div>
  );
}

function GeneralTab() {
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);

  return (
    <>
      <div className="field">
        <span>Color theme</span>
        <div className="pickGrid">
          {THEMES.map((t) => (
            <OptionPick
              key={t.id}
              className="themeTier"
              selected={settings.theme === t.id}
              onClick={() => set({ theme: t.id })}
            >
              <span
                className="themeSwatch"
                style={{ background: `linear-gradient(90deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
              />
              <b>{t.label}</b>
              <small>{t.blurb}</small>
            </OptionPick>
          ))}
        </div>
      </div>

      <hr className="rule" />

      <div className="field">
        <span>Content intensity</span>
        <div className="pickGrid">
          {CONTENT_TIERS_SETTINGS.map((t) => (
            <OptionPick
              key={t.id}
              selected={settings.contentTier === t.id}
              onClick={() => set({ contentTier: t.id })}
            >
              <b>{t.label}</b>
              <small>{t.blurb}</small>
            </OptionPick>
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

      <div className="field">
        <span>Difficulty</span>
        <div className="pickGrid">
          {(DIFFICULTY_LEVELS).map((d) => (
            <OptionPick
              key={d.id}
              selected={(settings.difficulty ?? "normal") === d.id}
              onClick={() => set({ difficulty: d.id })}
            >
              <b>{d.label}</b>
              <small>{d.blurb}</small>
            </OptionPick>
          ))}
        </div>
        <p className="hint">
          Applies to economy and survival pressure immediately. Starting cash and followers apply on new games.
        </p>
      </div>

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
        <OpenRouterModelField
          kind="text"
          label="OpenRouter model"
          value={settings.openRouterModel}
          onChange={(openRouterModel) => set({ openRouterModel })}
        />
      </div>

      <div className="field2">
        <label className="field">
          <span>Gemini image model</span>
          <input value={settings.geminiImageModel} onChange={(e) => set({ geminiImageModel: e.target.value })} />
        </label>
        <OpenRouterModelField
          kind="image"
          label="OpenRouter image model"
          value={settings.openRouterImageModel}
          onChange={(openRouterImageModel) => set({ openRouterImageModel })}
        />
      </div>

      <hr className="rule" />

      <label className="toggleRow">
        <input type="checkbox" checked={settings.tieredModels} onChange={(e) => set({ tieredModels: e.target.checked })} />
        <span>
          <b>Two-tier model routing</b>
          <small>Use a cheap/fast model for chat bursts; the main model above handles the evaluator, narration & DMs.</small>
        </span>
      </label>

      {settings.tieredModels && (
        <div className="field2">
          <label className="field">
            <span>Gemini fast (chat) model</span>
            <input value={settings.geminiFastModel} onChange={(e) => set({ geminiFastModel: e.target.value })} />
          </label>
          <OpenRouterModelField
            kind="text"
            label="OpenRouter fast (chat) model"
            value={settings.openRouterFastModel}
            onChange={(openRouterFastModel) => set({ openRouterFastModel })}
          />
        </div>
      )}

      <label className="toggleRow">
        <input type="checkbox" checked={settings.selfConsistency} onChange={(e) => set({ selfConsistency: e.target.checked })} />
        <span>
          <b>Self-consistency on big beats</b>
          <small>For high-impact actions, sample the verdict twice and reconcile so one odd read can't swing the economy.</small>
        </span>
      </label>

      <label className="toggleRow">
        <input type="checkbox" checked={settings.streamReplies} onChange={(e) => set({ streamReplies: e.target.checked })} />
        <span>
          <b>Stream DM replies</b>
          <small>Type direct-message replies out progressively instead of appearing in one lump.</small>
        </span>
      </label>

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

      <label className="field">
        <span>Streamer birthday (MM-DD, optional)</span>
        <input
          value={settings.streamerBirthday}
          placeholder="e.g. 03-14 — triggers a birthday stream"
          onChange={(e) => set({ streamerBirthday: e.target.value })}
        />
      </label>

      <p className="hint">
        Changes apply immediately. Open the browser console (F12) to watch the game's internals.
      </p>
    </>
  );
}

/** A collapsible image-prompt editor bound to a settings field. */
function PromptEditor({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  const stored = value ?? "";
  const overridden = stored.trim() !== "";
  // Show the real prompt text being used (the default when there's no override),
  // so the user edits the actual prompt rather than a blank box.
  const display = overridden ? stored : fallback;
  return (
    <details className="collapsible">
      <summary>{label}{overridden ? " ✏️" : ""}</summary>
      <p className="hint">
        Placeholders like <code>{"{{name}}"}</code>, <code>{"{{faceDescription}}"}</code>,{" "}
        <code>{"{{bodyDescription}}"}</code>, <code>{"{{description}}"}</code> (combined),{" "}
        <code>{"{{upgrades}}"}</code> fill at runtime. Edit freely; Reset restores the preset default.
      </p>
      <textarea
        className="prompts__editor"
        rows={8}
        value={display}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="prompts__actions">
        <button className="btn" disabled={!overridden} onClick={() => onChange("")}>Reset to preset</button>
        <span className="hint">{overridden ? "Using your custom prompt." : "Using the preset default."}</span>
      </div>
    </details>
  );
}

function RoomTab({ controller }: { controller: GameController }) {
  const generating = useStore((s) => s.generatingRoom);
  const roomImage = useStore((s) => s.roomImage);
  const imageBusy = useStore((s) => s.imageBusy);
  const cornerCount = useStore((s) => Object.keys(s.cornerImages).length);
  const backdropCount = useStore((s) => Object.keys(s.zoneBackdrops).length);
  const busy = generating || !!imageBusy;
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);

  return (
    <>
      <div className="field">
        <span>Room map</span>
        <RoomMapEditor roomImage={roomImage} onEnlarge={(src, label) => setLightbox({ src, label })} />
        <div className="charcre__actions">
          <button
            className={`btn btn--primary ${generating ? "is-loading" : ""}`}
            disabled={busy || !controller.canGenerateRoom}
            onClick={() => void controller.generateRoom()}
          >
            {generating ? "Generating…" : roomImage ? "🖼 Regenerate room" : "🖼 Generate room"}
          </button>
          {roomImage && (
            <button className="btn" disabled={busy} onClick={() => controller.clearRoom()}>Use default art</button>
          )}
        </div>
        {!controller.canGenerateRoom && (
          <span className="hint">Set a Gemini or OpenRouter key (General tab) to enable image generation.</span>
        )}
      </div>
      <div className="field">
        <span>Furniture (eye-level)</span>
        <div className="settings__angles">
          {(Object.keys(ZONES) as ZoneId[]).map((zoneId) => (
            <ZoneRoomThumb
              key={`corner-${zoneId}`}
              zoneId={zoneId}
              useCorner
              busy={busy}
              controller={controller}
              onEnlarge={(src, label) => setLightbox({ src, label })}
            />
          ))}
        </div>
        <span className="hint">
          Single-furniture corner photos, matched to your room art when generated.{" "}
          {cornerCount > 0 ? `${cornerCount}/6 generated.` : "None generated yet."}{" "}
          Regenerate an angle after updating its furniture.
        </span>
      </div>
      <div className="field">
        <span>Cam angles (eye-level room views)</span>
        <div className="settings__angles">
          {(Object.keys(ZONES) as ZoneId[]).map((zoneId) => (
            <ZoneRoomThumb
              key={`angle-${zoneId}`}
              zoneId={zoneId}
              useCorner={false}
              busy={busy}
              controller={controller}
              onEnlarge={(src, label) => setLightbox({ src, label })}
            />
          ))}
        </div>
        <div className="charcre__actions">
          <button
            className={`btn ${imageBusy ? "is-loading" : ""}`}
            disabled={busy || !controller.canGenerateImages}
            onClick={() => void controller.regenerateZoneBackdrops()}
          >
            {imageBusy ? "Generating…" : "🎥 Regenerate all"}
          </button>
        </div>
        <span className="hint">
          Composed room views from visible furniture corners, used in the live cam feed.{" "}
          {backdropCount > 0 ? `${backdropCount}/6 generated.` : "None generated yet."}
        </span>
      </div>
      <p className="hint">Edit the room prompt and the shared image style in the Prompts tab.</p>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt={lightbox.label} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox__cap">{lightbox.label}</div>
        </div>
      )}
    </>
  );
}

function ZoneRoomThumb({
  zoneId,
  useCorner,
  busy,
  controller,
  onEnlarge,
}: {
  zoneId: ZoneId;
  useCorner: boolean;
  busy: boolean;
  controller: GameController;
  onEnlarge: (src: string, label: string) => void;
}) {
  const imageId = useStore((s) => (useCorner ? s.cornerImages[zoneId] : s.zoneBackdrops[zoneId]));
  const src = useStoredImage(imageId);
  const label = ZONES[zoneId]?.label ?? zoneId;
  const regenLabel = useCorner ? "Regenerate furniture" : "Regenerate angle";

  return (
    <figure className="settings__angle">
      {src ? (
        <button
          type="button"
          className="settings__angle-imgbtn"
          onClick={() => onEnlarge(src, label)}
          title="Click to enlarge"
        >
          <img src={src} alt={label} loading="lazy" />
        </button>
      ) : (
        <div className="settings__angle-empty">not generated</div>
      )}
      <figcaption>{label}</figcaption>
      <button
        type="button"
        className="settings__angle-regen"
        disabled={busy || !controller.canGenerateImages}
        title={regenLabel}
        onClick={() =>
          void (useCorner ? controller.regenerateCorner(zoneId) : controller.regeneratePerspective(zoneId))
        }
      >
        ↻
      </button>
    </figure>
  );
}

function CharacterTab({ controller }: { controller: GameController }) {
  const character = useStore((s) => s.character);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const setCharacter = useStore((s) => s.setCharacter);
  const busy = useStore((s) => s.imageBusy);
  const name = settings.streamerName;
  const [faceDesc, setFaceDesc] = useState(character.faceDescription);
  const [bodyDesc, setBodyDesc] = useState(character.bodyDescription);
  // Persist description edits to the store as the player types so they survive
  // closing/reopening the panel, even without regenerating the images.
  const editFaceDesc = (value: string) => {
    setFaceDesc(value);
    setCharacter({ faceDescription: value });
  };
  const editBodyDesc = (value: string) => {
    setBodyDesc(value);
    setCharacter({ bodyDescription: value });
  };
  const portrait = useStoredImage(character.portraitId);
  const body = useStoredImage(character.bodyId);
  const canGen = controller.canGenerateImages;

  return (
    <>
      <label className="field">
        <span>Character name (private)</span>
        <input value={settings.streamerName} onChange={(e) => set({ streamerName: e.target.value })} />
      </label>

      <label className="field">
        <span>Persona / bio</span>
        <textarea rows={3} value={settings.streamerPersona} onChange={(e) => set({ streamerPersona: e.target.value })} />
      </label>

      <div className="field">
        <span>Gender</span>
        <GenderPicker
          gender={settings.gender ?? ""}
          onChange={(gender) => set({ gender })}
          customPlaceholder="Type a gender / identity (e.g. nonbinary, androgynous…)"
        />
      </div>

      <hr className="rule" />

      <label className="field">
        <span>Face — eyes, makeup, expression</span>
        <textarea
          rows={3}
          value={faceDesc}
          placeholder="e.g. warm brown eyes, light freckles, soft natural makeup, warm smile…"
          onChange={(e) => editFaceDesc(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Body — hair, build, silhouette</span>
        <textarea
          rows={3}
          value={bodyDesc}
          placeholder="e.g. early 20s, shoulder-length pink hair, petite build, cute energy…"
          onChange={(e) => editBodyDesc(e.target.value)}
        />
      </label>

      <div className="charcre__previews">
        <Preview label="Portrait" src={portrait} />
        <Preview label="Body template" src={body} />
      </div>

      <div className="charcre__actions">
        <button
          className={`btn btn--primary ${busy ? "is-loading" : ""}`}
          disabled={!!busy || !canGen || (!faceDesc.trim() && !bodyDesc.trim())}
          onClick={() => void controller.generateCharacter(faceDesc, bodyDesc, true)}
          title="Generate a fresh portrait + body template"
        >
          {busy ? busy + "…" : portrait || body ? "Regenerate portrait + body" : "Generate portrait + body"}
        </button>
        <button
          className={`btn ${busy ? "is-loading" : ""}`}
          disabled={!!busy || !canGen || !bodyDesc.trim()}
          onClick={() => void controller.generateCharacterBodyOnly(bodyDesc, true)}
          title="Regenerate only the body template (uses current portrait and equipped clothing)"
        >
          {body ? "Regenerate body only" : "Generate body only"}
        </button>
      </div>
      {!canGen && (
        <span className="hint">Set a Gemini or OpenRouter key (General tab) to enable image generation.</span>
      )}
      <p className="hint">
        The body template is reused as a reference so {name} stays consistent in scene and location
        images. All generated images are saved to the Gallery.
      </p>
      <p className="hint">Edit the portrait, body, and shared image style prompts in the Prompts tab.</p>
    </>
  );
}

function Preview({ label, src }: { label: string; src: string | null | undefined }) {
  return (
    <div className="charcre__preview">
      <span className="charcre__previewLabel">{label}</span>
      {src ? <img src={src} alt={label} /> : <div className="charcre__placeholder">not generated yet</div>}
    </div>
  );
}

function GalleryTab({ controller }: { controller: GameController }) {
  const busy = useStore((s) => s.imageBusy);
  const character = useStore((s) => s.character);
  const presenceImages = useStore((s) => s.presenceImages);
  const [images, setImages] = useState<StoredImage[]>([]);
  const [lightbox, setLightbox] = useState<StoredImage | null>(null);

  const reload = () => void listImages().then(setImages);
  useEffect(() => { reload(); }, [busy]);

  const activeIds = new Set(
    [character.portraitId, character.bodyId, ...Object.values(presenceImages)].filter(Boolean) as string[],
  );
  const groups = IMAGE_KIND_ORDER.map((kind) => ({ kind, items: images.filter((i) => i.kind === kind) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="gallery2">
      {images.length === 0 ? (
        <p className="rail__empty">
          No images yet. Create your character (Character tab) and visualize scenes/locations — they all
          get stored here.
        </p>
      ) : (
        <div className="gallery2__scroll">
          {groups.map((g) => (
            <div key={g.kind} className="gallery2__group">
              <div className="gallery2__groupTitle">{IMAGE_KIND_LABEL[g.kind]}</div>
              <div className="gallery2__grid">
                {g.items.map((img) => (
                  <figure key={img.id} className={pickClass(activeIds.has(img.id), "gcard")}>
                    <button className="gcard__imgbtn" onClick={() => setLightbox(img)}>
                      <img src={img.dataUrl} alt={img.label} loading="lazy" />
                    </button>
                    <figcaption className="gcard__cap" title={img.label}>{img.label}</figcaption>
                    <div className="gcard__actions">
                      <button className={`chiplink ${busy ? "is-loading" : ""}`} disabled={!!busy} onClick={async () => { await controller.regenerateImage(img); reload(); }}>regen</button>
                      {(img.kind === "portrait" || img.kind === "body" || img.kind === "presence") && !activeIds.has(img.id) && (
                        <button className="chiplink" onClick={() => controller.setActiveImage(img)}>use</button>
                      )}
                      <button className="chiplink chiplink--danger" onClick={async () => { await controller.deleteImage(img); reload(); }}>delete</button>
                    </div>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.dataUrl} alt={lightbox.label} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox__cap">{lightbox.label}</div>
        </div>
      )}
    </div>
  );
}

const KIND_TITLE: Record<string, string> = {
  chat: "Chat bursts",
  story: "Evaluator / narration / DMs",
  other: "Other",
};

function LlmTab() {
  const stats = useStore((s) => s.llmStats);
  const [selected, setSelected] = useState<string | null>(null);
  const active = stats.find((s) => s.kind === selected) ?? stats[0] ?? null;

  return (
    <div className="llmtab">
      <div className="saves__head">
        <p className="hint">
          Live per-call telemetry for this session — latency, rough token counts (~4 chars/token), and the
          raw prompt/response of the most recent call of each kind. Resets on reload.
        </p>
        <button className="btn" onClick={() => clearLlmStats()}>Clear</button>
      </div>

      {stats.length === 0 ? (
        <p className="rail__empty">No LLM calls yet this session. Go live and take an action.</p>
      ) : (
        <>
          <div className="llmStats">
            {stats.map((s) => (
              <button
                key={s.kind}
                className={pickClass(active?.kind === s.kind, `llmStat ${s.ok ? "" : "llmStat--err"}`)}
                onClick={() => setSelected(s.kind)}
              >
                <b>{KIND_TITLE[s.kind] ?? s.kind}</b>
                <span className="llmStat__model">{s.model}</span>
                <span className="llmStat__nums">
                  {s.durationMs} ms · {s.promptTokens}→{s.responseTokens} tok · ×{s.count}
                </span>
                {!s.ok && <span className="llmStat__err">error</span>}
              </button>
            ))}
          </div>

          {active && (
            <div className="llmRaw">
              <div className="prompts__group">Last {KIND_TITLE[active.kind] ?? active.kind} prompt</div>
              {active.error && <p className="hint llmStat__err">Error: {active.error}</p>}
              <textarea className="prompts__editor" rows={10} readOnly value={active.rawPrompt} />
              <div className="prompts__group">Last response</div>
              <textarea className="prompts__editor" rows={10} readOnly value={active.rawResponse || "(empty)"} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PromptsTab({ controller }: { controller: GameController }) {
  const overrides = useStore((s) => s.promptOverrides);
  const setOverride = useStore((s) => s.setPromptOverride);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const [selected, setSelected] = useState<PromptId>(PROMPT_IDS[0]);
  const def = PROMPTS[selected];
  const value = overrides[selected] ?? def.base;
  const isOverridden = overrides[selected] !== undefined;
  const preset = getImagePreset(settings.imageStylePreset);
  const imageOverrides = hasImagePromptOverrides(settings);
  const isCustom = isCustomArtStyle(settings.imageStylePreset);

  const resetAll = () => {
    for (const id of PROMPT_IDS) setOverride(id, null);
    set({ imageStylePreset: "cozy-neon", ...clearImagePromptOverrides() });
  };

  const presetFallback = (field: ImagePromptField) => getImagePreset(settings.imageStylePreset)[field];

  return (
    <div className="prompts">
      <div className="prompts__resetAll">
        <button className="btn" onClick={resetAll}>↺ Reset all prompts to defaults</button>
      </div>

      <div className="prompts__group">Story prompts</div>
      <div className="prompts__tabs">
        {PROMPT_IDS.map((id) => (
          <button key={id} className={pickClass(selected === id, "tab")} onClick={() => setSelected(id)}>
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
      <textarea className="prompts__editor" rows={14} value={value} onChange={(e) => setOverride(selected, e.target.value)} />
      <div className="prompts__actions">
        <button className="btn" disabled={!isOverridden} onClick={() => setOverride(selected, null)}>Reset to default</button>
        <span className="hint">{isOverridden ? "Using your override." : "Using built-in default."}</span>
      </div>

      <hr className="rule" />

      <div className="prompts__group">Image prompts</div>
      <div className="field">
        <span>Art style preset</span>
        {imageOverrides && !isCustom && (
          <p className="hint">Custom edits active on top of <b>{preset.label}</b>. Pick a preset to replace them.</p>
        )}
        {isCustom && (
          <p className="hint">Using your custom style description for all generated images.</p>
        )}
        <ArtStylePicker controller={controller} showCustomHint={false} />
      </div>

      <p className="hint">
        Shared across every generated image. Placeholders like <code>{"{{style}}"}</code>,{" "}
        <code>{"{{name}}"}</code>, <code>{"{{faceDescription}}"}</code>, <code>{"{{bodyDescription}}"}</code>,{" "}
        <code>{"{{description}}"}</code>, <code>{"{{zone}}"}</code>,{" "}
        <code>{"{{narrative}}"}</code>, <code>{"{{upgrades}}"}</code> fill at runtime per image.
        Expand any prompt below to tweak it — overrides stack on the preset above.
      </p>
      {!isCustom && (
        <PromptEditor
          label="Universal style (shared by all images)"
          value={settings.imageStyle}
          fallback={presetFallback("imageStyle")}
          onChange={(v) => set({ imageStyle: v })}
        />
      )}
      <PromptEditor label="Room" value={settings.roomPrompt} fallback={presetFallback("roomPrompt")} onChange={(v) => set({ roomPrompt: v })} />
      <PromptEditor label="Portrait" value={settings.portraitPrompt} fallback={presetFallback("portraitPrompt")} onChange={(v) => set({ portraitPrompt: v })} />
      <PromptEditor label="Body template" value={settings.bodyPrompt} fallback={presetFallback("bodyPrompt")} onChange={(v) => set({ bodyPrompt: v })} />
      <PromptEditor label="Presence (location)" value={settings.presencePrompt} fallback={presetFallback("presencePrompt")} onChange={(v) => set({ presencePrompt: v })} />
      <PromptEditor label="Scene" value={settings.scenePrompt} fallback={presetFallback("scenePrompt")} onChange={(v) => set({ scenePrompt: v })} />
    </div>
  );
}

// --- Dev tools --------------------------------------------------------------

type DevMetricDef = {
  key: keyof Metrics;
  label: string;
  format: (v: number) => string;
  steps: number[];
};

const DEV_METRICS: DevMetricDef[] = [
  { key: "cash", label: "Cash", format: (v) => `$${v.toFixed(0)}`, steps: [-1000, -100, 100, 1000] },
  { key: "followers", label: "Followers", format: (v) => v.toLocaleString(), steps: [-1000, -100, -10, 10, 100, 1000] },
  { key: "subscribers", label: "Subs", format: (v) => v.toLocaleString(), steps: [-1000, -100, -10, 10, 100, 1000] },
  { key: "currentViewers", label: "Viewers", format: (v) => v.toLocaleString(), steps: [-100, -10, 10, 100] },
  { key: "peakViewers", label: "Peak viewers", format: (v) => v.toLocaleString(), steps: [-100, -10, 10, 100] },
  { key: "hype", label: "Hype", format: (v) => String(Math.round(v)), steps: [-25, -10, 10, 25] },
  { key: "energy", label: "Energy", format: (v) => String(Math.round(v)), steps: [-25, -10, 10, 25] },
  { key: "comfort", label: "Comfort", format: (v) => String(Math.round(v)), steps: [-25, -10, 10, 25] },
  { key: "hunger", label: "Hunger", format: (v) => String(Math.round(v)), steps: [-25, -10, 10, 25] },
  { key: "bladder", label: "Bladder", format: (v) => String(Math.round(v)), steps: [-25, -10, 10, 25] },
  { key: "hygiene", label: "Hygiene", format: (v) => String(Math.round(v)), steps: [-25, -10, 10, 25] },
  { key: "horny", label: "Horny", format: (v) => String(Math.round(v)), steps: [-25, -10, 10, 25] },
  { key: "day", label: "Day", format: (v) => String(v), steps: [-1, 1] },
];

const DEV_CLOCK_STEPS = [-120, -30, 30, 60, 240] as const;

function devStepLabel(delta: number, cash = false): string {
  const sign = delta < 0 ? "−" : "+";
  const abs = Math.abs(delta);
  if (cash) {
    if (abs >= 1000) return `${sign}$${abs / 1000}k`;
    return `${sign}$${abs}`;
  }
  if (abs >= 1000) return `${sign}${abs / 1000}k`;
  return `${sign}${abs}`;
}

function devClockStepLabel(deltaMinutes: number): string {
  const sign = deltaMinutes < 0 ? "−" : "+";
  const abs = Math.abs(deltaMinutes);
  if (abs % 60 === 0) return `${sign}${abs / 60}h`;
  return `${sign}${abs}m`;
}

/**
 * Debugging cheats: list every known character and fire the systems (visit,
 * tip, affinity, threat…) directly, so behaviour can be tested without grinding.
 */
function DevTab({ controller }: { controller: GameController }) {
  const roster = useStore((s) => s.roster);
  const visitor = useStore((s) => s.visitor);
  const isLive = useStore((s) => s.session.isLive);
  const metrics = useStore((s) => s.metrics);
  const clock = useStore((s) => s.clock);
  const contentTier = useStore((s) => s.settings.contentTier);

  const chars = Object.values(roster).sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return b.affinity - a.affinity;
  });

  const devMode = useStore((s) => s.settings.devMode);
  const set = useStore((s) => s.setSettings);
  const metricRows = DEV_METRICS.filter((m) => m.key !== "horny" || isNoLimits(contentTier));

  return (
    <div className="dev">
      <label className="dev__toggle">
        <input
          type="checkbox"
          checked={devMode}
          onChange={(e) => set({ devMode: e.target.checked })}
        />
        Show backend / derived numbers in Stats panel
      </label>
      <p className="hint">
        Testing cheats. These fire the real game systems directly — no DM grind required.
        {isLive && <> Some actions (like Visit) need you offline.</>}
      </p>

      <section className="dev__metrics">
        <h3 className="dev__section-title">Metrics</h3>
        <div className="dev__metric-list">
          {metricRows.map((m) => (
            <div key={m.key} className="dev__metric-row">
              <div className="dev__metric-label">
                <span>{m.label}</span>
                <strong>{m.format(metrics[m.key])}</strong>
              </div>
              <div className="dev__btns">
                {m.steps.map((step) => (
                  <button
                    key={step}
                    className="btn btn--mini"
                    onClick={() => controller.devAdjustMetric(m.key, step)}
                  >
                    {devStepLabel(step, m.key === "cash")}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="dev__metric-row">
            <div className="dev__metric-label">
              <span>Clock</span>
              <strong>{formatClock(clock)}</strong>
            </div>
            <div className="dev__btns">
              {DEV_CLOCK_STEPS.map((step) => (
                <button
                  key={step}
                  className="btn btn--mini"
                  onClick={() => controller.devAdjustClock(step)}
                >
                  {devClockStepLabel(step)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="dev__actions">
        <button className="btn" onClick={() => controller.devSpawnViewer()}>＋ Spawn random viewer</button>
        <span className="dev__count">{chars.length} known</span>
      </div>

      {chars.length === 0 ? (
        <p className="rail__empty">No characters yet. Spawn one above.</p>
      ) : (
        <div className="dev__list">
          {chars.map((c) => {
            const busyVisit = !!visitor || isLive;
            return (
              <div key={c.id} className="dev__row">
                <DevAvatar id={c.id} hasPortrait={c.hasPortrait} fallback={c.handle.slice(0, 2).toUpperCase()} />
                <div className="dev__who">
                  <div className="dev__name">
                    {c.displayName || c.handle}
                    {c.online && <span className="card__dot" title="online" />}
                  </div>
                  <div className="dev__stats">
                    {relationshipLevel(c.affinity)} · aff {Math.round(c.affinity)} · threat {c.threat}
                    {c.relationship !== "none" && <> · {c.relationship}</>}
                  </div>
                </div>
                <div className="dev__btns">
                  <button className="btn btn--mini" disabled={busyVisit} title={busyVisit ? "Go offline & end any visit first" : "Start an in-person visit"} onClick={() => controller.devStartVisit(c.id)}>🏠 Visit</button>
                  <button className="btn btn--mini" onClick={() => controller.devTip(c.id, 20)}>💸 Tip $20</button>
                  <button className="btn btn--mini" onClick={() => controller.devAddAffinity(c.id, 10)}>＋10 aff</button>
                  <button className="btn btn--mini" onClick={() => controller.devSetThreat(c.id, c.threat >= 3 ? 0 : c.threat + 1)} title="Cycle threat 0→3">⚠ {c.threat}</button>
                  <button className="btn btn--mini" onClick={() => controller.devToggleOnline(c.id)}>{c.online ? "● On" : "○ Off"}</button>
                  <button className="btn btn--mini" onClick={() => controller.openCharacter(c.id)}>Sheet</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DevAvatar({ id, hasPortrait, fallback }: { id: string; hasPortrait: boolean; fallback: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (hasPortrait) void loadPortrait(id).then((u) => { if (alive) setUrl(u); });
    else setUrl(null);
    return () => { alive = false; };
  }, [id, hasPortrait]);
  return (
    <span className="dev__avatar">
      {url ? <img src={url} alt={fallback} /> : <span>{fallback}</span>}
    </span>
  );
}
