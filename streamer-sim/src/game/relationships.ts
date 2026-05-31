/**
 * Relationship dynamics for the named cast: milestones, the stalker escalation
 * arc, and word-of-mouth. Pure logic — like evaluator/resolver, nothing here
 * touches the store or React. Functions return *intents* (patches, story beats,
 * events to raise) that the controller applies. This keeps the turn loop lean
 * and the rules testable.
 */

import type { GameEvent } from "./types";
import type { CharacterSheet, RelationshipLevel } from "./characters";
import { relationshipLevel } from "./characters";
import { ARCHETYPE_BY_ID } from "./archetypes";
import { ev, choice } from "./events";
import { pick, clamp } from "../rng/rng";
import { BALANCE, type AffinitySource } from "./balance";

// --------------------------------------------------------------- affinity ledger

/**
 * THE single chokepoint for affinity changes. Every gain/loss in the game routes
 * through here so the rules (diminishing returns, a per-character daily soft cap,
 * and per-source weighting) are enforced in one place and stay tunable from
 * balance.ts. Pure: returns the patch to apply + the actual delta + a short human
 * "why" the feedback layer surfaces. The controller owns applying the patch and
 * running milestone checks against the new affinity.
 *
 * `rawDelta` is the *intent* before scaling: pass a positive base for a gain
 * (it gets diminished + capped) or a negative number for a loss (applied raw —
 * boundaries/penalties always bite). Source governs weighting + cap exemption.
 */
export function applyAffinity(
  c: CharacterSheet,
  rawDelta: number,
  source: AffinitySource,
  day: number,
): { patch: Partial<CharacterSheet>; applied: number; reason: string } {
  const cfg = BALANCE.affinity;
  // Reset the daily budget when the day rolls over.
  const budgetUsed = c.affinityDay === day ? c.affinityGainedToday : 0;

  let applied: number;
  let newBudgetUsed = budgetUsed;

  if (rawDelta > 0) {
    // Diminishing returns: the closer to 100, the slower it climbs.
    const gainScale = clamp(1 - c.affinity / cfg.diminishingPivot, cfg.diminishingFloor, 1);
    let gain = rawDelta * gainScale;
    // Soft sources are throttled by the per-day budget; reciprocal investment
    // (tips/requests/gifts/visits) bypasses the cap and always lands.
    if (cfg.softSources.includes(source)) {
      const remaining = Math.max(0, cfg.dailySoftCap - budgetUsed);
      gain = Math.min(gain, remaining);
      newBudgetUsed = budgetUsed + gain;
    }
    applied = gain;
  } else {
    // Losses (boundaries, decay-by-director, soured DMs) apply in full.
    applied = rawDelta;
  }

  const newAffinity = clamp(c.affinity + applied, 0, 100);
  // Recompute against the clamp so the reason reflects what really happened.
  const realDelta = newAffinity - c.affinity;

  const patch: Partial<CharacterSheet> = {
    affinity: newAffinity,
    affinityDay: day,
    affinityGainedToday: newBudgetUsed,
    lastInteractionDay: day,
  };

  return { patch, applied: realDelta, reason: affinityReason(realDelta, source) };
}

const SOURCE_PHRASE: Record<AffinitySource, string> = {
  chat: "chatting along",
  action: "you played to them",
  mention: "you called them out by name",
  dm: "your DM",
  dmRepeat: "your DMs",
  tip: "they tipped you",
  request: "you came through for them",
  gift: "their gift",
  visit: "your time together",
  referral: "a friend brought them in",
};

