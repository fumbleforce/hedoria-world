/**
 * In-world clock. Time always advances — live or offline — in minutes since
 * midnight on the current in-world day (can exceed 1440 before sleep wraps the
 * day). Actions cost variable minutes; sleep jumps to the next morning.
 */

/** Default clock when a new save begins — morning, so day streams are natural. */
export const WAKE_TIME = 9 * 60; // 9:00 am
/** Legacy evening default — still used for night-biased pacing helpers. */
export const STREAM_START = 20 * 60; // 8:00 pm
/** Past this (2:00 am on the extended clock), a live stream auto-ends. */
export const NIGHT_END = 26 * 60; // 2:00 am (26:00)

/**
 * Per-action time costs, in minutes. A stream is hours long, so beats are chunky:
 * talking eats ~15 min, doing a real bit ~30, a big production ~45. Keeps a night
 * to a dozen-ish beats instead of a minute-by-minute crawl.
 */
export const TIME_COST = {
  trivial: 10, // a quick line to chat
  light: 15, // banter, react to one thing — "just talking"
  medium: 30, // a story, a segment — "doing some action"
  heavy: 45, // a full bit, a game round
  continue: 15, // "just let it ride"
} as const;

export type TimeWeight = keyof typeof TIME_COST;

export type DayPhase = "morning" | "afternoon" | "evening" | "late";

const MINUTES_PER_DAY = 24 * 60;

/** Normalize any clock value to 0..1439 for time-of-day comparisons. */
export function timeOfDay(clock: number): number {
  return ((Math.floor(clock) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Format minutes-since-midnight as h:mm am/pm, wrapping past 24h. */
export function formatClock(minutes: number): string {
  const m = timeOfDay(minutes);
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 && h < 24 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mm.toString().padStart(2, "0")}${ampm}`;
}

/** Broad part of the day — drives which archetypes tend to be around. */
export function dayPhase(clock: number): DayPhase {
  const h = timeOfDay(clock) / 60;
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 23) return "evening";
  return "late";
}

/** Clock after sleeping to the next in-world morning. */
export function clockAfterSleep(_currentClock: number): number {
  return WAKE_TIME;
}

/** Minutes spent asleep before the next WAKE_TIME (for overnight need drain). */
export function sleepDurationMinutes(clock: number): number {
  const tod = timeOfDay(clock);
  if (tod >= WAKE_TIME) return MINUTES_PER_DAY - tod + WAKE_TIME;
  return WAKE_TIME - tod;
}

/** True when a live session should auto-end for lateness (past ~2am). */
export function streamTooLate(clock: number): boolean {
  return clock >= NIGHT_END;
}

/** Minutes elapsed since a stream started at `streamStartClock`. */
export function streamElapsed(clock: number, streamStartClock: number): number {
  return Math.max(0, clock - streamStartClock);
}

/** How far into a classic evening stream we are, 0..1 (legacy pacing helper). */
export function nightProgress(clock: number): number {
  return Math.max(0, Math.min(1, (clock - STREAM_START) / (NIGHT_END - STREAM_START)));
}

/**
 * Whether `clock` falls inside [start, end] on the 24h circle. Supports windows
 * that wrap past midnight (e.g. 22:00–02:00).
 */
export function isInMinuteWindow(clock: number, start: number, end: number): boolean {
  const t = timeOfDay(clock);
  const s = timeOfDay(start);
  const e = timeOfDay(end);
  if (s <= e) return t >= s && t <= e;
  return t >= s || t <= e;
}

/** Map an action's intensity to a time weight (heuristic for freeform actions). */
export function weightForIntensity(intensity: number): TimeWeight {
  if (intensity >= 4) return "heavy";
  if (intensity >= 3) return "medium";
  if (intensity >= 2) return "light";
  return "trivial";
}
