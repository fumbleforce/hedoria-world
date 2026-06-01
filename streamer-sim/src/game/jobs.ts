/**
 * Day-job definitions and shift timing — offline wage work to survive rent/food.
 * Code owns wages, strikes, and clock windows; no LLM.
 */

import { formatClock, timeOfDay } from "./time";
import { randInt, uid } from "../rng/rng";

export const EARLY_WINDOW = 60;
export const ON_TIME_GRACE = 30;
export const LATE_WAGE_FACTOR = 0.6;
export const MAX_STRIKES = 3;
/** Applying takes an unpredictable chunk of the day — interviews, paperwork, waiting around. */
export const APPLY_MINUTES_MIN = 45;
export const APPLY_MINUTES_MAX = 300;

/** A random, uncertain amount of time spent landing a new job. */
export function randomApplyMinutes(): number {
  return randInt(APPLY_MINUTES_MIN, APPLY_MINUTES_MAX);
}

export type ShiftSlotId = "morning" | "afternoon" | "evening";

export type ShiftStatus = "early" | "ontime" | "late" | "over";

export interface ShiftSlot {
  id: ShiftSlotId;
  label: string;
  shiftStart: number;
  shiftEnd: number;
}

/** Same-day windows only (no midnight wrap). */
export const SHIFT_SLOTS: Record<ShiftSlotId, ShiftSlot> = {
  morning: { id: "morning", label: "Morning (8am–2pm)", shiftStart: 8 * 60, shiftEnd: 14 * 60 },
  afternoon: { id: "afternoon", label: "Afternoon (1pm–7pm)", shiftStart: 13 * 60, shiftEnd: 19 * 60 },
  evening: { id: "evening", label: "Evening (5pm–11pm)", shiftStart: 17 * 60, shiftEnd: 23 * 60 },
};

export const SHIFT_SLOT_ORDER: ShiftSlotId[] = ["morning", "afternoon", "evening"];

export interface JobPreset {
  id: string;
  title: string;
  blurb: string;
  wage: number;
  shiftStart: number;
  shiftEnd: number;
  energyCost: number;
  hygieneCost?: number;
  comfortCost?: number;
}

export interface JobState {
  id: string;
  title: string;
  wage: number;
  shiftStart: number;
  shiftEnd: number;
  energyCost: number;
  hygieneCost?: number;
  comfortCost?: number;
  strikes: number;
  lastClockInDay: number | null;
  lastClockInOnTime: boolean;
}

/**
 * Active "at work" overlay state. Entered on clock-in; effects (pay, time, stat
 * costs) are deferred until the player heads home so the whole thing survives a
 * reload mid-shift. The image is cached per job (generate once) via the normal
 * image pipeline; `flavor` is LLM/offline text generated once per shift.
 */
export interface WorkSession {
  jobId: string;
  title: string;
  /** In-world day the shift belongs to (for strike accounting on head-home). */
  day: number;
  onTime: boolean;
  /** Deferred payout applied on head-home. */
  pay: number;
  /** Minutes the clock advances on head-home. */
  minutes: number;
  energyCost: number;
  hygieneCost?: number;
  comfortCost?: number;
  /** Generated workplace image id (null until rendered / if no backend). */
  imageId: string | null;
  /** Generated shift flavor text (empty until written). */
  flavor: string;
}

/** Offline flavor used when there's no LLM backend (or it fails). */
export const WORK_FLAVOR_FALLBACKS: string[] = [
  "The shift blurs by — a rhythm of small tasks, half-heard small talk, and the slow crawl of the clock. By the end your feet ache, but the pay is real.",
  "You clock in, put your head down, and grind through it. Nothing dramatic, just the steady churn of earning a living between streams.",
  "Customers, tasks, a couple of awkward moments, one genuinely nice exchange. The hours add up and so does the paycheck.",
  "It's not glamorous, but it's money. You zone out, get the work done, and let your mind drift to tonight's stream.",
];

