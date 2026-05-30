import { useStore } from "../state/store";
import { formatClock } from "../game/time";
import { dateForDay } from "../game/calendar";
import { getActiveSlot } from "../persist/saves";

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="meter" title={`${label}: ${Math.round(value)}/100`}>
      <span className="meter__label">{label}</span>
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${value}%`, background: color }} />
      </span>
    </div>
  );
}

export function MetricsHud() {
  const m = useStore((s) => s.metrics);
  const session = useStore((s) => s.session);
  const clock = useStore((s) => s.clock);
  const name = useStore((s) => s.settings.streamerName);
  const slotName = getActiveSlot().name;

  return (
    <header className="hud">
      <div className="hud__brand">
        <span className="hud__logo">◉ Limelight</span>
        <span className="hud__name">
          {name} · {slotName} · Day {m.day} ({dateForDay(m.day).label}) · {session.isLive ? `🔴 ${formatClock(clock)}` : "offline"}
        </span>
      </div>

      <div className="hud__stats">
        <Stat label="Cash" value={`$${m.cash.toFixed(0)}`} accent={m.cash < 0 ? "#ff6b6b" : "#8ce99a"} />
        <Stat label="Followers" value={m.followers.toLocaleString()} />
        <Stat label="Subs" value={m.subscribers.toLocaleString()} />
        <Stat label="Viewers" value={session.isLive ? Math.round(m.currentViewers).toLocaleString() : "—"} live={session.isLive} />
      </div>

      <div className="hud__meters">
        <Bar label="Hype" value={m.hype} color="#ffd43b" />
        <Bar label="Energy" value={m.energy} color="#74c0fc" />
        <Bar label="Mood" value={m.mood} color="#8ce99a" />
        <Bar label="Comfort" value={m.comfort} color="var(--accent-2)" />
      </div>
    </header>
  );
}

function Stat({ label, value, accent, live }: { label: string; value: string; accent?: string; live?: boolean }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span
        className={`stat__value${live ? " stat__value--live" : ""}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
