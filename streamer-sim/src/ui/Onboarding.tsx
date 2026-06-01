import { useEffect, useState } from "react";
import { useStore, applyStartingMetricsIfFresh } from "../state/store";
import { dominantOutfitVibe } from "../game/wardrobe";
import type { GameController } from "../game/controller";
import { CONTENT_TIERS_ONBOARDING } from "../game/content";
import { DIFFICULTY_LEVELS } from "../game/balance";
import { IMAGE_STYLE_PRESETS } from "../llm/imagePresets";
import { clearImagePromptOverrides, type ImageStylePresetId } from "../llm/imagePresets";
import {
  CHARACTER_PRESETS,
  matchingCharacterPresetId,
  presetCardRole,
  presetGenderDot,
  type CharacterPreset,
} from "../game/characterPresets";
import { useStoredImage } from "../persist/useStoredImage";
import { GenderPicker } from "./GenderPicker";
import { OptionPick } from "./OptionPick";
import { pickClass } from "./pickClass";
import { NO_TALENT_ID, TALENTS, randomTalent } from "../game/talents";
import { RoomMapEditor } from "./RoomMapEditor";
import { BrandFields } from "./BrandFields";
import {
  JOB_PRESETS,
  SHIFT_SLOT_ORDER,
  SHIFT_SLOTS,
  customJob,
  isCustomJobId,
  jobFromPreset,
  randomJobPreset,
  type ShiftSlotId,
} from "../game/jobs";

const STEP_LABELS = ["Intensity", "Art style", "Character", "Brand", "Skills", "Room"] as const;

/**
 * First-run start-up flow for a brand-new save. Forces the player through the
 * four setup choices (intensity → art style → character → brand → skills → room) before the game
 * proper is reachable. Every step has a default so it can be completed without an
 * API key; image generation is offered but never required. Mounts as a full-page
 * overlay below the Settings modal so "Advanced — edit prompts" can layer on top.
 */