function affinityReason(delta: number, source: AffinitySource): string {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)} bond · ${SOURCE_PHRASE[source]}`;
}

// ----------------------------------------------------------------- decay

export interface AffinityDecay {
  id: string;
  patch: Partial<CharacterSheet>;
  delta: number;
  reason: string;
}

/**
 * Cool neglected bonds. Any character not interacted with for more than the
 * grace window loses affinity scaled by their current level (a confidant has
 * the furthest to fall). Does NOT stamp `lastInteractionDay` — the whole point
 * is that nothing happened. Returns per-character patches for the controller to
 * apply + a "why" for the feedback/log.
 */
export function decayAffinities(
  roster: Record<string, CharacterSheet>,
  day: number,
): AffinityDecay[] {
  const cfg = BALANCE.affinity;
  const out: AffinityDecay[] = [];
  for (const c of Object.values(roster)) {
    if (c.affinity <= 0) continue;
    if (c.lastInteractionDay < 0) continue; // never interacted — nothing to cool
    const idle = day - c.lastInteractionDay;
    if (idle <= cfg.decayGraceDays) continue;
    const level = relationshipLevel(c.affinity);
    const loss = cfg.decayPerIdleDay[level];
    if (!loss) continue;
    const newAffinity = clamp(c.affinity - loss, 0, 100);
    const delta = newAffinity - c.affinity;
    if (delta === 0) continue;
    out.push({
      id: c.id,
      patch: { affinity: newAffinity },
      delta,
      reason: `${delta.toFixed(1)} bond · ${idle} days quiet`,
    });
  }
  return out;
}

// --------------------------------------------------------------- milestones

/**
 * One thing that should happen when a relationship crosses a threshold. `inline`
 * beats drop into the narrator/chat feed; `event` beats interrupt with a choice
 * modal (the existing EventModal). `patch` mutates the character (e.g. reveal a
 * name); `spawnFriend`/`followerDelta` drive word-of-mouth.
 */
export interface MilestoneOutcome {
  /** Threshold id recorded in c.milestones so it never refires. */
  id: string;
  kind: "inline" | "event";
  patch?: Partial<CharacterSheet>;
  /** Narrator-feed line (prose). */
  story?: string;
  /** A live-chat line in the character's voice. */
  chat?: string;
  /** Interrupting choice event (kind === "event"). */
  event?: GameEvent;
  /** Spawn a referred friend of a compatible archetype (word-of-mouth). */
  spawnFriend?: boolean;
  /** One-off follower change (word-of-mouth bump). */
  followerDelta?: number;
}

const LEVEL_ORDER: RelationshipLevel[] = [
  "stranger",
  "familiar",
  "regular",
  "friend",
  "confidant",
];

/** Gender-neutral first names revealed at the "regular" milestone. */
const DISPLAY_NAMES = [
  "Mara", "Sam", "Alex", "June", "Casey", "Nico", "Robin", "Quinn", "Eli",
  "Sky", "Wren", "Ash", "Devon", "Remy", "Iris", "Theo", "Noa", "Kai",
];

/** A stable-ish name for a character (deterministic enough within a session). */
function revealName(c: CharacterSheet): string {
  if (c.displayName) return c.displayName;
  return pick(DISPLAY_NAMES);
}

/**
 * Compare affinity before/after a change and return any milestone beats that
 * just unlocked. `day` stamps word-of-mouth pacing. Beats are archetype-aware.
 */
export function checkMilestones(
  c: CharacterSheet,
  prevAffinity: number,
  _day: number,
): MilestoneOutcome[] {
  const before = LEVEL_ORDER.indexOf(relationshipLevel(prevAffinity));
  const after = LEVEL_ORDER.indexOf(relationshipLevel(c.affinity));
  if (after <= before) return [];

  const seg = ARCHETYPE_BY_ID[c.archetypeId]?.segment;
  const out: MilestoneOutcome[] = [];

  // Fire every threshold newly crossed (handles multi-level jumps).
  for (let lvl = before + 1; lvl <= after; lvl += 1) {
    const level = LEVEL_ORDER[lvl];
    if (c.milestones.includes(level)) continue;
    const beat = milestoneFor(c, level, seg);
    if (beat) out.push(beat);
  }
  return out;
}

function milestoneFor(
  c: CharacterSheet,
  level: RelationshipLevel,
  seg: string | undefined,
): MilestoneOutcome | null {
  const name = c.displayName || c.handle;
  switch (level) {
    case "familiar":
      return {
        id: "familiar",
        kind: "inline",
        chat: pick([
          "ok i'm officially a regular now",
          "you're stuck with me lol",
          "back again, hi 👋",
        ]),
      };

    case "regular": {
      // Name reveal — the relationship gets a face.
      const display = revealName(c);
      return {
        id: "regular",
        kind: "inline",
        patch: { displayName: display },
        story: `${c.handle} mentions, almost shyly, that their name is ${display}. You file it away.`,
      };
    }

    case "friend": {
      if (seg === "whales") {
        // Patronage offer — a recurring-support choice.
        const event = ev(
          "💎 An offer of patronage",
          `${name} wants to become a regular patron — steady monthly support, no strings (they say).`,
          "good",
          [
            choice(
              "Accept gratefully",
              `You thank ${name} warmly. A reliable cushion against rent — and a bond.`,
              { cash: 120, subscribers: 1, comfort: 4 },
            ),
            choice(
              "Keep it casual",
              "You deflect kindly. They respect it, mostly.",
              { mood: 2 },
            ),
          ],
          c,
        );
        return { id: "friend", kind: "event", event };
      }
      // Friendly regulars start telling people about you.
      return {
        id: "friend",
        kind: "inline",
        story: `${name} has become a real fixture — and they've started bringing people with them.`,
        spawnFriend: true,
        followerDelta: 3,
      };
    }

    case "confidant": {
      if (seg === "lonely" || seg === "simps") {
        // A soft confession — interrupting beat.
        const event = ev(
          "💌 A confession",
          `${name} types, deletes, retypes — then admits the stream is the best part of their week, and maybe it's more than that.`,
          "neutral",
          [
            choice(
              "Let them down gently",
              `You're kind but honest about boundaries. ${name} is quiet, then grateful.`,
              { comfort: 4, mood: -2 },
            ),
            choice(
              "Lean into the closeness",
              `You keep it warm and a little ambiguous. They're over the moon; it costs you something.`,
              { hype: 6, comfort: -8, mood: 2 },
            ),
          ],
          c,
        );
        return { id: "confidant", kind: "event", event };
      }
      return {
        id: "confidant",
        kind: "inline",
        story: `${name} is one of your true regulars now — the kind who'd defend you to a stranger.`,
        followerDelta: 2,
      };
    }

    default:
      return null;
  }
}

