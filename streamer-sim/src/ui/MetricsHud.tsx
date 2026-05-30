import { useStore } from "../state/store";
import { formatClock } from "../game/time";

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

  return (
    <header className="hud">
      <div className="hud__brand">
        <span className="hud__logo">◉ Limelight</span>
        <span className="hud__name">
          {name} · Day {m.day} · {session.isLive ? `🔴 ${formatClock(clock)}` : "offline"}
        </span>
      </div>

      <div className="hud__stats">
        <Stat label="Cash" value={`$${m.cash.toFixed(0)}`} accent={m.cash < 0 ? "#ff6b6b" : "#8ce99a"} />
        <Stat label="Followers" value={m.followers.toLocaleString()} />
        <Stat label="Subs" value={m.subscribers.toLocaleString()} />
        <Stat label="Viewers" value={session.isLive ? Math.round(m.currentViewers).toLocaleString() : "—"} accent={session.isLive ? "#ff5d8f" : undefined} />
      </div>

      <div className="hud__meters">
        <Bar label="Hype" value={m.hype} color="#ffd43b" />
        <Bar label="Energy" value={m.energy} color="#74c0fc" />
        <Bar label="Mood" value={m.mood} color="#8ce99a" />
        <Bar label="Comfort" value={m.comfort} color="#da77f2" />
      </div>
    </header>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value" style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  );
}