export function Onboarding({ controller }: { controller: GameController }) {
  const [step, setStep] = useState(0);
  const [launchPhase, setLaunchPhase] = useState<string | null>(null);
  const imageBusy = useStore((s) => s.imageBusy);
  const generatingRoom = useStore((s) => s.generatingRoom);
  const starting = !!launchPhase;
  const busy = starting || !!imageBusy || generatingRoom;
  const last = STEP_LABELS.length - 1;

  const finish = async () => {
    applyStartingMetricsIfFresh();
    setLaunchPhase("Writing your opening scene…");
    try {
      await controller.finishOnboarding((label) => setLaunchPhase(label));
      useStore.getState().setOnboarded(true);
    } catch {
      setLaunchPhase(null);
      useStore.getState().setToast("Couldn't start the game — try again.");
    }
  };

  if (launchPhase) {
    return <OnboardingLaunch phase={launchPhase} />;
  }

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
          {step === 3 && <BrandStep controller={controller} />}
          {step === 4 && <SkillsStep />}
          {step === 5 && <RoomStep controller={controller} />}
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
            <button className="btn" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              ← Back
            </button>
            {step < last ? (
              <button className="btn btn--primary" disabled={busy} onClick={() => setStep((s) => Math.min(last, s + 1))}>
                Next →
              </button>
            ) : (
              <button
                className={`btn btn--primary ${starting ? "is-loading" : ""}`}
                disabled={busy}
                onClick={() => void finish()}
              >
                {starting ? "Starting…" : "Start streaming →"}
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
  const difficulty = useStore((s) => s.settings.difficulty ?? "normal");
  const set = useStore((s) => s.setSettings);
  return (
    <div className="onboard__pane">
      <h2>Pick your content intensity</h2>
      <p className="hint">Sets the ceiling on how far things can escalate — not a floor. You can change it later in Settings.</p>
      <div className="pickGrid">
        {CONTENT_TIERS_ONBOARDING.map((t) => (
          <OptionPick key={t.id} selected={tier === t.id} onClick={() => set({ contentTier: t.id })}>
            <b>{t.label}</b>
            <small>{t.blurb}</small>
          </OptionPick>
        ))}
      </div>

      <hr className="rule" />

      <div className="field">
        <span>Difficulty</span>
        <div className="pickGrid">
          {DIFFICULTY_LEVELS.map((d) => (
            <OptionPick key={d.id} selected={difficulty === d.id} onClick={() => set({ difficulty: d.id })}>
              <b>{d.label}</b>
              <small>{d.blurb}</small>
            </OptionPick>
          ))}
        </div>
      </div>
      <p className="hint">Tunes economy, bills, and survival pressure. Change anytime in Settings.</p>
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
              className={pickClass(active, "stylePreset")}
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
  const setStarterWardrobe = useStore((s) => s.setStarterWardrobe);
  const equippedClothing = useStore((s) => s.equippedClothing);
  const inventory = useStore((s) => s.inventory);
  const busy = useStore((s) => s.imageBusy);
  const portrait = useStoredImage(character.portraitId);
  const body = useStoredImage(character.bodyId);
  const canGen = controller.canGenerateImages;

  const [hint, setHint] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const activePresetId = matchingCharacterPresetId(settings, character, equippedClothing, inventory);

  const applyPreset = (p: CharacterPreset) => {
    set({
      streamerName: p.name,
      gender: p.gender,
      streamerPersona: p.persona,
      talent: p.talent,
    });
    setCharacter({ faceDescription: p.faceDescription, bodyDescription: p.bodyDescription });
    setStarterWardrobe(p.outfit, p.gender);
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
            <OptionPick
              key={p.id}
              className="characterPresetPick"
              selected={activePresetId === p.id}
              onClick={() => applyPreset(p)}
              title={p.persona}
            >
              <span className="presetPick__title">
                <span
                  className={`presetGenderDot presetGenderDot--${presetGenderDot(p.gender)}`}
                  aria-hidden
                />
                <span className="presetPick__text">
                  <b>{p.name}</b>
                  <span className="presetPick__role">{presetCardRole(p)}</span>
                </span>
              </span>
            </OptionPick>
          ))}
        </div>
      </div>

      <hr className="rule" />

      <div className="field2">
        <label className="field">
          <span>Character name (private)</span>
          <input value={settings.streamerName} onChange={(e) => set({ streamerName: e.target.value })} />
        </label>
        <div className="field">
          <span>Gender</span>
          <GenderPicker
            gender={settings.gender ?? ""}
            onChange={(gender) => {
              const vibe = dominantOutfitVibe(equippedClothing, inventory);
              set({ gender });
              setStarterWardrobe(vibe, gender);
            }}
          />
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

function BrandStep({ controller }: { controller: GameController }) {
  return (
    <div className="onboard__pane">
      <h2>Build your brand</h2>
      <p className="hint">This is your public channel identity — what chat sees on stream. Your character name stays private.</p>
      <BrandFields controller={controller} />
    </div>
  );
}

function SkillsStep() {
  const settings = useStore((s) => s.settings);
  const job = useStore((s) => s.job);
  const set = useStore((s) => s.setSettings);
  const setJob = useStore((s) => s.setJob);

  const [jobMode, setJobMode] = useState<"unemployed" | "preset" | "custom">(() => {
    if (!job) return "unemployed";
    if (isCustomJobId(job.id)) return "custom";
    return "preset";
  });
  const [customTitle, setCustomTitle] = useState(() => (job && isCustomJobId(job.id) ? job.title : ""));
  const [customWage, setCustomWage] = useState(() => (job && isCustomJobId(job.id) ? String(job.wage) : "65"));
  const [customSlot, setCustomSlot] = useState<ShiftSlotId>(() => {
    if (!job) return "afternoon";
    const match = SHIFT_SLOT_ORDER.find(
      (id) => SHIFT_SLOTS[id].shiftStart === job.shiftStart && SHIFT_SLOTS[id].shiftEnd === job.shiftEnd,
    );
    return match ?? "afternoon";
  });

  const applyCustomJob = (title: string, wage: string, slot: ShiftSlotId) => {
    const parsed = Number.parseInt(wage, 10);
    setJob(customJob(title, Number.isFinite(parsed) ? parsed : 65, slot));
  };

  return (
    <div className="onboard__pane">
      <h2>Skills</h2>

      <div className="skillsSection">
        <span className="skillsSection__title">Streamer skill</span>
        <p className="hint skillsSection__desc">
          Something you&apos;re already good at on cam — unlocks a free stream mode and quick actions, or skip it.
        </p>
        <div className="pickGrid">
          <OptionPick
            selected={!settings.talent}
            onClick={() => set({ talent: NO_TALENT_ID })}
          >
            <b>— No skill</b>
            <small>No free stream mode — you&apos;ll lean on purchased activities.</small>
          </OptionPick>
          {TALENTS.map((t) => (
            <OptionPick
              key={t.id}
              selected={settings.talent === t.id}
              onClick={() => set({ talent: t.id })}
              title={t.blurb}
            >
              <b>{t.emoji} {t.label}</b>
              <small>{t.blurb}</small>
            </OptionPick>
          ))}
          <OptionPick
            selected={false}
            onClick={() => set({ talent: randomTalent().id })}
          >
            <b>🎲 Random skill</b>
            <small>Roll the dice — surprise yourself.</small>
          </OptionPick>
        </div>
      </div>

      <hr className="rule" />

      <div className="skillsSection">
        <span className="skillsSection__title">Day job</span>
        <p className="hint skillsSection__desc">
          Clock in once per day during your shift window to earn a paycheck and cover rent. Show up late too often and you&apos;ll get strikes — three and you&apos;re fired. Or stay unemployed and rely on stream income alone.
        </p>
        <div className="pickGrid">
          <OptionPick
            selected={jobMode === "unemployed"}
            onClick={() => { setJobMode("unemployed"); setJob(null); }}
          >
            <b>Unemployed</b>
            <small>No day job — rent comes from tips and subs only.</small>
          </OptionPick>
          {JOB_PRESETS.map((p) => (
            <OptionPick
              key={p.id}
              selected={jobMode === "preset" && job?.id === p.id}
              onClick={() => { setJobMode("preset"); setJob(jobFromPreset(p)); }}
              title={p.blurb}
            >
              <b>{p.title}</b>
              <small>${p.wage}/shift · {p.blurb}</small>
            </OptionPick>
          ))}
          <OptionPick
            selected={false}
            onClick={() => {
              const p = randomJobPreset();
              setJobMode("preset");
              setJob(jobFromPreset(p));
            }}
          >
            <b>🎲 Random job</b>
            <small>Deal you a preset gig from the board.</small>
          </OptionPick>
          <OptionPick
            selected={jobMode === "custom"}
            onClick={() => {
              setJobMode("custom");
              applyCustomJob(customTitle, customWage, customSlot);
            }}
          >
            <b>✏️ Custom job</b>
            <small>Invent your own title, wage, and shift.</small>
          </OptionPick>
        </div>
      </div>

      {jobMode === "custom" && (
        <>
          <hr className="rule" />
          <div className="field">
            <span>Custom job details</span>
            <div className="field2">
              <label className="field">
                <span>Title</span>
                <input
                  value={customTitle}
                  placeholder="e.g. Night receptionist"
                  onChange={(e) => {
                    setCustomTitle(e.target.value);
                    applyCustomJob(e.target.value, customWage, customSlot);
                  }}
                />
              </label>
              <label className="field">
                <span>Salary per shift ($)</span>
                <input
                  type="number"
                  min={40}
                  max={120}
                  value={customWage}
                  onChange={(e) => {
                    setCustomWage(e.target.value);
                    applyCustomJob(customTitle, e.target.value, customSlot);
                  }}
                />
              </label>
            </div>
            <label className="field">
              <span>Shift hours</span>
              <select
                value={customSlot}
                onChange={(e) => {
                  const slot = e.target.value as ShiftSlotId;
                  setCustomSlot(slot);
                  applyCustomJob(customTitle, customWage, slot);
                }}
              >
                {SHIFT_SLOT_ORDER.map((id) => (
                  <option key={id} value={id}>{SHIFT_SLOTS[id].label}</option>
                ))}
              </select>
            </label>
          </div>
        </>
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
      <p className="hint">Generate art for your studio apartment, or start with the built-in default room. If the zones don't line up with the generated room, drag them onto the matching furniture.</p>

      <RoomMapEditor roomImage={roomImage} />

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

/** Full-screen gate while the opening beat + first scene image generate. */
function OnboardingLaunch({ phase }: { phase: string }) {
  return (
    <div className="onboard onboard--launch" aria-busy="true" aria-live="polite">
      <div className="onboardLaunch">
        <div className="onboardLaunch__ring" aria-hidden="true">
          <span className="onboardLaunch__dot" />
        </div>
        <h1 className="onboardLaunch__title">◉ Limelight</h1>
        <p className="onboardLaunch__phase is-loading">{phase}</p>
        <p className="onboardLaunch__hint">Setting the stage for your first stream…</p>
      </div>
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
