import { useState } from "react";
import { useStore } from "../state/store";
import { useStoredImage } from "../persist/useStoredImage";
import { activeCamera } from "../game/cameras";
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
  const name = useStore((s) => s.settings.streamerName);
  const niche = useStore((s) => s.settings.niche);
  const clock = useStore((s) => s.clock);
  const startClock = useStore((s) => s.session.streamStartClock);
  const cameras = useStore((s) => s.cameras);
  const activeCameraId = useStore((s) => s.activeCameraId);
  const imageBusy = useStore((s) => s.imageBusy);
  const cam = activeCamera(cameras, activeCameraId);
  const onCamera = controller.isOnCamera();
  const canGen = controller.canGenerateImages;
  const [lightbox, setLightbox] = useState(false);

  const uptime = Math.max(0, clock - (startClock || clock));
  const uptimeLabel = `${Math.floor(uptime / 60)}:${String(Math.floor(uptime % 60)).padStart(2, "0")}`;

  return (
    <div className="streamview">
      <div className="streamview__feed">
        {url ? (
          <img
            src={url}
            alt="live stream feed"
            className={imageBusy ? "is-loading" : ""}
            onClick={() => setLightbox(true)}
            title="Click to enlarge"
          />
        ) : (
          <div className="streamview__noimg">
            {imageBusy ? (
              <span className="is-loading">{imageBusy}…</span>
            ) : canGen ? (
              <>
                <span>No camera feed yet.</span>
                <button className="btn btn--primary" onClick={() => void controller.generateCamFootage()}>
                  📹 Capture feed
                </button>
              </>
            ) : (
              <span>📷 {cam?.label ?? "Camera"} is rolling — enable image generation to see the feed.</span>
            )}
          </div>
        )}

        {!onCamera && (
          <div className="streamview__offcam">
            <span>🎥 You stepped off camera</span>
            <small>Viewers see the last frame. Move back to a camera to return on screen.</small>
          </div>
        )}

        <div className="streamview__top">
          <span className="streamview__live">● LIVE</span>
          <span className="streamview__uptime">{uptimeLabel}</span>
          <span className="streamview__viewers">👁 {Math.round(viewers).toLocaleString()}</span>
        </div>

        <div className="streamview__bottom">
          <div className="streamview__title">{name || "Streamer"}</div>
          <div className="streamview__sub">
            {NICHES[niche]?.label ?? "Just Chatting"} · 🔥 {Math.round(hype)}
            {cam && <> · 📷 {cam.label}</>}
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
