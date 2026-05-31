import { useState } from "react";
import { useStore } from "../state/store";
import { useStoredImage } from "../persist/useStoredImage";

/**
 * Center-stage display of the most recent generated image (scene, presence, or
 * portrait). Click to enlarge it in a lightbox.
 */
export function VisualizationPanel() {
  const lastImageId = useStore((s) => s.lastImageId);
  const url = useStoredImage(lastImageId);
  const busy = useStore((s) => s.imageBusy);
  const [lightbox, setLightbox] = useState(false);

  return (
    <section className="viz">
      <div className="viz__head">
        <span>🎞 Visualization</span>
        {busy && <span className="viz__busy is-loading">{busy}…</span>}
      </div>
      <div className="viz__frame">
        {url ? (
          <button className="viz__imgbtn" onClick={() => setLightbox(true)} title="Click to enlarge">
            <img src={url} alt="latest visualization" className={busy ? "is-loading" : ""} />
          </button>
        ) : (
          <div className={`viz__placeholder ${busy ? "is-loading" : ""}`}>
            {busy
              ? busy + "…"
              : "No visualization yet. Create your character (🎭), then “Visualize here” in the room or “Visualize scene” in the narrator."}
          </div>
        )}
      </div>
      {lastImageId && <div className="viz__hint">Click the image to enlarge it.</div>}
      {lightbox && url && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <img src={url} alt="latest visualization" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </section>
  );
}
