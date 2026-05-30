/**
 * Action taxonomy: the bounded vocabulary the LLM evaluator must speak, plus
 * the menu/contextual actions that are pre-labeled shortcuts through the same
 * pipeline.
 */

import type { SegmentId } from "./segments";

/** The closed set of tags the evaluator may emit. Keeps labeling consistent. */
export const ACTION_TAGS = [
  "energetic", "funny", "skillful", "bold", "hype",
  "personal", "vulnerable", "kind", "wholesome", "attention",
  "flirty", "teasing", "suggestive",
  "chaotic", "edgy", "reactive", "drama",
  "chill", "cozy", "calm",
  "boring", "low-energy", "dismissive", "cold", "prudish",
  "exclusive", "grateful", "generic", "loud",
  "boundary-setting", "boundary-crossing", "blocked",
] as const;

export type ActionTag = (typeof ACTION_TAGS)[number];

/** "up" / "down" / "none" pressure the evaluator assigns to streamer stats. */
export type StatPressure = "up" | "down" | "none";

/** The structured verdict the evaluator returns for any action. */
export interface ActionVerdict {
  /** Is this action possible for a streamer alone in her apartment? */
  plausible: boolean;
  /** If not plausible, why (shown to player). */
  reason?: string;
  /** Bounded tags describing the action. */
  tags: ActionTag[];
  /** 1 (subtle) .. 5 (extreme) magnitude. */
  intensity: number;
  /** Per-segment appeal, roughly -3..+3. Sparse — omit neutral segments. */
  appeal: Partial<Record<SegmentId, number>>;
  /** Coarse pressure on streamer stats; resolver owns the magnitudes. */
  pressure: {
    hype?: StatPressure;
    energy?: StatPressure;
    mood?: StatPressure;
    comfort?: StatPressure;
  };
  /** Second-person DM narration of what happens. */
  narration: string;
  /** Whether this action sets/respects a boundary (defuses stalker growth). */
  setsBoundary?: boolean;
}

export type ActionSource = "freeform" | "menu" | "furniture";

export interface PlayerAction {
  /** Raw text the player typed, or the menu option's prompt text. */
  text: string;
  source: ActionSource;
  /** For menu/furniture: a hint the evaluator can lean on. */
  hint?: string;
}

/** A contextual menu option attached to a piece of furniture / the stage. */
export interface ActionOption {
  id: string;
  label: string;
  /** Sent to the evaluator as the action text. */
  prompt: string;
  /** Only available while live (true) / offline (false) / either (undefined). */
  liveOnly?: boolean;
}
