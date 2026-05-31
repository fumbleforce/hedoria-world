import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { formatClock } from "../game/time";
import {
  dateForDay,
  FIXED_HOLIDAYS,
  formatOccasionBonus,
  inWorldYear,
  monthGrid,
  monthLabel,
  shiftMonth,
  type CalendarCell,
} from "../game/calendar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Calendar modal — special days, holidays, and channel milestones. */
export function CalendarPanel() {
  const open = useStore((s) => s.calendarOpen);
  const close = useStore((s) => s.setCalendarOpen);
  const day = useStore((s) => s.metrics.day);
  const birthday = useStore((s) => s.settings.streamerBirthday);
  const clock = useStore((s) => s.clock);
  const isLive = useStore((s) => s.session.isLive);

  const today = dateForDay(day);
  const [viewYear, setViewYear] = useState(() => inWorldYear(day));
  const [viewMonth, setViewMonth] = useState(() => today.month);
  const [selected, setSelected] = useState<CalendarCell | null>(null);

  useEffect(() => {
    if (!open) return;
    setViewYear(inWorldYear(day));
    setViewMonth(today.month);
    setSelected(null);
  }, [open, day, today.month]);

  const cells = useMemo(
    () => monthGrid(viewYear, viewMonth, day, { birthday }),
    [viewYear, viewMonth, day, birthday],
  );

  const monthSpecials = useMemo(
    () =>
      cells
        .filter((c) => c.dayOfMonth > 0 && c.occasion && !c.isBeforeStart)
        .sort((a, b) => a.dayOfMonth - b.dayOfMonth),
    [cells],
  );

  if (!open) return null;

  const goMonth = (delta: number) => {
    const next = shiftMonth(viewYear, viewMonth, delta);
    setViewYear(next.year);
    setViewMonth(next.month);
    setSelected(null);
  };

  return (
    <div className="modal" onClick={() => close(false)}>
      <div className="modal__card modal__card--wide calendar" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>📅 Calendar</h2>
          <button type="button" className="modal__close" onClick={() => close(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="calendar__today">
          Today: Day {day} · {today.label}
          {isLive ? ` · 🔴 ${formatClock(clock)}` : ` · 🕙 ${formatClock(clock)}`}
        </p>

        <div className="calendar__nav">
          <button type="button" className="btn btn--ghost calendar__navbtn" onClick={() => goMonth(-1)} aria-label="Previous month">
            ‹
          </button>
          <span className="calendar__month">{monthLabel(viewYear, viewMonth)}</span>
          <button type="button" className="btn btn--ghost calendar__navbtn" onClick={() => goMonth(1)} aria-label="Next month">
            ›
          </button>
        </div>

        <div className="calendar__weekdays">
          {WEEKDAYS.map((d) => (
            <span key={d} className="calendar__weekday">
              {d}
            </span>
          ))}
        </div>

        <div className="calendar__grid">
          {cells.map((cell, i) =>
            cell.dayOfMonth === 0 ? (
              <span key={`empty-${i}`} className="calday calday--empty" />
            ) : (
              <button
                key={`${viewYear}-${viewMonth}-${cell.dayOfMonth}`}
                type="button"
                className={[
                  "calday",
                  cell.isToday ? "calday--today" : "",
                  cell.isPast ? "calday--past" : "",
                  cell.isBeforeStart ? "calday--pre" : "",
                  cell.occasion ? "calday--special" : "",
                  selected?.dayOfMonth === cell.dayOfMonth ? "calday--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelected(cell)}
                title={
                  cell.occasion
                    ? cell.occasion.name
                    : cell.isBeforeStart
                      ? "Before your channel started"
                      : cell.gameDay
                        ? `Day ${cell.gameDay}`
                        : undefined
                }
              >
                <span className="calday__num">{cell.dayOfMonth}</span>
                {cell.occasion && <span className="calday__dot" aria-hidden />}
              </button>
            ),
          )}
        </div>

        <div className="calendar__lower">
          <section className="calendar__section">
            <h3 className="calendar__sectiontitle">Special days this month</h3>
            {monthSpecials.length === 0 ? (
              <p className="hint">No holidays or milestones land in this month.</p>
            ) : (
              <ul className="calendar__list">
                {monthSpecials.map((cell) => (
                  <li key={cell.dayOfMonth}>
                    <button
                      type="button"
                      className="calendar__listbtn"
                      onClick={() => setSelected(cell)}
                    >
                      <span className="calendar__listdate">{cell.dayOfMonth}</span>
                      <span className="calendar__listname">{cell.occasion!.name}</span>
                      <span className="calendar__listbonus">{formatOccasionBonus(cell.occasion!.bonus)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="calendar__section">
            <h3 className="calendar__sectiontitle">Recurring beats</h3>
            <ul className="calendar__legend">
              {FIXED_HOLIDAYS.map((h) => (
                <li key={h.label}>{h.label}</li>
              ))}
              {birthday.trim() && <li>🎂 Your birthday ({birthday.trim()})</li>}
              <li>🎉 Channel anniversary — every 365 in-world days</li>
              <li>📅 Streaming milestone — every 30 in-world days</li>
            </ul>
            <p className="hint calendar__hint">
              Streaming on a special day gives a small hype/comfort/tips tailwind. Set your birthday in Settings.
            </p>
          </section>
        </div>

        {selected && selected.dayOfMonth > 0 && (
          <div className="calendar__detail">
            <div className="calendar__detailhead">
              <strong>
                {selected.dayOfMonth} ·{" "}
                {selected.gameDay ? `Day ${selected.gameDay}` : "Before launch"}
              </strong>
              {selected.isToday && <span className="calendar__tag">Today</span>}
            </div>
            {selected.occasion ? (
              <>
                <div className="calendar__detailname">{selected.occasion.name}</div>
                <p className="calendar__detailseed">{selected.occasion.seed}</p>
                <p className="calendar__detailbonus">{formatOccasionBonus(selected.occasion.bonus)}</p>
              </>
            ) : (
              <p className="hint">A regular day — no scripted occasion.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
