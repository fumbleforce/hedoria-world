import { useEffect, useState } from "react";
import { useStore, type SettingsTab } from "../state/store";
import type { GameController } from "../game/controller";
import type { ContentTier, LogLevel, TextBackend } from "../game/types";
import { PROMPTS, PROMPT_IDS, type PromptId } from "../game/prompts";
import {
  IMAGE_STYLE_PRESETS,
  clearImagePromptOverrides,
  getImagePreset,
  hasImagePromptOverrides,
  type ImagePromptField,
} from "../llm/imagePresets";
import { useStoredImage } from "../persist/useStoredImage";
import { deleteImagesForSlot, listImages, type ImageKind, type StoredImage } from "../persist/imageStore";
import {
  createAndActivateSlot,
  deleteSlot,
  getActiveSlot,
  listSlots,
  renameSlot,
  setActiveSlot,
  type SaveSlotMeta,
} from "../persist/saves";
import { diag } from "../diag/log";
import { THEMES } from "./themes";

const TIERS: Array<{ id: ContentTier; label: string; blurb: string }> = [
  { id: "wholesome", label: "Wholesome", blurb: "PG. No flirting, creeps are harmless." },
  { id: "flirty", label: "Flirty", blurb: "Cheeky innuendo, simps, PG-13." },
  { id: "risque", label: "Risqué", blurb: "Bold & suggestive; pushy creeps & stalkers. Implied." },
  { id: "unhinged", label: "No Limits", blurb: "Ceiling removed — anything the player drives can happen. Not forced; just uncapped." },
  { id: "custom", label: "Custom", blurb: "Use your own steering text below." },
];

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "prompts", label: "Prompts" },
  { id: "room", label: "Room" },
  { id: "character", label: "Character" },
  { id: "gallery", label: "Gallery" },
  { id: "saves", label: "Saves" },
];

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
            {TABS.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? "tab--on" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <button className="modal__close" onClick={() => useStore.getState().setSettingsOpen(false)}>✕</button>
        </div>
        {tab === "general" && <GeneralTab />}
        {tab === "prompts" && <PromptsTab />}
        {tab === "room" && <RoomTab controller={controller} />}
        {tab === "character" && <CharacterTab controller={controller} />}
        {tab === "gallery" && <GalleryTab controller={controller} />}
        {tab === "saves" && <SavesTab />}
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
        <div className="tierGrid">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`tier themeTier ${settings.theme === t.id ? "tier--active" : ""}`}
              onClick={() => set({ theme: t.id })}
            >
              <span
                className="themeSwatch"
                style={{ background: `linear-gradient(90deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
              />
              <b>{t.label}</b>
              <small>{t.blurb}</small>
            </button>
          ))}
        </div>
      </div>

      <hr className="rule" />

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
        Placeholders like <code>{"{{name}}"}</code>, <code>{"{{description}}"}</code>,{" "}
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

  return (
    <>
      <div className="field">
        <span>Room art (LLM-generated background)</span>
        {roomImage && (
          <img src={roomImage} alt="generated room" className="settings__preview" />
        )}
        <div className="charcre__actions">
          <button
            className={`btn btn--primary ${generating ? "is-loading" : ""}`}
            disabled={generating || !controller.canGenerateRoom}
            onClick={() => void controller.generateRoom()}
          >
            {generating ? "Generating…" : roomImage ? "🖼 Regenerate room" : "🖼 Generate room"}
          </button>
          {roomImage && (
            <button className="btn" disabled={generating} onClick={() => controller.clearRoom()}>Use default art</button>
          )}
        </div>
        {!controller.canGenerateRoom && (
          <span className="hint">Set a Gemini or OpenRouter key (General tab) to enable image generation.</span>
        )}
      </div>
      <p className="hint">Edit the room prompt and the shared image style in the Prompts tab.</p>
    </>
  );
}

function CharacterTab({ controller }: { controller: GameController }) {
  const character = useStore((s) => s.character);
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.setSettings);
  const busy = useStore((s) => s.imageBusy);
  const name = settings.streamerName;
  const [desc, setDesc] = useState(character.description);
  const portrait = useStoredImage(character.portraitId);
  const body = useStoredImage(character.bodyId);
  const canGen = controller.canGenerateImages;

  const gender = settings.gender ?? "";
  const genderMode = gender === "male" ? "male" : gender === "female" ? "female" : "custom";

  return (
    <>
      <label className="field">
        <span>Streamer name</span>
        <input value={settings.streamerName} onChange={(e) => set({ streamerName: e.target.value })} />
      </label>

      <label className="field">
        <span>Persona / bio</span>
        <textarea rows={3} value={settings.streamerPersona} onChange={(e) => set({ streamerPersona: e.target.value })} />
      </label>

      <div className="field">
        <span>Gender</span>
        <div className="genderRow">
          <button className={`tier ${genderMode === "female" ? "tier--active" : ""}`} onClick={() => set({ gender: "female" })}>
            <b>Female</b>
          </button>
          <button className={`tier ${genderMode === "male" ? "tier--active" : ""}`} onClick={() => set({ gender: "male" })}>
            <b>Male</b>
          </button>
          <button
            className={`tier ${genderMode === "custom" ? "tier--active" : ""}`}
            onClick={() => set({ gender: genderMode === "custom" ? gender : "" })}
          >
            <b>Custom</b>
          </button>
        </div>
        {genderMode === "custom" && (
          <input
            style={{ marginTop: 8 }}
            value={gender}
            placeholder="Type a gender / identity (e.g. nonbinary, androgynous…)"
            onChange={(e) => set({ gender: e.target.value })}
          />
        )}
      </div>

      <hr className="rule" />

      <label className="field">
        <span>Describe how {name} looks</span>
        <textarea
          rows={4}
          value={desc}
          placeholder="e.g. early-20s, shoulder-length pink hair, freckles, oversized cozy hoodie, soft makeup, warm smile…"
          onChange={(e) => setDesc(e.target.value)}
        />
      </label>

      <div className="charcre__previews">
        <Preview label="Portrait" src={portrait} />
        <Preview label="Body template" src={body} />
      </div>

      <div className="charcre__actions">
        <button
          className={`btn btn--primary ${busy ? "is-loading" : ""}`}
          disabled={!!busy || !canGen || !desc.trim()}
          onClick={() => void controller.generateCharacter(desc, true)}
          title="Generate a fresh portrait + body template"
        >
          {busy ? busy + "…" : portrait || body ? "Regenerate portrait + body" : "Generate portrait + body"}
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

const KIND_ORDER: ImageKind[] = ["portrait", "body", "presence", "scene", "room"];
const KIND_LABEL: Record<ImageKind, string> = {
  portrait: "Portrait",
  body: "Body templates",
  presence: "Locations & presence",
  scene: "Scenes",
  room: "Room",
};

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
  const groups = KIND_ORDER.map((kind) => ({ kind, items: images.filter((i) => i.kind === kind) })).filter(
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
              <div className="gallery2__groupTitle">{KIND_LABEL[g.kind]}</div>
              <div className="gallery2__grid">
                {g.items.map((img) => (
                  <figure key={img.id} className={`gcard ${activeIds.has(img.id) ? "gcard--active" : ""}`}>
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

function SavesTab() {
  const settings = useStore((s) => s.settings);
  const [slots, setSlots] = useState<SaveSlotMeta[]>(() => listSlots());
  const active = getActiveSlot();

  const refresh = () => setSlots(listSlots());
  useEffect(() => {
    refresh();
  }, []);

  const onCreate = () => {
    const fallback = `Save ${slots.length + 1}`;
    const name = window.prompt("Name for the new save", fallback);
    if (name === null) return;
    createAndActivateSlot(name.trim() || fallback, settings);
    window.location.reload();
  };

  const onLoad = (slotId: string) => {
    if (slotId === active.id) return;
    setActiveSlot(slotId);
    window.location.reload();
  };

  const onRename = (slot: SaveSlotMeta) => {
    const next = window.prompt("Rename save", slot.name);
    if (next === null) return;
    renameSlot(slot.id, next);
    refresh();
  };

  const onDelete = async (slot: SaveSlotMeta) => {
    if (slots.length <= 1) return;
    if (!window.confirm(`Delete "${slot.name}"? This removes its world progress and image library.`)) return;
    await deleteImagesForSlot(slot.id);
    const { deleted } = deleteSlot(slot.id);
    if (!deleted) return;
    if (slot.id === active.id) window.location.reload();
    else refresh();
  };

  return (
    <div className="saves">
      <div className="saves__head">
        <p className="hint">Autosave is always on. Load switches the active save slot.</p>
        <button className="btn btn--primary" onClick={onCreate}>New game</button>
      </div>

      <div className="saves__grid">
        {slots.map((slot) => (
          <div key={slot.id} className={`saveCard ${slot.id === active.id ? "saveCard--active" : ""}`}>
            <SavePortrait slot={slot} />
            <div className="saveCard__meta">
              <div className="saveCard__title">{slot.name}</div>
              <div className="saveCard__line">
                {slot.characterName || "Unknown streamer"} · Day {slot.day}
              </div>
              <div className="saveCard__line">{new Date(slot.updatedAt).toLocaleString()}</div>
            </div>
            <div className="saveCard__actions">
              <button className="btn btn--mini" disabled={slot.id === active.id} onClick={() => onLoad(slot.id)}>
                {slot.id === active.id ? "Active" : "Load"}
              </button>
              <button className="btn btn--mini" onClick={() => onRename(slot)}>Rename</button>
              <button className="btn btn--mini btn--danger" disabled={slots.length <= 1} onClick={() => void onDelete(slot)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavePortrait({ slot }: { slot: SaveSlotMeta }) {
  const src = useStoredImage(slot.portraitId);
  if (!src) return <div className="savePortrait savePortrait--empty">No portrait</div>;
  return <img className="savePortrait" src={src} alt={`${slot.name} portrait`} loading="lazy" />;
}

function PromptsTab() {
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

  const resetAll = () => {
    for (const id of PROMPT_IDS) setOverride(id, null);
    set({ imageStylePreset: "cozy-neon", ...clearImagePromptOverrides() });
  };

  const applyPreset = (id: typeof preset.id) => {
    set({ imageStylePreset: id, ...clearImagePromptOverrides() });
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
          <button key={id} className={`tab ${selected === id ? "tab--on" : ""}`} onClick={() => setSelected(id)}>
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
        {imageOverrides && (
          <p className="hint">Custom edits active on top of <b>{preset.label}</b>. Pick a preset to replace them.</p>
        )}
        <div className="tierGrid">
          {IMAGE_STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`tier themeTier ${settings.imageStylePreset === p.id ? "tier--active" : ""}`}
              onClick={() => applyPreset(p.id)}
            >
              <span
                className="themeSwatch"
                style={{ background: `linear-gradient(90deg, ${p.swatch[0]}, ${p.swatch[1]})` }}
              />
              <b>{p.label}</b>
              <small>{p.blurb}</small>
            </button>
          ))}
        </div>
      </div>

      <p className="hint">
        Shared across every generated image. Placeholders like <code>{"{{style}}"}</code>,{" "}
        <code>{"{{name}}"}</code>, <code>{"{{description}}"}</code>, <code>{"{{zone}}"}</code>,{" "}
        <code>{"{{narrative}}"}</code>, <code>{"{{upgrades}}"}</code> fill at runtime per image.
        Expand any prompt below to tweak it — overrides stack on the preset above.
      </p>
      <PromptEditor
        label="Universal style (shared by all images)"
        value={settings.imageStyle}
        fallback={presetFallback("imageStyle")}
        onChange={(v) => set({ imageStyle: v })}
      />
      <PromptEditor label="Room" value={settings.roomPrompt} fallback={presetFallback("roomPrompt")} onChange={(v) => set({ roomPrompt: v })} />
      <PromptEditor label="Portrait" value={settings.portraitPrompt} fallback={presetFallback("portraitPrompt")} onChange={(v) => set({ portraitPrompt: v })} />
      <PromptEditor label="Body template" value={settings.bodyPrompt} fallback={presetFallback("bodyPrompt")} onChange={(v) => set({ bodyPrompt: v })} />
      <PromptEditor label="Presence (location)" value={settings.presencePrompt} fallback={presetFallback("presencePrompt")} onChange={(v) => set({ presencePrompt: v })} />
      <PromptEditor label="Scene" value={settings.scenePrompt} fallback={presetFallback("scenePrompt")} onChange={(v) => set({ scenePrompt: v })} />
    </div>
  );
}