// ------------------------------------------------------------- stalker arc

export interface StalkerOutcome {
  /** Patch to apply (new threat + escalationDay stamp). */
  patch: Partial<CharacterSheet>;
  /** Narrator beat describing the escalation. */
  story: string;
  /** Optional creepy chat line. */
  chat?: string;
}

/**
 * Climb a stalker's `threat` by at most one step per in-world day. Returns null
 * when the arc shouldn't advance (not a stalker, already advanced today, capped,
 * or not being "fed"). `fed` is true when recent play has encouraged them
 * (oversharing, low comfort, ignored creepy chat).
 */
export function advanceStalkerArc(
  c: CharacterSheet,
  day: number,
  fed: boolean,
): StalkerOutcome | null {
  const seg = ARCHETYPE_BY_ID[c.archetypeId]?.segment;
  if (seg !== "stalkers") return null;
  if (c.threat < 1 || c.threat >= 3) return null;
  if (c.escalationDay >= day) return null; // ≤ one advance per day
  if (!fed) return null;

  const next = c.threat + 1;
  const name = c.displayName || c.handle;
  const story =
    next === 2
      ? `${name}'s messages have turned — too personal, too knowing. They're not just watching anymore.`
      : `${name} references things you never said on stream. They know where you are. This is real now.`;
  return {
    patch: { threat: next, escalationDay: day },
    story,
    chat:
      next >= 2
        ? pick([
            "i drove past your block tonight 👀",
            "you looked tired today. you should rest. i'll watch over you.",
            "we both know you can't ignore me forever",
          ])
        : undefined,
  };
}

// ------------------------------------------------------------- word-of-mouth

/**
 * A regular leaving on bad terms (blocked, boundary-set, troll-soured) dents
 * growth and seeds a sour review. Returns the follower hit + a log line.
 */
export function sourReview(c: CharacterSheet): { followerDelta: number; log: string } {
  const name = c.displayName || c.handle;
  return {
    followerDelta: -pick([2, 3, 4, 5]),
    log: `${name} left a sour review — a small dip in growth.`,
  };
}
