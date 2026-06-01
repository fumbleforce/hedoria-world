import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { useStoredImage } from "../persist/useStoredImage";

/**
 * Full-screen "at work" overlay. Shows a generated workplace image (rendered once
 * per job, then cached) plus LLM/offline shift flavor, with a single "Head home"
 * action that applies pay/time and exits. Survives reload via `store.workSession`.
 */
export function WorkScreen({ controller }: { controller: GameController }) {
  const ws = useStore((s) => s.workSession);
  const canGen = controller.canGenerateImages;
  const image = useStoredImage(ws?.imageId);
  const [leaving, setLeaving] = useState(false);
  const active = !!ws;

  useEffect(() => {
    if (active) void controller.ensureWorkScene();
  }, [active, controller]);

  if (!ws) return null;

  const headHome = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => controller.leaveWork(), 360);
  };

  const flavorReady = !!ws.flavor;
  const imageReady = !!image || (!canGen && flavorReady);

  return (
    <div className={`work ${leaving ? "is-leaving" : "is-entering"}`}>
      <div className="work__card">
        <div className="work__media">
          {image ? (
            <img className="work__img" src={image} alt={`On shift as ${ws.title}`} />
          ) : (
            <div className="work__img work__img--placeholder">
              {canGen ? (
                <span className="work__spinner" aria-hidden />
              ) : (
                <span className="work__placeholderIcon">💼</span>
              )}
            </div>
          )}
          <div className="work__overlayTop">
            <span className="work__badge">On shift</span>
            <b className="work__title">{ws.title}</b>
            {!ws.onTime && <span className="work__late">Clocked in late</span>}
          </div>
        </div>

        <div className="work__body">
          <p className={`work__flavor ${flavorReady ? "" : "is-loading"}`}>
            {flavorReady ? ws.flavor : "Settling into the shift…"}
          </p>

          <div className="work__foot">
            <span className="work__pay">Pay this shift: <b>+${ws.pay}</b></span>
            <button
              className="btn btn--primary work__home"
              type="button"
              disabled={!imageReady || leaving}
              onClick={headHome}
            >
              {leaving ? "Heading home…" : `🏠 Head home (+$${ws.pay})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