export const JOB_PRESETS: JobPreset[] = [
  {
    id: "barista",
    title: "Barista",
    blurb: "Early shifts, decent tips energy. Out by afternoon — room to stream later.",
    wage: 62,
    shiftStart: SHIFT_SLOTS.morning.shiftStart,
    shiftEnd: SHIFT_SLOTS.morning.shiftEnd,
    energyCost: 22,
    hygieneCost: 8,
  },
  {
    id: "warehouse",
    title: "Warehouse Packer",
    blurb: "Steady pay, brutal on your body. Afternoon shift eats your prime hours.",
    wage: 78,
    shiftStart: SHIFT_SLOTS.afternoon.shiftStart,
    shiftEnd: SHIFT_SLOTS.afternoon.shiftEnd,
    energyCost: 32,
    hygieneCost: 12,
    comfortCost: -4,
  },
  {
    id: "rideshare",
    title: "Rideshare Driver",
    blurb: "Flexible-ish evening runs. Pay varies with hustle; tough to stream after.",
    wage: 70,
    shiftStart: SHIFT_SLOTS.evening.shiftStart,
    shiftEnd: SHIFT_SLOTS.evening.shiftEnd,
    energyCost: 26,
    comfortCost: -3,
  },
  {
    id: "dog-walker",
    title: "Dog Walker",
    blurb: "Morning routes in the park. Light pay, leaves energy for a night stream.",
    wage: 55,
    shiftStart: SHIFT_SLOTS.morning.shiftStart,
    shiftEnd: SHIFT_SLOTS.morning.shiftEnd,
    energyCost: 18,
    hygieneCost: 5,
  },
  {
    id: "call-center",
    title: "Call Center",
    blurb: "Scripted headset grind. Reliable wage, soul-crushing afternoon block.",
    wage: 68,
    shiftStart: SHIFT_SLOTS.afternoon.shiftStart,
    shiftEnd: SHIFT_SLOTS.afternoon.shiftEnd,
    energyCost: 24,
    comfortCost: -6,
  },
  {
    id: "freelance-design",
    title: "Freelance Designer",
    blurb: "Evening client blocks from home. Better pay if you actually show up on time.",
    wage: 88,
    shiftStart: SHIFT_SLOTS.evening.shiftStart,
    shiftEnd: SHIFT_SLOTS.evening.shiftEnd,
    energyCost: 20,
    comfortCost: -2,
  },
  {
    id: "retail-clerk",
    title: "Retail Clerk",
    blurb: "Floor shifts and register duty. Steady hours, drains your social battery.",
    wage: 58,
    shiftStart: SHIFT_SLOTS.afternoon.shiftStart,
    shiftEnd: SHIFT_SLOTS.afternoon.shiftEnd,
    energyCost: 20,
    comfortCost: -3,
  },
  {
    id: "security-guard",
    title: "Security Guard",
    blurb: "Evening patrols in a quiet building. Boring pay, leaves mornings free.",
    wage: 64,
    shiftStart: SHIFT_SLOTS.evening.shiftStart,
    shiftEnd: SHIFT_SLOTS.evening.shiftEnd,
    energyCost: 16,
    hygieneCost: 4,
  },
  {
    id: "tutor",
    title: "Private Tutor",
    blurb: "Afternoon sessions with students. Decent pay if you stay patient.",
    wage: 72,
    shiftStart: SHIFT_SLOTS.afternoon.shiftStart,
    shiftEnd: SHIFT_SLOTS.afternoon.shiftEnd,
    energyCost: 18,
    comfortCost: -2,
  },
  {
    id: "library-assistant",
    title: "Library Assistant",
    blurb: "Quiet morning stacks and checkouts. Low stress, modest wage.",
    wage: 54,
    shiftStart: SHIFT_SLOTS.morning.shiftStart,
    shiftEnd: SHIFT_SLOTS.morning.shiftEnd,
    energyCost: 14,
  },
  {
    id: "dishwasher",
    title: "Dishwasher",
    blurb: "Back-of-house evening grind. Hot, wet, and over before midnight.",
    wage: 56,
    shiftStart: SHIFT_SLOTS.evening.shiftStart,
    shiftEnd: SHIFT_SLOTS.evening.shiftEnd,
    energyCost: 28,
    hygieneCost: 10,
  },
  {
    id: "pharmacy-tech",
    title: "Pharmacy Tech",
    blurb: "Morning retail pharmacy counter. Steady paycheck, standing all shift.",
    wage: 74,
    shiftStart: SHIFT_SLOTS.morning.shiftStart,
    shiftEnd: SHIFT_SLOTS.morning.shiftEnd,
    energyCost: 20,
    hygieneCost: 6,
  },
  {
    id: "gym-desk",
    title: "Gym Front Desk",
    blurb: "Early check-ins and towel duty. Free energy from the morning crowd.",
    wage: 60,
    shiftStart: SHIFT_SLOTS.morning.shiftStart,
    shiftEnd: SHIFT_SLOTS.morning.shiftEnd,
    energyCost: 16,
  },
  {
    id: "night-auditor",
    title: "Night Auditor",
    blurb: "Late-evening hotel desk solo shift. Quiet hours, weird guests.",
    wage: 82,
    shiftStart: SHIFT_SLOTS.evening.shiftStart,
    shiftEnd: SHIFT_SLOTS.evening.shiftEnd,
    energyCost: 22,
    comfortCost: -4,
  },
  {
    id: "delivery-courier",
    title: "Delivery Courier",
    blurb: "Afternoon route runs on a bike. Hustle-dependent, keeps you moving.",
    wage: 66,
    shiftStart: SHIFT_SLOTS.afternoon.shiftStart,
    shiftEnd: SHIFT_SLOTS.afternoon.shiftEnd,
    energyCost: 24,
    hygieneCost: 8,
  },
];

