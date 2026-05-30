import { useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";

/** Contextual menu raised by interacting with furniture: options + freeform. */
export function ActionMenuModal({ controller }: { controller: GameController }) {
  const menu = useStore((s) => s.actionMenu);
  const resolving = useStore((s) => s.resolving);
  const [text, setText] = useState("");
  if (!menu) return null;

  const close = () => useStore.getState().setActionMenu(null);

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{menu.title}</h2>
          <button className="modal__close" onClick={close}>✕</button>
        </div>
        {menu.subtitle && <p className="menu__subtitle">{menu.subtitle}</p>}

        <div className="menu__options">
          {menu.options.map((o) => (
            <button
              key={o.id}
              className="btn menu__option"
              disabled={resolving}
              onClick={() => controller.chooseOption(o)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {menu.allowFreeform && (
          <form
            className="menu__freeform"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              controller.freeform(text);
              setText("");
            }}
          >
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="…or describe what you do"
              disabled={resolving}
            />
            <button className="btn btn--primary" type="submit" disabled={resolving || !text.trim()}>
              Do it
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
