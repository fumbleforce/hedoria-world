/**
 * Multi-step story arcs — chains that span days. An arc is started by a choice
 * in some seed event (taking a brand deal, leaning into a viral clip, reporting
 * a stalker), then spawns follow-up events on later in-world days until it
 * resolves. The arc engine here is data-driven: each kind lists ordered stages
 * with a day delay and an event builder; the controller stores live arcs and
 * raises their due events.
 */

import type { ArcKind, GameEvent, StoryArc } from "./types";
import { ev, choice } from "./events";
import { uid } from "../rng/rng";

interface ArcStage {
  /** Days after the previous stage (or arc start) before this stage fires. */
  dayDelay: number;
  build: (arc: StoryArc) => GameEvent;
}

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

const ARC_DEFS: Record<ArcKind, { title: string; stages: ArcStage[] }> = {
  // ---- Brand deal → sponsorship arc ---------------------------------------
  sponsorship: {
    title: "Sponsorship deal",
    stages: [
      {
        dayDelay: 1,
        build: (arc) => {
          const brand = str(arc.data?.brand, "the sponsor");
          const offer = num(arc.data?.offer, 80);
          return ev(
            "📦 Sponsor deliverable due",
            `${brand} wants the dedicated segment you agreed to — a real plug, not a throwaway mention. They're paying $${offer}.`,
            "neutral",
            [
              choice(`Do a polished segment (+$${offer})`, `You give ${brand} a genuinely good segment. Chat groans at the ad but respects the hustle.`, { cash: offer, hype: -3, comfort: -2 }),
              choice(`Phone it in (+$${Math.round(offer / 2)})`, `You rush a half-hearted mention. ${brand} pays a reduced fee and notes it.`, { cash: Math.round(offer / 2), hype: 1 }),
              choice("Skip it entirely", `You "forget" to run the segment. ${brand} is not amused — word gets around.`, { followers: -6, comfort: 2 }),
            ],
            undefined,
          );
        },
      },
      {
        dayDelay: 2,
        build: (arc) => {
          const brand = str(arc.data?.brand, "the sponsor");
          const offer = num(arc.data?.offer, 80);
          const renewal = Math.round(offer * 1.6);
          return ev(
            "📧 Renewal on the table",
            `${brand} liked the numbers and offers a multi-stream renewal worth $${renewal}.`,
            "good",
            [
              choice(`Sign it (+$${renewal})`, `You lock in the renewal. Steadier money — and an obligation.`, { cash: renewal, hype: -2 }),
              choice("Push for more (gamble)", `You negotiate hard. They either respect it or walk.`, { cash: Math.random() < 0.5 ? renewal * 2 : 0, comfort: -2 }),
              choice("Walk away", `You keep the channel ad-light. Chat loves you for it.`, { hype: 4, mood: 4 }),
            ],
            undefined,
          );
        },
      },
    ],
  },

  // ---- Viral clip → surge → backlash --------------------------------------
  viral: {
    title: "Viral clip",
    stages: [
      {
        dayDelay: 1,
        build: (arc) => {
          const topic = str(arc.data?.topic, "that clip");
          return ev(
            "📈 The wave arrives",
            `${topic} is everywhere. A flood of brand-new viewers pours in — curious, loud, some just here to gawk.`,
            "good",
            [
              choice("Welcome them, set the tone", "You greet the newcomers and gently set house rules. Many stick.", { followers: 90, hype: 8, comfort: -2 }),
              choice("Just keep doing you", "You don't pander. Fewer convert, but the ones who do are real.", { followers: 45, hype: 4, mood: 3 }),
            ],
            undefined,
          );
        },
      },
      {
        dayDelay: 1,
        build: (arc) => {
          const topic = str(arc.data?.topic, "the clip");
          return ev(
            "🔥 Backlash",
            `${topic} got clipped out of context and the discourse turned. Quote-tweets, think-pieces, a pile-on forming.`,
            "danger",
            [
              choice("Address it head-on", "You make a calm, clear statement on stream. It mostly clears the air.", { hype: 6, comfort: -4, mood: -2 }),
              choice("Ignore the noise", "You let it burn out. It does — but it stings to watch.", { mood: -6, followers: -10 }),
              choice("Double down", "You lean into the chaos. Trolls feast; so do the clip channels.", { hype: 12, comfort: -10, mood: -6, followers: 8 }),
            ],
            undefined,
          );
        },
      },
    ],
  },

  // ---- In-person visit went well → a real relationship forms --------------
  relationship: {
    title: "Something real",
    stages: [
      {
        dayDelay: 1,
        build: (arc) => {
          const who = str(arc.data?.handle, "they");
          return ev(
            "💌 The morning after",
            `${who} texts you, still glowing from the visit — they want to know if it meant as much to you as it did to them.`,
            "good",
            [
              choice("Tell them it did", `You're honest about how you feel. Something real is taking shape between you and ${who}.`, { mood: 9, comfort: 4 }),
              choice("Keep it casual", `You keep things light. ${who} takes the hint, a little deflated but understanding.`, { mood: 2 }),
              choice("Pull back", `You get cold feet and put distance between you. It stings for both of you.`, { mood: -4, comfort: 4 }),
            ],
            undefined,
          );
        },
      },
      {
        dayDelay: 2,
        build: (arc) => {
          const who = str(arc.data?.handle, "they");
          return ev(
            "🍷 A second visit",
            `${who} wants to come over again — properly this time. They offer to bring dinner.`,
            "good",
            [
              choice("Make a night of it", `You let ${who} in for a real evening together. It's easy, warm, the kind of normal you'd forgotten you wanted.`, { mood: 12, comfort: 8, energy: -6 }),
              choice("Slow it down", `You tell ${who} you need to take things slower. They respect it, and oddly, you feel closer for it.`, { mood: 4, comfort: 6 }),
            ],
            undefined,
          );
        },
      },
    ],
  },

  // ---- Stalker reported → legal follow-up + closure -----------------------
  "stalker-legal": {
    title: "The report",
    stages: [
      {
        dayDelay: 2,
        build: (arc) => {
          const who = str(arc.data?.handle, "them");
          return ev(
            "👮 Police follow-up",
            `An officer follows up on the report about ${who}. They need a statement to take it further.`,
            "neutral",
            [
              choice("Give a full statement", `You hand over the logs and screenshots. It's exhausting, but it's handled. ${who} is served a warning.`, { comfort: 16, mood: 6 }),
              choice("Downplay it", "You minimize it, half-hoping it just goes away. Less closure.", { comfort: 6, mood: -2 }),
            ],
            undefined,
          );
        },
      },
    ],
  },
};

