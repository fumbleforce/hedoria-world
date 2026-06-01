import { useState } from "react";
import { useStore } from "../state/store";
import { useStoredImage } from "../persist/useStoredImage";
import { StreamView } from "../render/StreamView";
import type { GameController } from "../game/controller";

/**
 * Center-stage display. While live this becomes the Twitch-style stream player
 * (latest camera feed + broadcast chrome); offline it shows the most recent
 * generated image (scene, presence, or portrait). Click to enlarge in a lightbox.
 */
export function VisualizationPanel({ controller }: { controller: GameController }) {
  const lastImageId = useStore((s) => s.lastImageId);
  const url = useStoredImage(lastImageId);
  const busy = useStore((s) => s.imageBusy);
  const bgBusy = useStore((s) => s.imageBusyBackground);
  const isLive = useStore((s) => s.session.isLive);
  const [lightbox, setLightbox] = useState(false);
  // Foreground jobs (the image the player is waiting for) get the pulsing label
  // + image treatment; background prerequisites get only a subtle quiet label.
  const fgBusy = !!busy && !bgBusy;
  const busyLabel = busy && (
    <span className={`viz__busy ${fgBusy ? "is-loading" : "viz__busy--bg"}`}>{busy}…</span>
  );

  if (isLive) {
    return (
      <section className="viz viz--live">
        {busyLabel}
        <StreamView controller={controller} />
      </section>
    );
  }

  return (
    <section className="viz">
      {busyLabel}
      {url ? (
        <button className="viz__imgbtn" onClick={() => setLightbox(true)} title="Click to enlarge">
          <img src={url} alt="latest visualization" className={fgBusy ? "is-loading" : ""} />
        </button>
      ) : (
        <div className={`viz__placeholder ${fgBusy ? "is-loading" : ""}`}>
          {busy
            ? busy + "…"
            : "No visualization yet. Create your character (🎭), then “Visualize here” in the room or “Visualize scene” in the narrator."}
        </div>
      )}
      {lastImageId && <div className="viz__hint">Click the image to enlarge it.</div>}
      {lightbox && url && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <img src={url} alt="latest visualization" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </section>
  );
}
