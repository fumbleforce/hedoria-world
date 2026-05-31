import { useStore } from "../state/store";
import { formatClock } from "../game/time";
import { dateForDay } from "../game/calendar";
import { getActiveSlot } from "../persist/saves";
import { FloatingFeedback, useFeedbackJanitor } from "./FeedbackBubbles";
import { masteryLevel } from "../game/mastery";
import { BALANCE } from "../game/balance";

function Bar({ label, value, color, metric }: { label: string; value: number; color: string; metric: string }) {
  return (
    <div className="meter" title={`${label}: ${Math.round(value)}/100`}>
      <span className="meter__label">{label}</span>
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${value}%`, background: color }} />
      </span>
      <FloatingFeedback channel="metric" feedbackKey={metric} />
    </div>
  );
}

export function MetricsHud() {
  const m = useStore((s) => s.metrics);
  const session = useStore((s) => s.session);
  const clock = useStore((s) => s.clock);
  const name = useStore((s) => s.settings.streamerName);
  const slotName = getActiveSlot().name;
  useFeedbackJanitor();

  return (
    <header className="hud">
      <div className="hud__brand">
        <span className="hud__logo">◉ Limelight</span>
        <span className="hud__name">
          {name} · {slotName} · Day {m.day} ({dateForDay(m.day).label}) · {session.isLive ? `🔴 ${formatClock(clock)}` : "offline"}
        </span>
      </div>

      <div className="hud__stats">
        <Stat label="Cash" metric="cash" value={`$${m.cash.toFixed(0)}`} accent={m.cash < 0 ? "#ff6b6b" : "#8ce99a"} />
        <Stat label="Followers" metric="followers" value={m.followers.toLocaleString()} />
        <Stat label="Subs" metric="subscribers" value={m.subscribers.toLocaleString()} />
        <Stat label="Viewers" value={session.isLive ? Math.round(m.currentViewers).toLocaleString() : "—"} live={session.isLive} />
      </div>

      <div className="hud__meters">
        <Bar label="Hype" metric="hype" value={m.hype} color="#ffd43b" />
        <Bar label="Energy" metric="energy" value={m.energy} color="#74c0fc" />
        <Bar label="Mood" metric="mood" value={m.mood} color="#8ce99a" />
        <Bar label="Comfort" metric="comfort" value={m.comfort} color="var(--accent-2)" />
      </div>

      <MasteryChips />
    </header>
  );
}

const MASTERY_GLYPH: Record<string, string> = { showmanship: "🎭", composure: "🧘" };
const MASTERY_LABEL: Record<string, string> = { showmanship: "Showmanship", composure: "Composure" };

/** Compact skill-level readout (personal progression). Hidden until earned. */
function MasteryChips() {
  const mastery = useStore((s) => s.mastery);
  const chips = BALANCE.mastery.domains
    .map((d) => ({ d, lvl: masteryLevel(mastery[d] ?? 0) }))
    .filter((x) => x.lvl > 0);
  if (!chips.length) return null;
  return (
    <div className="hud__mastery">
      {chips.map(({ d, lvl }) => (
        <span key={d} className="masterychip" title={`${MASTERY_LABEL[d]} level ${lvl} — lower personal cost on matching actions`}>
          {MASTERY_GLYPH[d]} {MASTERY_LABEL[d]} <b>Lv {lvl}</b>
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value, accent, live, metric }: { label: string; value: string; accent?: string; live?: boolean; metric?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span
        className={`stat__value${live ? " stat__value--live" : ""}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
      {metric && <FloatingFeedback channel="metric" feedbackKey={metric} />}
    </div>
  );
}
