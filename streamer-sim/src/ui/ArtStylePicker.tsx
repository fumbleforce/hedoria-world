import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import {
  IMAGE_STYLE_PRESETS,
  bakedStylePreviewUrl,
  clearImagePromptOverrides,
  isCustomArtStyle,
  type BuiltinImageStylePresetId,
  type ImageStylePresetId,
} from "../llm/imagePresets";
import { pickClass } from "./pickClass";

type Props = {
  controller?: GameController;
  /** Show helper text under the custom-style textarea. */
  showCustomHint?: boolean;
};

/**
 * Art-style preset grid with baked thumbnails and an optional custom-style path.
 * Custom writes directly to `settings.imageStyle` (the universal {{style}} line).
 * Custom previews are generated on demand via the image backend.
 */
export function ArtStylePicker({ controller, showCustomHint = true }: Props) {
  const presetId = useStore((s) => s.settings.imageStylePreset);
  const imageStyle = useStore((s) => s.settings.imageStyle);
  const customPreview = useStore((s) => s.customStylePreview);
  const customPreviewFor = useStore((s) => s.customStylePreviewFor);
  const imageBusy = useStore((s) => s.imageBusy);
  const set = useStore((s) => s.setSettings);
  const isCustom = isCustomArtStyle(presetId);
  const styleText = imageStyle.trim();
  const previewMatches = !!styleText && customPreviewFor === styleText && !!customPreview;
  const canGen = controller?.canGenerateImages ?? false;

  const applyPreset = (id: ImageStylePresetId) => {
    if (id === "custom") {
      set({
        imageStylePreset: "custom",
        roomPrompt: "",
        portraitPrompt: "",
        bodyPrompt: "",
        presencePrompt: "",
        scenePrompt: "",
        imageStyle: styleText,
      });
      return;
    }
    set({ imageStylePreset: id, ...clearImagePromptOverrides() });
  };

  return (
    <>
      <div className="stylePresetGrid">
        {IMAGE_STYLE_PRESETS.map((p) => {
          const active = !isCustom && presetId === p.id;
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
                <img src={bakedStylePreviewUrl(p.id as BuiltinImageStylePresetId)} alt={`${p.label} style preview`} />
              </div>
              <b>{p.label}</b>
              <small>{p.blurb}</small>
            </div>
          );
        })}
        <div
          className={pickClass(isCustom, "stylePreset")}
          onClick={() => applyPreset("custom")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") applyPreset("custom"); }}
        >
          <div className="stylePreset__thumb">
            {isCustom && previewMatches ? (
              <img src={customPreview} alt="Custom style preview" />
            ) : (
              <span
                className="stylePreset__placeholder"
                style={{ background: "linear-gradient(135deg, #868e96, #495057)" }}
              >
                ✏️ custom
              </span>
            )}
          </div>
          <b>Custom</b>
          <small>Write your own style description.</small>
        </div>
      </div>
      {isCustom && (
        <div className="customStyle" style={{ marginTop: 12 }}>
          <label className="field">
            <span>Custom style description</span>
            <textarea
              rows={3}
              value={imageStyle}
              placeholder="e.g. Watercolor sketch with loose ink lines, muted earth tones, soft natural lighting…"
              onChange={(e) => set({ imageStyle: e.target.value })}
            />
            {showCustomHint && (
              <span className="hint">This becomes the {"{{style}}"} line in every generated image.</span>
            )}
          </label>
          {canGen ? (
            <div className="stylePreset__bar">
              <button
                className="btn btn--mini"
                disabled={!!imageBusy || !styleText}
                onClick={() => void controller!.generateCustomStylePreview()}
              >
                {imageBusy ? `${imageBusy}…` : previewMatches ? "↻ Regenerate preview" : "🖼 Generate preview"}
              </button>
              <span className="hint">
                {previewMatches
                  ? "Preview matches your description."
                  : styleText
                    ? "Generate to see how this style looks."
                    : "Write a description, then generate a preview."}
              </span>
            </div>
          ) : (
            <p className="hint">Set a Gemini or OpenRouter key to generate a custom style preview.</p>
          )}
          {previewMatches && (
            <div className="customStyle__preview">
              <img src={customPreview} alt="Custom style preview" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
