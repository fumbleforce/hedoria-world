import { useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { FRAME_ACCENTS, LOGO_PRESETS, RULE_CHIPS, isValidHandle, normalizeHandle, suggestHandle } from "../game/brand";
import { NICHES, nichesForTier } from "../game/niches";
import { useStoredImage } from "../persist/useStoredImage";
import { OptionPick } from "./OptionPick";

export function BrandFields({
  controller,
  showApplyNiche,
}: {
  controller: GameController;
  /** Settings panel: offer link to copy default niche to desk draft. */
  showApplyNiche?: boolean;
}) {
  const brand = useStore((s) => s.brand);
  const settings = useStore((s) => s.settings);
  const streamNicheDraft = useStore((s) => s.streamNicheDraft);
  const setBrand = useStore((s) => s.setBrand);
  const setStreamNicheDraft = useStore((s) => s.setStreamNicheDraft);
  const imageBusy = useStore((s) => s.imageBusy);
  const [handleDraft, setHandleDraft] = useState(brand.handle);
  const [handleError, setHandleError] = useState("");
  const logoUrl = useStoredImage(brand.logoId);
  const canGen = controller.canGenerateImages;
  const nicheIds = nichesForTier(settings.contentTier);
  const nicheValue = nicheIds.includes(brand.defaultNiche) ? brand.defaultNiche : "variety";

  const commitHandle = () => {
    const h = normalizeHandle(handleDraft);
    if (!isValidHandle(h)) {
      setHandleError("3–24 characters: letters, numbers, underscores");
      return;
    }
    setHandleError("");
    setBrand({ handle: h });
    setHandleDraft(h);
  };

  const appendRule = (line: string) => {
    const cur = brand.rules.trim();
    if (cur.split("\n").some((l) => l.trim() === line)) return;
    setBrand({ rules: cur ? `${cur}\n${line}` : line });
  };

  return (
    <>
      <div className="field">
        <span>Stream handle</span>
        <div className="brandHandleRow">
          <span className="brandHandleRow__at">@</span>
          <input
            value={handleDraft}
            onChange={(e) => {
              setHandleDraft(e.target.value);
              setHandleError("");
            }}
            onBlur={commitHandle}
            placeholder="your_handle"
            spellCheck={false}
            autoCapitalize="off"
          />
          <button
            type="button"
            className="btn btn--mini"
            onClick={() => {
              const h = suggestHandle(settings.streamerName);
              setHandleDraft(h);
              setBrand({ handle: h });
              setHandleError("");
            }}
          >
            Suggest from name
          </button>
        </div>
        {handleError && <span className="hint hint--warn">{handleError}</span>}
        <span className="hint">Public identity — chat knows you as @{brand.handle || "…"}. Your character name stays private.</span>
      </div>

      <div className="field">
        <span>Default stream niche</span>
        <div className="pickGrid">
          {nicheIds.map((id) => (
            <OptionPick
              key={id}
              className="nicheTier"
              selected={nicheValue === id}
              onClick={() => setBrand({ defaultNiche: id })}
              title={NICHES[id].blurb}
            >
              <b>{NICHES[id].label}</b>
              <span className="hint">{NICHES[id].blurb}</span>
            </OptionPick>
          ))}
        </div>
        {showApplyNiche && streamNicheDraft !== brand.defaultNiche && (
          <button
            type="button"
            className="btn btn--mini"
            onClick={() => setStreamNicheDraft(brand.defaultNiche)}
          >
            Apply as next stream
          </button>
        )}
      </div>

      <label className="field">
        <span>Channel description</span>
        <textarea
          rows={3}
          maxLength={280}
          value={brand.description}
          onChange={(e) => setBrand({ description: e.target.value })}
          placeholder="What is this channel about?"
        />
        <span className="hint">{brand.description.length}/280</span>
      </label>

      <div className="field">
        <span>Community rules</span>
        <div className="brandRuleChips">
          {RULE_CHIPS.map((line) => (
            <button key={line} type="button" className="btn btn--mini" onClick={() => appendRule(line)}>
              + {line}
            </button>
          ))}
        </div>
        <textarea
          rows={4}
          maxLength={500}
          value={brand.rules}
          onChange={(e) => setBrand({ rules: e.target.value })}
          placeholder="Rules chat and mods follow on your channel…"
        />
        <span className="hint">{brand.rules.length}/500 · Used in live chat generation.</span>
      </div>

      <div className="field">
        <span>Stream frame accent</span>
        <div className="pickGrid pickGrid--compact">
          {FRAME_ACCENTS.map((a) => (
            <OptionPick
              key={a.id}
              className="frameAccentPick"
              selected={brand.frameAccent === a.id}
              onClick={() => setBrand({ frameAccent: a.id })}
            >
              <span
                className="frameAccentSwatch"
                style={{ background: `linear-gradient(135deg, ${a.swatch[0]}, ${a.swatch[1]})` }}
              />
              {a.label}
            </OptionPick>
          ))}
        </div>
      </div>

      <div className="field brandLogoField">
        <span>Channel logo</span>
        <input
          value={brand.logoBrief}
          maxLength={200}
          onChange={(e) => setBrand({ logoBrief: e.target.value })}
          placeholder="Describe your logo — e.g. a coffee cup with cat ears"
        />
        <span className="hint">What the logo shows. Leave blank for a generic {NICHES[nicheValue]?.label.toLowerCase() ?? "stream"} mark. The preset below sets the art style.</span>
        <div className="pickGrid pickGrid--compact">
          {LOGO_PRESETS.map((p) => (
            <OptionPick
              key={p.id}
              className="logoPresetPick"
              selected={brand.logoPreset === p.id}
              onClick={() => setBrand({ logoPreset: p.id })}
              title={p.prompt}
            >
              <b>{p.label}</b>
              <span className="hint">{p.blurb}</span>
            </OptionPick>
          ))}
        </div>
        <div className="brandLogoBlock">
          {logoUrl ? (
            <img src={logoUrl} alt="Channel logo" className="brandLogoPreview" />
          ) : (
            <div className="brandLogoPreview brandLogoPreview--empty">No logo yet — pick a style and generate</div>
          )}
          <div className="brandLogoActions">
            <button
              type="button"
              className={`btn btn--primary ${imageBusy ? "is-loading" : ""}`}
              disabled={!!imageBusy || !canGen}
              onClick={() => void controller.generateBrandLogo(!!brand.logoId)}
            >
              {imageBusy ? `${imageBusy}…` : brand.logoId ? "Regenerate logo" : "Generate logo"}
            </button>
            {brand.logoId && (
              <button type="button" className="btn" onClick={() => setBrand({ logoId: null })}>
                Clear logo
              </button>
            )}
          </div>
        </div>
        {!canGen && (
          <span className="hint">Set a Gemini or OpenRouter key to generate a logo. Optional — skip anytime.</span>
        )}
      </div>
    </>
  );
}

function BrandTab({ controller }: { controller: GameController }) {
  return (
    <>
      <p className="hint">Your public channel identity — handle, rules, logo, and stream overlay styling.</p>
      <BrandFields controller={controller} showApplyNiche />
    </>
  );
}

export { BrandTab };
