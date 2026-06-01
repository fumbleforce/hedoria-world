import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { tierIntensity } from "../game/content";
import { LIVE_ACTIONS, type LiveQuickAction } from "../game/liveActions";
import { talentQuickActions } from "../game/talents";

/**
 * Persistent bottom bar: a freeform action box, Continue, an Actions dropdown of
 * concrete options, the activity picker, and (always) Settings.
 */
export function ActionBar({ controller }: { controller: GameController }) {
  const isLive = useStore((s) => s.session.isLive);
  const resolving = useStore((s) => s.resolving);
  const offCamera = isLive && !controller.isOnCamera();
  const tier = useStore((s) => s.settings.contentTier);
  const talentId = useStore((s) => s.settings.talent);
  const activity = useStore((s) => s.activity);
  const visitor = useStore((s) => s.visitor);
  const eventScene = useStore((s) => s.eventScene);
  const guestName = useStore((s) =>
    s.visitor ? (s.roster[s.visitor.charId]?.displayName || s.roster[s.visitor.charId]?.handle || "your guest") : "",
  );
  const canGen = controller.canGenerateImages;
  const openRequestCount = useStore((s) => s.viewerRequests.filter((r) => r.status === "open").length);
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const intensity = tierIntensity(tier);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const send = () => {
    if (!text.trim()) return;
    controller.freeform(text);
    setText("");
  };

  const doAction = (a: LiveQuickAction) => {
    setMenuOpen(false);
    void controller.submitAction({ text: a.prompt, source: "menu" });
  };

  const actions = [...LIVE_ACTIONS, ...talentQuickActions(talentId)].filter(
    (a) => (a.minIntensity ?? 0) <= intensity,
  );

  return (
    <footer className="actionbar">
      {visitor && (
        <div className="actionbar__meeting">
          🏠 <b>In person — {guestName} is here.</b> Type what you say or do, or hit <b>Continue</b> to let them take the lead.
        </div>
      )}
      {eventScene && !visitor && (
        <div className="actionbar__meeting">
          ⚡ <b>In the moment — {eventScene.title}</b>
          {eventScene.stakes ? <> · Stakes: <em>{eventScene.stakes}</em></> : null}
          {" "}Type what you do, or hit <b>Continue</b> to let it unfold.
        </div>
      )}
      {activity && isLive && !visitor && !eventScene && (
        <div className="actionbar__meeting">
          🎬 <b>Activity — {activity.label}</b>
          <button
            className="chiplink"
            disabled={resolving}
            onClick={() => controller.stopActivity()}
            title="Stop this activity"
          >
            stop
          </button>
        </div>
      )}
      {offCamera && !visitor && !eventScene && (
        <div className="actionbar__meeting">
          🎥 <b>Off camera</b> — chat can't see you here. Actions won't get a live reaction.
        </div>
      )}
      <form className="actionbar__form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="actionbar__input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            visitor
              ? `What do you say or do? (${guestName} is right here with you…)`
              : eventScene
                ? "What do you do in this moment?"
                : isLive
                  ? "What do you do? (type anything — e.g. tell a joke, react to a clip, lie on the couch…)"
                  : "What do you do? (tidy up, scroll fan mail, change outfit…)"
          }
          disabled={resolving}
        />
        <button className={`btn btn--primary ${resolving ? "is-loading" : ""}`} type="submit" disabled={resolving || !text.trim()}>
          {resolving ? "…" : visitor || eventScene ? "Say / Do" : "Act"}
        </button>
        <button className="btn" type="button" disabled={resolving} onClick={() => void controller.continueStory()} title={visitor ? "Hang back and let them take the lead" : eventScene ? "Let the moment unfold" : "Let the moment ride — pass a little time"}>
          Continue ⏵
        </button>
      </form>

      <div className="actionbar__quick">
        {visitor ? (
          <>
            {canGen && (
              <button className="btn" disabled={resolving} onClick={() => void controller.generateScene()} title="Visualize this moment">📸 Visualize</button>
            )}
            <button className="btn" onClick={() => useStore.getState().openSettings("gallery")} title="Gallery">🖼</button>
            <button className="btn" onClick={() => useStore.getState().setInventoryOpen(true)} title="Inventory">🎒</button>
            <button className="btn" onClick={() => useStore.getState().setAccountOpen(true)} title="Saves &amp; Account">💾</button>
            <button className="btn" onClick={() => useStore.getState().openSettings()} title="Settings">⚙</button>
            <button className="btn btn--danger" disabled={resolving} onClick={() => void controller.endVisit()} title="Wrap up the visit">🚪 See them out</button>
          </>
        ) : eventScene ? (
          <>
            {canGen && (
              <button className="btn" disabled={resolving} onClick={() => void controller.generateScene()} title="Visualize this moment">📸 Visualize</button>
            )}
            <button className="btn" onClick={() => useStore.getState().openSettings("gallery")} title="Gallery">🖼</button>
            <button className="btn" onClick={() => useStore.getState().setAccountOpen(true)} title="Saves &amp; Account">💾</button>
            <button className="btn" onClick={() => useStore.getState().openSettings()} title="Settings">⚙</button>
            <button className="btn btn--danger" disabled={resolving} onClick={() => void controller.endEventScene()} title="Bring this moment to a close">✓ See it through</button>
          </>
        ) : isLive ? (
          <>
            <div className="dropdown" ref={menuRef}>
              <button className="btn" disabled={resolving} onClick={() => setMenuOpen((o) => !o)}>
                Actions ▾
              </button>
              {menuOpen && (
                <div className="dropdown__menu">
                  {actions.map((a) => (
                    <button key={a.label} className="dropdown__item" disabled={resolving} onClick={() => doAction(a)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!activity && (
              <button className="btn" disabled={resolving} onClick={() => useStore.getState().setActivityPickerOpen(true)}>🎬 Activity</button>
            )}
            <button className="btn" onClick={() => useStore.getState().setGoalsOpen(true)} title="Goals">🎯</button>
            <button className="btn actionbar__requests-btn" onClick={() => useStore.getState().setRequestsOpen(true)} title="Viewer requests">
              📋{openRequestCount > 0 && <sup className="actionbar__badge">{openRequestCount}</sup>}
            </button>
            <button className="btn" onClick={() => useStore.getState().setInventoryOpen(true)} title="Inventory">🎒</button>
            <button className="btn" onClick={() => useStore.getState().openSettings("character")} title="Character appearance">🎭</button>
            <button className="btn" onClick={() => useStore.getState().openSettings("gallery")} title="Gallery">🖼</button>
            <button className="btn" onClick={() => useStore.getState().setAccountOpen(true)} title="Saves &amp; Account">💾</button>
            <button className="btn" onClick={() => useStore.getState().openSettings()} title="Settings">⚙</button>
            <button className="btn btn--danger" disabled={resolving} onClick={() => controller.endStream()}>⏹ End</button>
          </>
        ) : (
          <>
            <button className="btn" disabled={resolving} onClick={() => useStore.getState().setJobPanelOpen(true)} title="Day job & job board">💼 Job</button>
            <button className="btn" onClick={() => useStore.getState().setInventoryOpen(true)} title="Inventory">🎒</button>
            <button className="btn" onClick={() => useStore.getState().setGoalsOpen(true)} title="Goals">🎯</button>
            <button className="btn actionbar__requests-btn" onClick={() => useStore.getState().setRequestsOpen(true)} title="Viewer requests">
              📋{openRequestCount > 0 && <sup className="actionbar__badge">{openRequestCount}</sup>}
            </button>
            <button className="btn" onClick={() => useStore.getState().openSettings("character")} title="Character appearance">🎭</button>
            <button className="btn" onClick={() => useStore.getState().openSettings("gallery")} title="Gallery">🖼</button>
            <button className="btn" onClick={() => useStore.getState().setAccountOpen(true)} title="Saves &amp; Account">💾</button>
            <button className="btn" onClick={() => useStore.getState().openSettings()} title="Settings">⚙</button>
          </>
        )}
      </div>
    </footer>
  );
}
