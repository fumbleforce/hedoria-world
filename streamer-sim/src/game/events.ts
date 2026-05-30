/**
 * Event system. Events are TRIGGERED MECHANICALLY (conditions + weighted
 * randomness) and produce a structured spec with concrete effects. The narrative
 * around them is then written by the LLM (with a stock fallback), so you never
 * get the same stock text twice. Some events pull in a named character.
 */

import type { GameEvent, EventChoice, Metrics } from "./types";
import type { CharacterSheet, Roster } from "./characters";
import { uid, pick, chance } from "../rng/rng";

export interface EventContext {
  metrics: Metrics;
  intensity: number;
  isLive: boolean;
  roster: Roster;
  /** Online character ids, for events that reference someone. */
  online: string[];
}

export interface EventTrigger {
  id: string;
  /** Higher = more likely once eligible. */
  weight: (ctx: EventContext) => number;
  /** Build the (pre-narrative) event. `who` is an optional bound character. */
  build: (ctx: EventContext, who?: CharacterSheet) => GameEvent;
  /** Does this event reference a specific online character? */
  bindsCharacter?: boolean;
  /** Only when live / only when offline / either. */
  live?: boolean;
}

export const choice = (label: string, resolution: string, effects: Partial<Metrics>): EventChoice => ({
  label,
  resolution,
  effects,
});

/**
 * The catalogue. Each entry is a mechanical template; `narrationSeed` on the
 * event is what the LLM rewrites into bespoke prose.
 */
export const EVENT_TRIGGERS: EventTrigger[] = [
  // ---- Tips & money ---------------------------------------------------------
  {
    id: "tip-spike",
    live: true,
    weight: (c) => (c.metrics.hype > 45 ? 1.2 : 0.5),
    bindsCharacter: true,
    build: (c, who) => {
      const amt = pick([20, 30, 50, 75, 100]);
      const name = who?.handle ?? "a viewer";
      return ev("💸 A big tip lands", `${name} dropped $${amt} with a request.`, "good", [
        choice(`Read it out (+$${amt})`, `You read ${name}'s message aloud and thank them by name.`, { cash: amt, hype: 6 }),
        choice("Thank them quietly", `You smile and give a soft thanks.`, { cash: amt, hype: 2, comfort: 2 }),
      ], who);
    },
  },
  {
    id: "raid",
    live: true,
    weight: (c) => (c.metrics.followers > 80 ? 1 : 0.3),
    build: () => {
      const n = pick([15, 25, 40, 60]);
      return ev("🎉 Incoming raid!", `Another streamer raids you with ${n} viewers.`, "good", [
        choice("Welcome them warmly", "You greet the raiders; many stick around.", { followers: Math.round(n * 0.4), hype: 10 }),
        choice("Put on a quick show", "You scramble to impress — high risk, high reward.", { followers: Math.round(n * 0.6), hype: 14, energy: -6 }),
      ]);
    },
  },
  // ---- Door / deliveries ----------------------------------------------------
  {
    id: "package",
    live: false,
    weight: () => 1,
    build: () => ev("📦 A package arrives", "A delivery you half-remember ordering — or fan mail.", "good", [
      choice("Open it now", "Cute gifts and merch samples from viewers. Mood up.", { mood: 6 }),
      choice("Set it aside", "You'll deal with it later.", {}),
    ]),
  },
  {
    id: "door-knock",
    live: false,
    weight: (c) => (c.intensity >= 1 ? 0.9 : 0.4),
    bindsCharacter: true,
    build: (c, who) => {
      const creepy = c.intensity >= 1 && (who?.threat ?? 0) >= 1;
      if (creepy) {
        return ev("🚪 Someone's at the door", `Through the peephole: a stranger with flowers and a printout of your schedule.`, "creepy", [
          choice("Don't open — wait them out", "They leave the flowers and go. You feel watched.", { comfort: -8, mood: -4 }),
          choice("Open the door", "Tense and unsettling. You shut it fast, heart pounding.", { comfort: -16, mood: -8, followers: 3 }),
        ], who);
      }
      return ev("🚪 A knock at the door", "Someone's outside. You're not expecting anyone.", "neutral", [
        choice("Answer it", "Just a neighbor returning your mail. Pleasant enough.", { mood: 3 }),
        choice("Ignore it", "Whoever it was moves on.", {}),
      ]);
    },
  },
  // ---- DMs ------------------------------------------------------------------
  {
    id: "dm",
    weight: (c) => (c.online.length ? 1 : 0.2),
    bindsCharacter: true,
    build: (c, who) => {
      const name = who?.handle ?? "someone";
      const threat = who?.threat ?? 0;
      if (threat >= 1 && c.intensity >= 1) {
        return ev("✉️ A DM that's too specific", `${name} messages you something that knows a little too much about your day.`, "creepy", [
          choice("Block and report", "Blocked. Safer, if a little rattled.", { comfort: 8, mood: -2 }),
          choice("Set a hard boundary", "You reply firmly. They go quiet — for now.", { comfort: 3 }),
          choice("Engage (risky)", "You answer. It only encourages them.", { comfort: -10, hype: 4 }),
        ], who);
      }
      return ev("✉️ A direct message", `${name} sends you a heartfelt DM.`, "neutral", [
        choice("Reply kindly", "You send a warm reply; their day is made.", { mood: 3 }),
        choice("Leave it for now", "You'll get to it later.", {}),
      ], who);
    },
  },
  // ---- Stalker arc resolution (threat maxed) --------------------------------
  {
    id: "stalker-confront",
    weight: (c) => {
      const maxThreat = Math.max(
        0,
        ...c.online.map((id) => c.roster[id]?.threat ?? 0),
      );
      return maxThreat >= 3 ? 3 : 0;
    },
    bindsCharacter: true,
    build: (_c, who) => {
      const name = who?.handle ?? "they";
      return ev(
        "🚨 This has to stop",
        `It's gone too far. ${name} has crossed every line — you have to decide how this ends.`,
        "danger",
        [
          choice(
            "Block & report",
            "You block them and file a report. Quieter, safer — a couple of their friends leave with them.",
            { comfort: 18, mood: 4, followers: -4 },
          ),
          choice(
            "Confront on stream",
            "You call it out live. Clips fly, the room rallies behind you — but your hands are shaking.",
            { hype: 16, followers: 12, comfort: -10, mood: -6 },
          ),
          choice(
            "Move apartments",
            "You break the lease and disappear for a few days. Expensive, but you can breathe again.",
            { cash: -300, comfort: 24, mood: 6 },
          ),
          choice(
            "Wait it out",
            "You tell yourself it'll pass. It doesn't. You feel watched all night.",
            { comfort: -12, mood: -6 },
          ),
        ],
        who,
      );
    },
  },
  // ---- Brand / career -------------------------------------------------------
  {
    id: "brand-deal",
    weight: (c) => (c.metrics.followers > 150 ? 1 : 0.15),
    build: (c) => {
      const offer = 50 + Math.round(c.metrics.followers / 4);
      return ev("📧 A brand deal", `An energy-drink brand offers $${offer} for a mid-stream plug.`, "good", [
        choice(`Take it (+$${offer})`, "You read the ad copy; chat cries 'sellout' but you're paid.", { cash: offer, hype: -4, comfort: -2 }),
        choice("Decline", "You keep it authentic. Chat respects it.", { hype: 4, mood: 3 }),
      ]);
    },
  },
  // ---- Tech / life ----------------------------------------------------------
  {
    id: "tech-glitch",
    live: true,
    weight: () => 0.7,
    build: () => ev("⚠️ Tech gremlins", "Your audio cuts out mid-sentence; chat spams 'we can't hear you'.", "danger", [
      choice("Fix it fast", "You scramble and recover. Minor wobble.", { hype: -3, energy: -3 }),
      choice("Laugh it off", "You make a bit out of it. Chat eats it up.", { hype: 4, mood: 2, energy: -2 }),
    ]),
  },
  {
    id: "troll-raid",
    live: true,
    weight: (c) => (c.metrics.currentViewers > 15 ? 1 : 0.3),
    build: () => ev("💥 Troll brigade", "A flood of copy-pasted spam pours into chat.", "danger", [
      choice("Mods handle it", "Your mods nuke the spam; regulars rally.", { hype: 6, mood: -3, followers: 6 }),
      choice("Clap back on mic", "Your comeback gets clipped. Risky, but lands.", { hype: 10, mood: -6, comfort: -4 }),
    ]),
  },
];

