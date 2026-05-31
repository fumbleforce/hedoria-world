import { useStore } from "../state/store";
import { GOALS } from "../game/goals";
import type { ArcKind } from "../game/types";

const ARC_LABEL: Record<ArcKind, string> = {
  sponsorship: "📦 Sponsorship deal",
  viral: "🎬 Viral clip",
  "stalker-legal": "👮 The report",
  relationship: "💌 Something real",
};
const ARC_BLURB: Record<ArcKind, string> = {
  sponsorship: "A sponsor expects deliverables — there's money and reputation on the line.",
  viral: "A clip is spreading. A follower wave is coming… and maybe a backlash.",
  "stalker-legal": "Your report is working its way through. Closure is pending.",
  relationship: "A viewer you let in is becoming something more. Where does it go?",
};

/** Soft-objectives modal: progress bars toward each milestone, with payoffs. */
export function GoalsPanel() {
  const open = useStore((s) => s.goalsOpen);
  const metrics = useStore((s) => s.metrics);
  const completed = useStore((s) => s.completedGoals);
  const arcs = useStore((s) => s.arcs);
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

        {arcs.length > 0 && (
          <>
            <div className="prompts__group">Active story threads</div>
            <div className="goals">
              {arcs.map((arc) => (
                <div key={arc.id} className="goal goal--thread">
                  <div className="goal__top">
                    <span className="goal__label">{ARC_LABEL[arc.kind]}</span>
                    <span className="goal__value">next beat ~Day {arc.nextDay}</span>
                  </div>
                  <span className="goal__hint">{ARC_BLURB[arc.kind]}</span>
                </div>
              ))}
            </div>
            <div className="prompts__group" style={{ marginTop: 14 }}>Goals</div>
          </>
        )}

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
