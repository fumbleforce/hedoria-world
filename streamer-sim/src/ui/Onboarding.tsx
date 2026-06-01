import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import type { ContentTier } from "../game/types";
import { IMAGE_STYLE_PRESETS } from "../llm/imagePresets";
import { clearImagePromptOverrides, type ImageStylePresetId } from "../llm/imagePresets";
import { CHARACTER_PRESETS, type CharacterPreset } from "../game/characterPresets";
import { useStoredImage } from "../persist/useStoredImage";

const TIERS: Array<{ id: ContentTier; label: string; blurb: string }> = [
  { id: "wholesome", label: "Wholesome", blurb: "PG. No flirting, creeps are harmless." },
  { id: "flirty", label: "Flirty", blurb: "Cheeky innuendo, simps, PG-13." },
  { id: "risque", label: "Risqué", blurb: "Bold & suggestive; pushy creeps & stalkers. Implied." },
  { id: "unhinged", label: "No Limits", blurb: "Ceiling removed — anything the player drives can happen. Not forced; just uncapped." },
  { id: "custom", label: "Custom", blurb: "Use your own steering text below." },
];

const STEP_LABELS = ["Intensity", "Art style", "Character", "Room"] as const;

/**
 * First-run start-up flow for a brand-new save. Forces the player through the
 * four setup choices (intensity → art style → character → room) before the game
 * proper is reachable. Every step has a default so it can be completed without an
 * API key; image generation is offered but never required. Mounts as a full-page
 * overlay below the Settings modal so "Advanced — edit prompts" can layer on top.
 */
