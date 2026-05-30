import { useStore } from "../state/store";
import type { GameController } from "../game/controller";
import { MINI_GAMES } from "../game/games";
import { SEGMENTS } from "../game/segments";

/** Modal to pick a mini-game to start streaming. */
export function GamePicker({ controller }: { controller: GameController }) {
  const open = useStore((s) => s.gamePickerOpen);
  if (!open) return null;
  const close = () => useStore.getState().setGamePickerOpen(false);

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>🎮 Start a game</h2>
          <button className="modal__close" onClick={close}>✕</button>
        </div>
        <div className="games">
          {MINI_GAMES.map((g) => (
            <button key={g.id} className="gamecard" onClick={() => controller.startGame(g.id)}>
              <span className="gamecard__emoji">{g.emoji}</span>
              <span className="gamecard__name">{g.name}</span>
              <span className="gamecard__blurb">{g.blurb}</span>
              <span className="gamecard__pleases">
                loves it: {g.pleases.map((p) => SEGMENTS[p].label).join(", ")}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
