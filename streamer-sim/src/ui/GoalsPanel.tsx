import { useStore } from "../state/store";
import { GOALS } from "../game/goals";

/** Soft-objectives modal: progress bars toward each milestone, with payoffs. */
export function GoalsPanel() {
  const open = useStore((s) => s.goalsOpen);
  const metrics = useStore((s) => s.metrics);
  const completed = useStore((s) => s.completedGoals);
  const close = useStore((s) => s.setGoalsOpen);
  if (!open) return null;

  const state = { metrics, peakViewers: metrics.peakViewers };
  const done = new Set(completed);
  const sorted = [...GOALS].sort((a, b) => {
    const ad = done.has(a.id) ? 1 : 0;
    const bd = done.has(b.id) ? 1 : 0;
    if (ad !== bd) return ad - bd; // active first, completed last
    return b.progress(state).ratio - a.progress(state).ratio;
  });

  return (
    <div className="modal" onClick={() => close(false)}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>🎯 Goals</h2>
          <button className="modal__close" onClick={() => close(false)}>✕</button>
        </div>

        <p className="hint">Soft objectives — they complete on their own and pay out a little when you hit them.</p>
        <div className="goals">
          {sorted.map((g) => {
            const isDone = done.has(g.id);
            const { ratio, value } = g.progress(state);
            return (
              <div key={g.id} className={`goal ${isDone ? "goal--done" : ""}`}>
                <div className="goal__top">
                  <span className="goal__label">{isDone ? "✓ " : ""}{g.label}</span>
                  <span className="goal__value">{isDone ? "Complete" : value}</span>
                </div>
                <div className="goal__bar">
                  <span className="goal__fill" style={{ width: `${Math.round((isDone ? 1 : ratio) * 100)}%` }} />
                </div>
                <span className="goal__hint">{g.hint}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
