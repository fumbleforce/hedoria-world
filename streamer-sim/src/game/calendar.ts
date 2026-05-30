/**
 * A lightweight in-world calendar. The game tracks `metrics.day` as an integer
 * (Day 1, 2, 3…); this maps that onto a real-feeling date so seasonal beats
 * (holidays, the channel's anniversary, the streamer's birthday) can fire.
 */

// Day 1 maps to this calendar date. Late September gives Halloween early-ish in
// a playthrough without making the first week a holiday blowout.
const EPOCH = Date.UTC(2025, 8, 22); // Sept 22
const MS_PER_DAY = 86_400_000;

export interface InWorldDate {
  month: number; // 1-12
  dayOfMonth: number;
  /** e.g. "October 31". */
  label: string;
}

export function dateForDay(day: number): InWorldDate {
  const d = new Date(EPOCH + (Math.max(1, day) - 1) * MS_PER_DAY);
  return {
    month: d.getUTCMonth() + 1,
    dayOfMonth: d.getUTCDate(),
    label: d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }),
  };
}

export interface Occasion {
  id: string;
  name: string;
  /** Mechanical seed the LLM rewrites; sets the scene for the special stream. */
  seed: string;
  tone: "good" | "neutral";
  /** A gentle tip/hype tailwind for streaming on this day. */
  bonus: { hype?: number; mood?: number; cashTips?: number };
}

/** Parse a "MM-DD" birthday string into [month, day], or null. */
function parseBirthday(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [month, day];
}

/**
 * The occasion (if any) for a given in-world day. Birthday takes precedence,
 * then fixed holidays, then channel milestones (anniversary, monthly mark).
 */
export function occasionForDay(day: number, opts?: { birthday?: string }): Occasion | null {
  const { month, dayOfMonth } = dateForDay(day);

  const bday = parseBirthday(opts?.birthday);
  if (bday && bday[0] === month && bday[1] === dayOfMonth) {
    return {
      id: "birthday",
      name: "🎂 Your birthday stream",
      seed: "It's your birthday and chat found out. The room fills with cake spam, gift subs, and an outpouring of donations.",
      tone: "good",
      bonus: { hype: 14, mood: 12, cashTips: 120 },
    };
  }

  if (month === 10 && dayOfMonth === 31) {
    return {
      id: "halloween",
      name: "🎃 Halloween stream",
      seed: "Halloween night. You're in costume, the lighting is spooky, and chat wants scares and candy.",
      tone: "good",
      bonus: { hype: 12, cashTips: 60 },
    };
  }
  if (month === 12 && dayOfMonth === 25) {
    return {
      id: "christmas",
      name: "🎄 Holiday stream",
      seed: "Christmas night. Cozy, sentimental, a little lonely for some of chat — gift subs rain down.",
      tone: "good",
      bonus: { hype: 8, mood: 8, cashTips: 100 },
    };
  }
  if (month === 12 && dayOfMonth === 31) {
    return {
      id: "nye",
      name: "🎆 New Year's Eve",
      seed: "New Year's Eve. A countdown, resolutions in chat, hype building toward midnight.",
      tone: "good",
      bonus: { hype: 16, cashTips: 80 },
    };
  }
  if (month === 2 && dayOfMonth === 14) {
    return {
      id: "valentines",
      name: "💕 Valentine's stream",
      seed: "Valentine's Day. The simps are out in force, the parasocial energy is high, and donations carry little love notes.",
      tone: "good",
      bonus: { hype: 10, cashTips: 90 },
    };
  }

  // Channel anniversary — every 365 days after launch.
  if (day > 1 && (day - 1) % 365 === 0) {
    const years = (day - 1) / 365;
    return {
      id: "anniversary",
      name: `🎉 ${years}-year anniversary`,
      seed: `It's been ${years} year${years > 1 ? "s" : ""} since you first went live. Long-time regulars reminisce; the community celebrates how far you've come.`,
      tone: "good",
      bonus: { hype: 12, mood: 10, cashTips: 70 },
    };
  }

  // Monthly milestone — a smaller "one month further" beat.
  if (day > 1 && (day - 1) % 30 === 0) {
    const months = (day - 1) / 30;
    return {
      id: "month-milestone",
      name: `📅 ${months} month${months > 1 ? "s" : ""} streaming`,
      seed: `Another month of streaming in the books (${months} total). A quiet sense of momentum; chat notes the milestone.`,
      tone: "neutral",
      bonus: { mood: 6, cashTips: 25 },
    };
  }

  return null;
}