export function Onboarding({ controller }: { controller: GameController }) {
  const [step, setStep] = useState(0);
  const last = STEP_LABELS.length - 1;

  const finish = () => useStore.getState().setOnboarded(true);

  return (
    <div className="onboard">
      <div className="onboard__card">
        <div className="onboard__head">
          <h1>◉ Welcome to Limelight</h1>
          <p className="hint">Let's set up your stream. You can go back and change anything before you start.</p>
          <ol className="onboard__steps">
            {STEP_LABELS.map((label, i) => (
              <li
                key={label}
                className={`onboard__step ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}
                onClick={() => i <= step && setStep(i)}
              >
                <span className="onboard__stepNum">{i < step ? "✓" : i + 1}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="onboard__body">
          {step === 0 && <IntensityStep />}
          {step === 1 && <ArtStyleStep controller={controller} />}
          {step === 2 && <CharacterStep controller={controller} />}
          {step === 3 && <RoomStep controller={controller} />}
        </div>

        <div className="onboard__foot">
          <button
            className="btn"
            onClick={() => useStore.getState().openSettings("prompts")}
            title="Advanced: edit the underlying image & story prompts"
          >
            ⚙ Advanced — edit prompts
          </button>
          <div className="onboard__nav">
            <button className="btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              ← Back
            </button>
            {step < last ? (
              <button className="btn btn--primary" onClick={() => setStep((s) => Math.min(last, s + 1))}>
                Next →
              </button>
            ) : (
              <button className="btn btn--primary" onClick={finish}>
                Start streaming →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IntensityStep() {
  const tier = useStore((s) => s.settings.contentTier);
  const steering = useStore((s) => s.settings.customSteering);
  const set = useStore((s) => s.setSettings);
  return (
    <div className="onboard__pane">
      <h2>Pick your content intensity</h2>
      <p className="hint">Sets the ceiling on how far things can escalate — not a floor. You can change it later in Settings.</p>
      <div className="tierGrid">
        {TIERS.map((t) => (
          <button
            key={t.id}
            className={`tier ${tier === t.id ? "tier--active" : ""}`}
            onClick={() => set({ contentTier: t.id })}
          >
            <b>{t.label}</b>
            <small>{t.blurb}</small>
          </button>
        ))}
      </div>
      {tier === "custom" && (
        <label className="field">
          <span>Custom steering (injected verbatim into chat/story prompts)</span>
          <textarea
            rows={4}
            value={steering}
            placeholder="Describe the tone and direction you want…"
            onChange={(e) => set({ customSteering: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}

function ArtStyleStep({ controller }: { controller: GameController }) {
  const presetId = useStore((s) => s.settings.imageStylePreset);
  const set = useStore((s) => s.setSettings);
  const previews = useStore((s) => s.stylePreviews);
  const imageBusy = useStore((s) => s.imageBusy);
  const canGen = controller.canGenerateImages;
  const missingPreviews = IMAGE_STYLE_PRESETS.some((p) => !previews[p.id]);

  useEffect(() => {
    void controller.hydrateStylePreviews();
  }, [controller]);

  const applyPreset = (id: ImageStylePresetId) => {
    set({ imageStylePreset: id, ...clearImagePromptOverrides() });
  };

  return (
    <div className="onboard__pane">
      <h2>Choose an art style</h2>
      <p className="hint">Every generated image — your portrait, room, and scenes — uses this look.</p>
      {canGen ? (
        <div className="stylePreset__bar">
          <button
            className="btn btn--mini"
            disabled={!!imageBusy}
            onClick={() => void controller.generateAllStylePreviews(!missingPreviews)}
          >
            {imageBusy ? `${imageBusy}…` : missingPreviews ? "🖼 Generate previews" : "↻ Regenerate previews"}
          </button>
          <span className="hint">Renders each style with the same subject so you can compare them.</span>
        </div>
      ) : (
        <p className="hint">Add a Gemini or OpenRouter key (Settings → General) to generate visual previews.</p>
      )}
      <div className="stylePresetGrid">
        {IMAGE_STYLE_PRESETS.map((p) => {
          const active = presetId === p.id;
          const preview = previews[p.id];
          return (
            <div
              key={p.id}
              className={`stylePreset ${active ? "stylePreset--active" : ""}`}
              onClick={() => applyPreset(p.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") applyPreset(p.id); }}
            >
              <div className="stylePreset__thumb">
                {preview ? (
                  <img src={preview} alt={`${p.label} style preview`} />
                ) : (
                  <span
                    className="stylePreset__placeholder"
                    style={{ background: `linear-gradient(135deg, ${p.swatch[0]}, ${p.swatch[1]})` }}
                  >
                    no preview
                  </span>
                )}
                {canGen && (
                  <button
                    className="stylePreset__gen"
                    disabled={!!imageBusy}
                    title={preview ? "Regenerate this preview" : "Generate this preview"}
                    onClick={(e) => { e.stopPropagation(); void controller.generateStylePreview(p.id, !!preview); }}
                  >
                    {preview ? "↻" : "👁"}
                  </button>
                )}
              </div>
              <b>{p.label}</b>
              <small>{p.blurb}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CharacterStep({ controller }: { controller: GameController }) {
  const settings = useStore((s) => s.settings);
  const character = useStore((s) => s.character);
  const set = useStore((s) => s.setSettings);
  const setCharacter = useStore((s) => s.setCharacter);
  const busy = useStore((s) => s.imageBusy);
  const portrait = useStoredImage(character.portraitId);
  const body = useStoredImage(character.bodyId);
  const canGen = controller.canGenerateImages;

  const [hint, setHint] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const gender = settings.gender ?? "";
  const genderMode = gender === "male" ? "male" : gender === "female" ? "female" : "custom";

  const applyPreset = (p: CharacterPreset) => {
    set({ streamerName: p.name, gender: p.gender, streamerPersona: p.persona, niche: p.niche, outfit: p.outfit });
    setCharacter({ faceDescription: p.faceDescription, bodyDescription: p.bodyDescription });
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const out = await controller.suggestCharacter(settings.streamerName, hint);
      if (out) {
        set({ streamerPersona: out.persona });
        setCharacter({
          faceDescription: out.faceDescription || character.faceDescription,
          bodyDescription: out.bodyDescription || character.bodyDescription,
        });
      }
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="onboard__pane">
      <h2>Create your streamer</h2>

      <div className="field">
        <span>Quick-start presets</span>
        <div className="onboard__presets">
          {CHARACTER_PRESETS.map((p) => (
            <button key={p.id} className="tier" onClick={() => applyPreset(p)} title={p.persona}>
              <b>{p.label}</b>
              <small>{p.blurb}</small>
            </button>
          ))}
        </div>
      </div>

      <hr className="rule" />

      <div className="field2">
        <label className="field">
          <span>Streamer name</span>
          <input value={settings.streamerName} onChange={(e) => set({ streamerName: e.target.value })} />
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
              placeholder="e.g. nonbinary, androgynous…"
              onChange={(e) => set({ gender: e.target.value })}
            />
          )}
        </div>
      </div>

      <div className="field">
        <span>Backstory helper</span>
        <div className="onboard__suggest">
          <input
            value={hint}
            placeholder="Optional vibe hint — e.g. 'shy art streamer', 'chaotic speedrunner'…"
            onChange={(e) => setHint(e.target.value)}
          />
          <button className={`btn ${suggesting ? "is-loading" : ""}`} disabled={suggesting} onClick={() => void suggest()}>
            {suggesting ? "Dreaming…" : "✨ Suggest backstory"}
          </button>
        </div>
        <span className="hint">Fills the persona &amp; look below — edit anything you like afterwards. Works without an API key.</span>
      </div>

      <label className="field">
        <span>Persona / bio</span>
        <textarea rows={3} value={settings.streamerPersona} onChange={(e) => set({ streamerPersona: e.target.value })} />
      </label>

      <div className="field2">
        <label className="field">
          <span>Face — eyes, makeup, expression</span>
          <textarea
            rows={3}
            value={character.faceDescription}
            placeholder="e.g. warm brown eyes, light freckles, soft makeup, warm smile…"
            onChange={(e) => setCharacter({ faceDescription: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Body — hair, build, silhouette</span>
          <textarea
            rows={3}
            value={character.bodyDescription}
            placeholder="e.g. early 20s, shoulder-length pink hair, petite build…"
            onChange={(e) => setCharacter({ bodyDescription: e.target.value })}
          />
        </label>
      </div>

      <div className="charcre__previews">
        <Preview label="Portrait" src={portrait} />
        <Preview label="Body template" src={body} />
      </div>

      <div className="charcre__actions">
        <button
          className={`btn btn--primary ${busy ? "is-loading" : ""}`}
          disabled={!!busy || !canGen || (!character.faceDescription.trim() && !character.bodyDescription.trim())}
          onClick={() => void controller.generateCharacter(character.faceDescription, character.bodyDescription, true)}
        >
          {busy ? `${busy}…` : portrait || body ? "Regenerate portrait + body" : "🎭 Generate portrait + body"}
        </button>
      </div>
      {!canGen && (
        <span className="hint">Set a Gemini or OpenRouter key (Settings → General) to generate character art. You can also start without it and add art later.</span>
      )}
    </div>
  );
}

function RoomStep({ controller }: { controller: GameController }) {
  const generating = useStore((s) => s.generatingRoom);
  const roomImage = useStore((s) => s.roomImage);
  const imageBusy = useStore((s) => s.imageBusy);
  const canGen = controller.canGenerateRoom;
  const busy = generating || !!imageBusy;

  return (
    <div className="onboard__pane">
      <h2>Set the scene</h2>
      <p className="hint">Generate art for your studio apartment, or start with the built-in default room.</p>

      {roomImage ? (
        <img src={roomImage} alt="generated room" className="onboard__room" />
      ) : (
        <div className="onboard__room onboard__room--empty">Default studio room</div>
      )}

      <div className="charcre__actions">
        <button
          className={`btn btn--primary ${generating ? "is-loading" : ""}`}
          disabled={busy || !canGen}
          onClick={() => void controller.generateRoom()}
        >
          {generating ? "Generating…" : roomImage ? "🖼 Regenerate room" : "🖼 Generate room"}
        </button>
        {roomImage && (
          <button className="btn" disabled={busy} onClick={() => controller.clearRoom()}>Use default art</button>
        )}
      </div>
      {!canGen && (
        <span className="hint">Set a Gemini or OpenRouter key (Settings → General) to generate room art. The default room works fine without it.</span>
      )}
      <p className="hint" style={{ marginTop: 14 }}>That's everything — hit <b>Start streaming</b> to go live whenever you're ready.</p>
    </div>
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
