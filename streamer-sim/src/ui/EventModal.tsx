import { useStore } from "../state/store";
import type { GameController } from "../game/controller";

export function EventModal({ controller }: { controller: GameController }) {
  const event = useStore((s) => s.pendingEvent);
  if (!event) return null;

  return (
    <div className="modal">
      <div className={`modal__card event event--${event.tone}`}>
        <h2 className="event__title">{event.title}</h2>
        <p className="event__desc">{event.description}</p>
        <div className="event__choices">
          {event.choices.map((c, i) => (
            <button key={i} className="btn btn--primary event__choice" onClick={() => controller.resolveEvent(event, c)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
