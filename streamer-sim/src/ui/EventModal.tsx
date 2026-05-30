import { useState } from "react";
import { useStore } from "../state/store";
import type { GameController } from "../game/controller";

export function EventModal({ controller }: { controller: GameController }) {
  const event = useStore((s) => s.pendingEvent);
  const resolving = useStore((s) => s.resolving);
  const [text, setText] = useState("");
  if (!event) return null;

  const sendFreeform = () => {
    if (!text.trim()) return;
    void controller.resolveEventFreeform(event, text);
    setText("");
  };

  return (
    <div className="modal">
      <div className={`modal__card event event--${event.tone}`}>
        <h2 className="event__title">{event.title}</h2>
        <p className="event__desc">{event.description}</p>
        <div className="event__choices">
          {event.choices.map((c, i) => (
            <button
              key={i}
              className="btn btn--primary event__choice"
              disabled={resolving}
              onClick={() => controller.resolveEvent(event, c)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {event.allowFreeform && (
          <form
            className="event__freeform"
            onSubmit={(e) => {
              e.preventDefault();
              sendFreeform();
            }}
          >
            <input
              className="actionbar__input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={event.freeformHint ?? "…or respond in your own words"}
              disabled={resolving}
            />
            <button className={`btn ${resolving ? "is-loading" : ""}`} type="submit" disabled={resolving || !text.trim()}>
              {resolving ? "…" : "Respond"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
