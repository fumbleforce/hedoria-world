import { useStore } from "../state/store";
import type { ChangeLogEntry } from "../game/types";

/**
 * The activity log under the studio map: a scrollable, newest-first feed of every
 * metric, affinity, and alert change — with the "why" when we know it. Complements
 * the transient floating bubbles with a persistent (per-session) history.
 */
export function ChangeLogPanel() {
  const log = useStore((s) => s.changeLog);

  return (
    <section className="changelog">
      <div className="changelog__head">
        <span>Activity</span>
        <span className="changelog__count">{log.length}</span>
      </div>
      {log.length === 0 ? (
        <p className="changelog__empty">
          Stat &amp; affinity changes will stream in here as you play.
        </p>
      ) : (
        <ul className="changelog__list">
          {log.map((e) => (
            <LogRow key={e.id} e={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LogRow({ e }: { e: ChangeLogEntry }) {
  const delta = formatDelta(e);
  return (
    <li className="changelog__row" title={e.reason}>
      {delta && <span className={`changelog__delta changelog__delta--${e.tone}`}>{delta}</span>}
      <span className="changelog__label">{e.label}</span>
      {e.reason && <span className="changelog__reason">{e.reason}</span>}
    </li>
  );
}

function formatDelta(e: ChangeLogEntry): string {
  if (e.delta == null) return e.text ?? "";
  const sign = e.delta >= 0 ? "+" : "−";
  const mag = Math.abs(e.delta);
  if (e.unit === "cash") return `${sign}$${mag >= 1 ? Math.round(mag) : mag.toFixed(2)}`;
  if (e.unit === "affinity") return `${sign}${mag.toFixed(1)}`;
  return `${sign}${Math.round(mag) || mag.toFixed(1)}`;
}