export const JOB_PRESET_BY_ID: Record<string, JobPreset> = Object.fromEntries(
  JOB_PRESETS.map((p) => [p.id, p]),
);

export function shiftWindowLabel(job: Pick<JobState, "shiftStart" | "shiftEnd">): string {
  return `${formatClock(job.shiftStart)} – ${formatClock(job.shiftEnd)}`;
}

export function workedToday(job: JobState, day: number): boolean {
  return job.lastClockInDay === day;
}

/** Whether the player can still clock in today (not already worked, window not over). */
export function canClockInToday(job: JobState, clock: number, day: number): boolean {
  if (workedToday(job, day)) return false;
  return shiftStatus(job, clock) !== "over";
}

export function shiftStatus(
  job: Pick<JobState, "shiftStart" | "shiftEnd">,
  clock: number,
): ShiftStatus {
  const t = timeOfDay(clock);
  const start = timeOfDay(job.shiftStart);
  const end = timeOfDay(job.shiftEnd);
  const earlyFrom = start - EARLY_WINDOW;
  const lateAfter = start + ON_TIME_GRACE;

  if (t < earlyFrom) return "early";
  if (t > end) return "over";
  if (t <= lateAfter) return "ontime";
  return "late";
}

export function shiftStatusLabel(status: ShiftStatus): string {
  switch (status) {
    case "early":
      return "Too early";
    case "ontime":
      return "On time";
    case "late":
      return "Late";
    case "over":
      return "Shift over";
  }
}

export function jobFromPreset(preset: JobPreset): JobState {
  return {
    id: preset.id,
    title: preset.title,
    wage: preset.wage,
    shiftStart: preset.shiftStart,
    shiftEnd: preset.shiftEnd,
    energyCost: preset.energyCost,
    hygieneCost: preset.hygieneCost,
    comfortCost: preset.comfortCost,
    strikes: 0,
    lastClockInDay: null,
    lastClockInOnTime: false,
  };
}

export function randomJobPreset(): JobPreset {
  return JOB_PRESETS[Math.floor(Math.random() * JOB_PRESETS.length)]!;
}

export function isCustomJobId(id: string): boolean {
  return id.startsWith("custom-");
}

export function customJob(title: string, wage: number, slot: ShiftSlotId): JobState {
  const s = SHIFT_SLOTS[slot];
  const trimmed = title.trim().slice(0, 48) || "Side gig";
  const w = Math.max(40, Math.min(120, Math.round(wage)));
  return {
    id: `custom-${uid("job")}`,
    title: trimmed,
    wage: w,
    shiftStart: s.shiftStart,
    shiftEnd: s.shiftEnd,
    energyCost: 22,
    strikes: 0,
    lastClockInDay: null,
    lastClockInOnTime: false,
  };
}

/** Minutes from now until shift end (for advancing the clock after clock-in). */
export function workMinutesRemaining(job: JobState, clock: number): number {
  const t = timeOfDay(clock);
  const end = timeOfDay(job.shiftEnd);
  return Math.max(15, end - t);
}
