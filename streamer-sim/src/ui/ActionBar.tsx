import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { tierIntensity } from "../game/content";
import { GAME_BY_ID } from "../game/games";
import { NICHES, NICHE_IDS, type NicheId } from "../game/niches";

/** Concrete live actions, each a clear thing with an obvious outcome. */
interface QuickAction {
  label: string;
  prompt: string;
  minIntensity?: number;
}
const LIVE_ACTIONS: QuickAction[] = [
  { label: "😂 Tell a joke", prompt: "tell chat a genuinely funny joke" },
  { label: "💬 Chat with viewers", prompt: "chat casually with viewers, answering what they're saying" },
  { label: "❓ Answer questions (Q&A)", prompt: "take and answer questions from chat" },
  { label: "📖 Tell a story", prompt: "tell chat an entertaining story from your week" },
  { label: "🎤 Sing a song", prompt: "sing a song for chat" },
  { label: "💃 Dance", prompt: "put on a song and dance for chat" },
  { label: "📺 React to a video", prompt: "pull up a trending video and react to it with chat" },
  { label: "🫧 Open up / get personal", prompt: "get a little vulnerable and share something personal" },
  { label: "🙏 Thank a supporter", prompt: "give a heartfelt shout-out to a generous viewer by name" },
  { label: "😏 Flirt with chat", prompt: "flirt and tease chat playfully", minIntensity: 1 },
  { label: "🔥 Something daring", prompt: "lean into a bold, daring, suggestive moment for the crowd", minIntensity: 2 },
];

/**
 * Persistent bottom bar: a freeform action box, Continue, an Actions dropdown of
 * concrete options, the game picker, and (always) Settings.
 */
export function ActionBar({ controller }: { controller: GameController }) {
  const isLive = useStore((s) => s.session.isLive);
  const resolving = useStore((s) => s.resolving);
  const tier = useStore((s) => s.settings.contentTier);
  const playing = useStore((s) => s.playing);
  const visitor = useStore((s) => s.visitor);
  const eventScene = useStore((s) => s.eventScene);
  const guestName = useStore((s) =>
    s.visitor ? (s.roster[s.visitor.charId]?.displayName || s.roster[s.visitor.charId]?.handle || "your guest") : "",
  );
  const inScene = !!eventScene;
  const canGen = controller.canGenerateImages;
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const intensity = tierIntensity(tier);
  const game = playing ? GAME_BY_ID[playing.gameId] : null;

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

  const doAction = (a: QuickAction) => {
    setMenuOpen(false);
    void controller.submitAction({ text: a.prompt, source: "menu" });
  };

  const actions = LIVE_ACTIONS.filter((a) => (a.minIntensity ?? 0) <= intensity);

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
            <button className="btn" onClick={() => useStore.getState().openSettings()} title="Settings">⚙</button>
            <button className="btn btn--danger" disabled={resolving} onClick={() => void controller.endVisit()} title="Wrap up the visit">🚪 See them out</button>
          </>
        ) : eventScene ? (
          <>
            {canGen && (
              <button className="btn" disabled={resolving} onClick={() => void controller.generateScene()} title="Visualize this moment">📸 Visualize</button>
            )}
            <button className="btn" onClick={() => useStore.getState().openSettings("gallery")} title="Gallery">🖼</button>
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

            {game ? (
              <span className="actionbar__playing">🎮 {game.name}
                <button className="chiplink" onClick={() => controller.stopGame()}>stop</button>
              </span>
            ) : (
              <button className="btn" disabled={resolving} onClick={() => useStore.getState().setGamePickerOpen(true)}>🎮 Game</button>
            )}
            <button className="btn" onClick={() => useStore.getState().setGoalsOpen(true)} title="Goals">🎯</button>
            <button className="btn" onClick={() => useStore.getState().setInventoryOpen(true)} title="Inventory">🎒</button>
            <button className="btn" onClick={() => useStore.getState().openSettings("character")} title="Character appearance">🎭</button>
            <button className="btn" onClick={() => useStore.getState().openSettings("gallery")} title="Gallery">🖼</button>
            <button className="btn" onClick={() => useStore.getState().openSettings()} title="Settings">⚙</button>
            <button className="btn btn--danger" disabled={resolving} onClick={() => controller.endStream()}>⏹ End</button>
          </>
        ) : (
          <>
            <NichePicker controller={controller} disabled={resolving} />
            <button className="btn btn--primary" disabled={resolving || inScene} onClick={() => controller.goLive()}>● Go Live</button>
            <button className="btn" disabled={resolving || inScene} onClick={() => controller.sleep()}>🛏️ Sleep</button>
            <button className="btn" disabled={inScene} onClick={() => useStore.getState().setShopOpen(true)}>📦 Shop</button>
            <button className="btn" onClick={() => useStore.getState().setInventoryOpen(true)} title="Inventory">🎒</button>
            <button className="btn" onClick={() => useStore.getState().setGoalsOpen(true)} title="Goals">🎯</button>
            <button className="btn" onClick={() => useStore.getState().openSettings("character")} title="Character appearance">🎭</button>
            <button className="btn" onClick={() => useStore.getState().openSettings("gallery")} title="Gallery">🖼</button>
            <button className="btn" onClick={() => useStore.getState().openSettings()} title="Settings">⚙</button>
          </>
        )}
      </div>
    </footer>
  );
}

/** Schedule-board: pick the content niche you'll stream (shapes your audience). */
function NichePicker({ controller, disabled }: { controller: GameController; disabled: boolean }) {
  const niche = useStore((s) => s.settings.niche);
  return (
    <label className="nichepick" title={NICHES[niche]?.blurb}>
      <span className="nichepick__icon">🗓</span>
      <select
        className="nichepick__select"
        value={niche}
        disabled={disabled}
        onChange={(e) => controller.setNiche(e.target.value as NicheId)}
      >
        {NICHE_IDS.map((id) => (
          <option key={id} value={id}>{NICHES[id].label}</option>
        ))}
      </select>
    </label>
  );
}