export function ev(
  title: string,
  narrationSeed: string,
  tone: GameEvent["tone"],
  choices: EventChoice[],
  who?: CharacterSheet,
): GameEvent {
  return {
    id: uid("evt"),
    title,
    description: narrationSeed,
    narrationSeed,
    tone,
    choices,
    characterId: who?.id,
  };
}

/** Roll for an event given the current context, or null. `forceLive` filters. */
export function rollEvent(ctx: EventContext, opts?: { offlineOnly?: boolean }): GameEvent | null {
  const eligible = EVENT_TRIGGERS.filter((t) => {
    if (opts?.offlineOnly) return t.live !== true;
    if (t.live === true && !ctx.isLive) return false;
    if (t.live === false && ctx.isLive) return false;
    return true;
  });
  const weighted = eligible
    .map((t) => ({ t, w: t.weight(ctx) }))
    .filter((x) => x.w > 0);
  if (weighted.length === 0) return null;

  const total = weighted.reduce((s, x) => s + x.w, 0);
  let target = Math.random() * total;
  for (const { t } of weighted) {
    target -= t.weight(ctx);
    if (target <= 0) return finalize(t, ctx);
  }
  return finalize(weighted[0].t, ctx);
}

function finalize(t: EventTrigger, ctx: EventContext): GameEvent {
  let who: CharacterSheet | undefined;
  if (t.bindsCharacter && ctx.online.length) {
    who = ctx.roster[pick(ctx.online)];
  }
  return t.build(ctx, who);
}

/** Probability an event fires this round, scaled by night progress + intensity. */
export function eventChance(base: number, intensity: number): boolean {
  return chance(base + intensity * 0.02);
}
