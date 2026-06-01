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
  /** Recently-fired trigger ids (oldest→newest), for cooldowns. */
  recentTriggerIds?: string[];
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
      // A donation has its own in-game answer: the "🙏 Thank a supporter" action.
      // So this lands as a passive 💸 ding (money + chat line) instead of a modal.
      const e = ev("💸 A big tip lands", `${name} dropped $${amt}.`, "good", [], who);
      e.deliverAsTip = amt;
      return e;
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
  // ---- Wellbeing ------------------------------------------------------------
  {
    id: "burnout",
    live: false,
    // Arms when comfort and energy are chronically low — the body says stop.
    weight: (c) =>
      c.metrics.comfort < 35 && c.metrics.energy < 45 ? 2.5 : 0,
    build: () =>
      ev("🪫 Burnout is creeping in", "Everything feels heavy. The thought of going live makes your chest tighten.", "danger", [
        choice("Take the day to truly rest", "You log off, silence the phone, and let yourself recover.", { comfort: 34, energy: 20 }),
        choice("Push through it anyway", "You grind on, running on empty. It costs you.", { comfort: -9, energy: -12 }),
      ]),
  },
  // ---- Door / deliveries ----------------------------------------------------
  {
    id: "package",
    live: false,
    weight: () => 1,
    build: () => ev("📦 A package arrives", "A delivery you half-remember ordering — or fan mail.", "good", [
      choice("Open it now", "Cute gifts and merch samples from viewers. A small lift.", { comfort: 6 }),
      choice("Set it aside", "You'll deal with it later.", {}),
    ]),
  },
  {
    id: "door-knock",
    live: false,
    weight: (c) => (c.intensity >= 1 ? 0.9 : 0.4),
    bindsCharacter: true,
    build: (c, who) => {
      const creepy = c.intensity >= 2 && (who?.threat ?? 0) >= 1;
      if (creepy) {
        return ev("🚪 Someone's at the door", `Through the peephole: a stranger with flowers and a printout of your schedule.`, "creepy", [
          choice("Don't open — wait them out", "They leave the flowers and go. You feel watched.", { comfort: -12 }),
          choice("Open the door", "Tense and unsettling. You shut it fast, heart pounding.", { comfort: -24, followers: 3 }),
        ], who);
      }
      return ev("🚪 A knock at the door", "Someone's outside. You're not expecting anyone.", "neutral", [
        choice("Answer it", "Just a neighbor returning your mail. Pleasant enough.", { comfort: 3 }),
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
      const creepy = (who?.threat ?? 0) >= 1 && c.intensity >= 2;
      // A DM has an in-game answer: an actual reply. So instead of a modal with
      // canned choices, this lands as a real message in the sender's DM thread
      // and notifies the player. `deliverAsDm` seeds the opener's intent; the
      // existing DM director turns whatever the player replies into consequences.
      const e = ev(
        creepy ? "✉️ A DM that's too specific" : "✉️ A direct message",
        creepy
          ? `${name} messages you something that knows a little too much about your day.`
          : `${name} sends you a heartfelt DM.`,
        creepy ? "creepy" : "neutral",
        [],
        who,
      );
      e.deliverAsDm = creepy
        ? "an unsettling, overly-specific out-of-the-blue message that hints you've been watching the streamer's day a little too closely"
        : "a warm, heartfelt out-of-the-blue message";
      return e;
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
            { comfort: 22, followers: -4 },
          ),
          choice(
            "Confront on stream",
            "You call it out live. Clips fly, the room rallies behind you — but your hands are shaking.",
            { hype: 16, followers: 12, comfort: -16 },
          ),
          choice(
            "Move apartments",
            "You break the lease and disappear for a few days. Expensive, but you can breathe again.",
            { cash: -300, comfort: 30 },
          ),
          choice(
            "Wait it out",
            "You tell yourself it'll pass. It doesn't. You feel watched all night.",
            { comfort: -18 },
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
        choice("Decline", "You keep it authentic. Chat respects it.", { hype: 4, comfort: 3 }),
      ]);
    },
  },
  // ---- Viral moment (starts the viral arc when you lean in) -----------------
  {
    id: "viral-clip",
    live: true,
    weight: (c) => (c.metrics.hype > 60 ? 1.1 : 0.35),
    build: () =>
      ev(
        "🎬 A clip is taking off",
        "A moment from tonight got clipped and it's climbing fast on the timeline — strangers are quote-posting it.",
        "good",
        [
          choice("Lean into it", "You pin the clip and play it up, riding the wave. This could snowball.", { hype: 10, followers: 20 }),
          choice("Stay measured", "You acknowledge it but keep your head down and your night normal.", { hype: 4, followers: 8 }),
        ],
      ),
  },
  // ---- Real-life intrusions (the "life" half of life-sim) -------------------
  {
    id: "landlord-visit",
    live: false,
    weight: (c) => (c.metrics.cash < 250 ? 1.3 : 0.5),
    build: () =>
      ev(
        "🏠 The landlord drops by",
        "A knock at the door — your landlord, 'just checking in' about this month's rent, eyeing the camera gear.",
        "neutral",
        [
          choice("Pay on the spot (-$150)", "You hand over the cash with a tight smile. Tense, but handled.", { cash: -150, comfort: 4 }),
          choice("Ask for a few days", "You buy time with a nervous laugh. The worry coils in your stomach.", { comfort: -10 }),
        ],
      ),
  },
  {
    id: "sick-day",
    live: false,
    weight: (c) => (c.metrics.energy < 45 || c.metrics.comfort < 40 ? 1.1 : 0.3),
    build: () =>
      ev(
        "🤒 You wake up sick",
        "Scratchy throat, heavy head, everything aches. Streaming today would be miserable.",
        "neutral",
        [
          choice("Rest and recover", "You take the day off. Money's tight, but you'll come back stronger.", { energy: 20, comfort: 12 }),
          choice("Push through anyway", "You power through on tea and willpower. Tomorrow you'll pay for it.", { energy: -10, comfort: -9 }),
        ],
      ),
  },
  {
    id: "power-cut",
    live: true,
    weight: () => 0.45,
    build: () =>
      ev(
        "🔌 The power flickers",
        "The lights stutter — a brownout threatens to drop your whole setup mid-stream.",
        "danger",
        [
          choice("Switch to phone + hotspot", "You scramble onto a scrappy backup and stay live. Chat loves the chaos.", { hype: 4, energy: -5, comfort: -2 }),
          choice("Call it early", "You apologize and wrap early to be safe. Better than losing the gear.", { hype: -4, comfort: -3 }),
        ],
      ),
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

  // Cooldowns: never the same event twice in a row, and strongly discourage any
  // event seen in the last few beats — so the same template doesn't recur
  // back-to-back. High-priority triggers (the stalker confrontation) are exempt.
  const recent = ctx.recentTriggerIds ?? [];
  const last = recent[recent.length - 1];
  const recentSet = new Set(recent.slice(-4));
  const weighted = eligible
    .map((t) => {
      let w = t.weight(ctx);
      if (t.id !== "stalker-confront") {
        if (t.id === last) w = 0;
        else if (recentSet.has(t.id)) w *= 0.25;
      }
      return { t, w };
    })
    .filter((x) => x.w > 0);
  if (weighted.length === 0) return null;

  const total = weighted.reduce((s, x) => s + x.w, 0);
  let target = Math.random() * total;
  for (const x of weighted) {
    target -= x.w;
    if (target <= 0) return finalize(x.t, ctx);
  }
  return finalize(weighted[weighted.length - 1].t, ctx);
}

function finalize(t: EventTrigger, ctx: EventContext): GameEvent {
  let who: CharacterSheet | undefined;
  if (t.bindsCharacter && ctx.online.length) {
    who = ctx.roster[pick(ctx.online)];
  }
  const event = t.build(ctx, who);
  event.triggerId = t.id;
  // Every event accepts a freeform response by default (the player can type
  // their own reaction, judged by the LLM) unless the builder opted out. The
  // stalker confrontation is exempt: its discrete choices drive safety-critical
  // threat-resolution logic that a freeform reply would bypass.
  if (event.allowFreeform === undefined) {
    const discreteOnly = t.id === "stalker-confront";
    event.allowFreeform = !discreteOnly;
    if (!discreteOnly) event.freeformHint = "…or respond in your own words";
  }
  return event;
}

/** Probability an event fires this round, scaled by night progress + intensity. */
export function eventChance(base: number, intensity: number): boolean {
  return chance(base + intensity * 0.02);
}
