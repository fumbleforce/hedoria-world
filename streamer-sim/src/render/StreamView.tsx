import { useState } from "react";
import { useStore } from "../state/store";
import { useStoredImage } from "../persist/useStoredImage";
import { activeCamera, cameraDisplayLabel } from "../game/cameras";
import { NICHES } from "../game/niches";
import type { GameController } from "../game/controller";

/**
 * The live "as seen on Twitch" video player: the latest camera-footage image
 * fills a 16:9 frame with broadcast chrome (LIVE badge, uptime, viewer count,
 * and a title bar). Rendered in the center visualization window while live; the
 * stream chat lives in the right-hand panel.
 */
export function StreamView({ controller }: { controller: GameController }) {
  const footageId = useStore((s) => s.streamFootageId);
  const url = useStoredImage(footageId);
  const viewers = useStore((s) => s.metrics.currentViewers);
  const hype = useStore((s) => s.metrics.hype);
  const handle = useStore((s) => s.brand.handle);
  const frameAccent = useStore((s) => s.brand.frameAccent);
  const logoId = useStore((s) => s.brand.logoId);
  const logoUrl = useStoredImage(logoId);
  const niche = useStore((s) => s.session.niche ?? "variety");
  const clock = useStore((s) => s.clock);
  const startClock = useStore((s) => s.session.streamStartClock);
  const cameras = useStore((s) => s.cameras);
  const activeCameraId = useStore((s) => s.activeCameraId);
  const imageBusy = useStore((s) => s.imageBusy);
  const bgBusy = useStore((s) => s.imageBusyBackground);
  const fgBusy = !!imageBusy && !bgBusy;
  const cam = activeCamera(cameras, activeCameraId);
  const onCamera = controller.isOnCamera();
  const canGen = controller.canGenerateImages;
  const [lightbox, setLightbox] = useState(false);

  const uptime = Math.max(0, clock - (startClock || clock));
  const uptimeLabel = `${Math.floor(uptime / 60)}:${String(Math.floor(uptime % 60)).padStart(2, "0")}`;

  return (
    <div className="streamview">
      <div className="streamview__feed" data-frame-accent={frameAccent}>
        {canGen && (
          <button
            type="button"
            className="streamview__refresh btn btn--mini"
            disabled={!!imageBusy}
            onClick={() => void controller.generateCamFootage(undefined, true)}
            title="Regenerate the live stream feed from the active camera"
          >
            {url ? "📹 Refresh feed" : "📹 Capture feed"}
          </button>
        )}

        {!url && (
          <div className="streamview__noimg">
            {imageBusy ? (
              <span className={fgBusy ? "is-loading" : "viz__busy--bg"}>{imageBusy}…</span>
            ) : !canGen ? (
              <span>📷 {cam ? cameraDisplayLabel(cam) : "Camera"} is rolling — enable image generation to see the feed.</span>
            ) : (
              <span>No camera feed yet — hit Refresh feed.</span>
            )}
          </div>
        )}

        {url && (
          <img
            src={url}
            alt="live stream feed"
            className={fgBusy ? "is-loading" : ""}
            onClick={() => setLightbox(true)}
            title="Click to enlarge"
          />
        )}

        {!onCamera && (
          <div className="streamview__offcam">
            <span>🎥 You stepped off camera</span>
            <small>Viewers see the last frame. Move back to a camera to return on screen.</small>
          </div>
        )}

        <div className="streamview__top">
          {logoUrl && <img src={logoUrl} alt="" className="streamview__logo" />}
          <span className="streamview__live">● LIVE</span>
          <span className="streamview__uptime">{uptimeLabel}</span>
          <span className="streamview__viewers">👁 {Math.round(viewers).toLocaleString()}</span>
        </div>

        <div className="streamview__bottom">
          <div className="streamview__title">@{handle || "streamer"}</div>
          <div className="streamview__sub">
            {NICHES[niche]?.label ?? "Just Chatting"} · 🔥 {Math.round(hype)}
            {cam && <> · 📷 {cameraDisplayLabel(cam)}</>}
          </div>
        </div>
      </div>

      {lightbox && url && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <img src={url} alt="live stream feed" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
