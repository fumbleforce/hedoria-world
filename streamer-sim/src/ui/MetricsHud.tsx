import { useStore } from "../state/store";
import { formatClock } from "../game/time";
import { dateForDay } from "../game/calendar";
import { getActiveSlot } from "../persist/saves";
import { FloatingFeedback, useFeedbackJanitor } from "./FeedbackBubbles";
import { masteryProgress } from "../game/mastery";
import { BALANCE } from "../game/balance";
import { isNoLimits } from "../game/content";
import { MeterBar } from "./MeterBar";

export function MetricsHud() {
  const m = useStore((s) => s.metrics);
  const session = useStore((s) => s.session);
  const clock = useStore((s) => s.clock);
  const contentTier = useStore((s) => s.settings.contentTier);
  const handle = useStore((s) => s.brand.handle);
  const slotName = getActiveSlot().name;
  useFeedbackJanitor();
  const noLimits = isNoLimits(contentTier);

  return (
    <header className="hud">
      <div className="hud__brand">
        <span className="hud__logo">◉ Limelight</span>
        <span className="hud__name">
          @{handle || "streamer"} · {slotName} ·{" "}
          <button
            type="button"
            className="hud__datetime"
            onClick={() => useStore.getState().setCalendarOpen(true)}
            title="Open calendar"
          >
            Day {m.day} ({dateForDay(m.day).label}) ·{" "}
            {session.isLive ? `🔴 ${formatClock(clock)}` : `🕙 ${formatClock(clock)} · offline`}
          </button>
        </span>
      </div>

      <div className="hud__stats">
        <Stat label="Cash" metric="cash" value={`$${m.cash.toFixed(0)}`} accent={m.cash < 0 ? "#ff6b6b" : "#8ce99a"} />
        <Stat label="Followers" metric="followers" value={m.followers.toLocaleString()} />
        <Stat label="Subs" metric="subscribers" value={m.subscribers.toLocaleString()} />
      </div>

      <div className="hud__meters">
        <MeterBar label="Energy" metric="energy" value={m.energy} color="#74c0fc" />
        <MeterBar label="Comfort" metric="comfort" value={m.comfort} color="var(--accent-2)" />
        <MeterBar label="Hunger" metric="hunger" value={m.hunger} color="#e59949" />
        <MeterBar label="Bladder" metric="bladder" value={m.bladder} color="#91a7ff" />
        <MeterBar label="Hygiene" metric="hygiene" value={m.hygiene} color="#63e6be" />
        {noLimits && <MeterBar label="Horny" metric="horny" value={m.horny} color="#ff6b9d" />}
      </div>

      <MasteryChips />
    </header>
  );
}

const MASTERY_GLYPH: Record<string, string> = { showmanship: "🎭", composure: "🧘" };
const MASTERY_LABEL: Record<string, string> = { showmanship: "Showmanship", composure: "Composure" };

/** Compact skill-level readout — always visible from Lv 0 with progress to next. */
function MasteryChips() {
  const mastery = useStore((s) => s.mastery);
  return (
    <div className="hud__mastery">
      {BALANCE.mastery.domains.map((d) => {
        const xp = mastery[d] ?? 0;
        const { level, pct } = masteryProgress(xp);
        const pctHint = level < 10 ? ` · ${Math.round(pct * 100)}%` : "";
        return (
          <span
            key={d}
            className="masterychip"
            title={`${MASTERY_LABEL[d]} level ${level} — lower personal cost on matching actions`}
          >
            {MASTERY_GLYPH[d]} {MASTERY_LABEL[d]} <b>Lv {level}</b>
            {pctHint}
          </span>
        );
      })}
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
