/**
 * Soft objectives — a spine for the sandbox. Goals are passive: they watch the
 * metrics and complete on their own, paying out a small reward + a celebratory
 * beat. They're not required, but they give direction (grow, bank rent, go
 * full-time) and reward milestones.
 */

import type { Metrics } from "./types";

export interface GoalState {
  metrics: Metrics;
  /** Best concurrent viewers seen, for "peak" goals. */
  peakViewers: number;
}

export interface Goal {
  id: string;
  label: string;
  hint: string;
  /** Current progress 0..1 and a human value like "640 / 1,000". */
  progress: (s: GoalState) => { ratio: number; value: string };
  /** Reward applied once on completion. */
  reward: Partial<Metrics>;
  /** Line shown when it completes. */
  rewardText: string;
}

const ratio = (cur: number, target: number) => Math.max(0, Math.min(1, cur / target));
const fmt = (n: number) => Math.round(n).toLocaleString();

export const GOALS: Goal[] = [
  {
    id: "followers-100",
    label: "First 100 followers",
    hint: "Grow a little audience.",
    progress: (s) => ({ ratio: ratio(s.metrics.followers, 100), value: `${fmt(s.metrics.followers)} / 100` }),
    reward: { hype: 6, mood: 5 },
    rewardText: "100 followers! The room finally feels alive.",
  },
  {
    id: "viewers-100",
    label: "100 concurrent viewers",
    hint: "Pull a real crowd at once.",
    progress: (s) => ({ ratio: ratio(s.peakViewers, 100), value: `${fmt(s.peakViewers)} / 100 peak` }),
    reward: { hype: 8, mood: 6 },
    rewardText: "100 people watching at once — you're not talking to an empty room anymore.",
  },
  {
    id: "subs-10",
    label: "10 subscribers",
    hint: "Build recurring support.",
    progress: (s) => ({ ratio: ratio(s.metrics.subscribers, 10), value: `${fmt(s.metrics.subscribers)} / 10` }),
    reward: { cash: 50, mood: 6 },
    rewardText: "10 subs — predictable income, and people who chose to stick around.",
  },
  {
    id: "rent-buffer",
    label: "Bank a rent buffer",
    hint: "Save $2,000 so a slow week can't sink you.",
    progress: (s) => ({ ratio: ratio(s.metrics.cash, 2000), value: `$${fmt(s.metrics.cash)} / $2,000` }),
    reward: { mood: 10, comfort: 8 },
    rewardText: "$2,000 banked. For the first time, rent isn't a knot in your stomach.",
  },
  {
    id: "followers-1k",
    label: "1,000 followers",
    hint: "Cross into real-channel territory.",
    progress: (s) => ({ ratio: ratio(s.metrics.followers, 1000), value: `${fmt(s.metrics.followers)} / 1,000` }),
    reward: { hype: 12, mood: 10, cash: 100 },
    rewardText: "1,000 followers. This is a real channel now.",
  },
  {
    id: "survive-month",
    label: "Survive a month",
    hint: "Make it to Day 30 without going broke.",
    progress: (s) => ({ ratio: ratio(s.metrics.day, 30), value: `Day ${s.metrics.day} / 30` }),
    reward: { mood: 12, comfort: 10 },
    rewardText: "A full month of making rent off the stream. You're actually doing this.",
  },
  {
    id: "full-time-10k",
    label: "Go full-time",
    hint: "Hit 10,000 followers — quit-the-day-job numbers.",
    progress: (s) => ({ ratio: ratio(s.metrics.followers, 10000), value: `${fmt(s.metrics.followers)} / 10,000` }),
    reward: { hype: 20, mood: 18, cash: 500 },
    rewardText: "10,000 followers. You can do this full-time. The dream is real.",
  },
];

/** Goals newly satisfied this tick that aren't already in `completed`. */
export function newlyCompletedGoals(s: GoalState, completed: string[]): Goal[] {
  const done = new Set(completed);
  return GOALS.filter((g) => !done.has(g.id) && g.progress(s).ratio >= 1);
}
