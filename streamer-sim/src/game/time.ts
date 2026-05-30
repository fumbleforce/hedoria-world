/**
 * In-world clock. A stream night runs on real wall-clock time (minutes since
 * midnight). Actions cost variable minutes; the day ends when it gets late or
 * energy runs out. "Continue" just passes a small chunk of time.
 */

/** Minutes since midnight a stream night begins. */
export const STREAM_START = 20 * 60; // 8:00 pm
/** Past this, the streamer is too tired to keep going; the night wraps. */
export const NIGHT_END = 26 * 60; // 2:00 am (26:00)

/** Per-action time costs, in minutes. Keep talking cheap, big bits expensive. */
export const TIME_COST = {
  trivial: 1, // a quick line to chat
  light: 3, // banter, react to one thing
  medium: 8, // a story, a segment
  heavy: 18, // a full bit, a game round
  continue: 6, // "just let it ride"
} as const;

export type TimeWeight = keyof typeof TIME_COST;

/** Format minutes-since-midnight as h:mm am/pm, wrapping past 24h. */
export function formatClock(minutes: number): string {
  const m = ((Math.floor(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 && h < 24 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mm.toString().padStart(2, "0")}${ampm}`;
}

/** How far into the night we are, 0..1, for pacing/event gating. */
export function nightProgress(clock: number): number {
  return Math.max(0, Math.min(1, (clock - STREAM_START) / (NIGHT_END - STREAM_START)));
}

/** Map an action's intensity to a time weight (heuristic for freeform actions). */
export function weightForIntensity(intensity: number): TimeWeight {
  if (intensity >= 4) return "heavy";
  if (intensity >= 3) return "medium";
  if (intensity >= 2) return "light";
  return "trivial";
}