/** Create a fresh arc (stage 0) ready to add to the store. */
export function startArc(
  kind: ArcKind,
  opts: { day: number; characterId?: string; data?: Record<string, string | number> },
): StoryArc {
  const def = ARC_DEFS[kind];
  return {
    id: uid("arc"),
    kind,
    stage: 0,
    title: def.title,
    nextDay: opts.day + def.stages[0].dayDelay,
    characterId: opts.characterId,
    data: opts.data,
  };
}

/** The event for an arc's current stage if it's due on `day`, else null. */
export function arcEventDue(arc: StoryArc, day: number): GameEvent | null {
  if (day < arc.nextDay) return null;
  const stage = ARC_DEFS[arc.kind]?.stages[arc.stage];
  if (!stage) return null;
  const event = stage.build(arc);
  event.arcId = arc.id;
  event.advancesArc = { id: arc.id, kind: arc.kind };
  event.triggerId = `arc:${arc.kind}:${arc.stage}`;
  event.allowFreeform = true;
  event.freeformHint = "…or respond in your own words";
  event.characterId = arc.characterId ?? event.characterId;
  return event;
}

/**
 * Advance an arc past the stage that just resolved. Returns the updated arc, or
 * null when the arc is finished and should be removed.
 */
export function advanceArc(arc: StoryArc, day: number): StoryArc | null {
  const def = ARC_DEFS[arc.kind];
  const next = arc.stage + 1;
  if (!def || next >= def.stages.length) return null;
  return { ...arc, stage: next, nextDay: day + def.stages[next].dayDelay };
}
