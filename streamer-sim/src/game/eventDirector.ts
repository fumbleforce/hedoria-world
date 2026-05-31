/**
 * Event Director — LLM-authored events composed from a constrained capability
 * vocabulary. Modeled on dmDirector.ts: the model proposes flavour + which
 * capabilities to invoke; code owns every number and state change.
 */

import type { LlmAdapter } from "../llm/adapter";
import { completeJsonWithRepair } from "../llm/adapter";
import { extractJson } from "../llm/json";
import { clamp } from "../rng/rng";
import { BALANCE, type MasteryDomain } from "./balance";
import { steeringForTier } from "./content";
import type { Metrics, Settings } from "./types";

export type EventEffect =
  | { type: "metric"; key: "hype" | "energy" | "comfort" | "hunger" | "bladder" | "hygiene" | "horny"; delta: number; note?: string }
  | { type: "money"; amount: number; charRef?: string; note?: string }
  | { type: "followers"; delta: number; note?: string }
  | { type: "subscribers"; delta: number; note?: string }
  | { type: "affinity"; charRef: string; delta: number; note?: string }
  | { type: "threat"; charRef: string; delta: number; note?: string }
  | {
      type: "relationship";
      charRef: string;
      relationship: "none" | "romantic" | "sexual" | "dominant" | "submissive" | "married";
      note?: string;
    }
  | { type: "revealName"; charRef: string; name: string; note?: string }
  | { type: "blockViewer"; charRef: string; note?: string }
  | { type: "spawnViewer"; archetypeHint?: string; note?: string }
  | { type: "incomingDm"; charRef?: string; message?: string; note?: string }
  | { type: "grantUpgrade"; upgradeId: string; note?: string }
  | { type: "grantItem"; name: string; note?: string }
  | { type: "masteryXp"; domain: MasteryDomain; amount: number; note?: string }
  | { type: "raid"; size?: number; note?: string }
  | { type: "meetup"; charRef: string; hint: string; days?: number; note?: string }
  | { type: "scheduleFollowup"; days: number; seed: string; charRef?: string; note?: string }
  | { type: "none"; note?: string };

export interface EventSpec {
  mode: "scene" | "notice";
  title: string;
  tone: string;
  opening: string;
  stakes?: string;
  characterRef?: string | null;
  effects?: EventEffect[];
}

export interface EventDirectorViewer {
  id: string;
  handle: string;
  displayName?: string;
  archetype: string;
  affinity: number;
  threat: number;
  relationship: string;
  memory?: string;
}

export interface EventDirectorSignal {
  id: string;
  label: string;
  mustAddress?: boolean;
}

export interface EventDirectorContext {
  settings: Settings;
  metrics: Metrics;
  isLive: boolean;
  recentNarrative: string;
  viewers: EventDirectorViewer[];
  mastery: { showmanship: number; composure: number };
  niche: string;
  outfit: string;
  productionQuality: number;
  segmentAppealSummary: string;
  pendingFollowups: Array<{ day: number; seed: string; charId?: string }>;
  recentEventTitles: string[];
  signals: EventDirectorSignal[];
  beatsSinceLastEvent: number;
  daysSinceLastEvent: number;
  /** Valid roster ids for charRef validation. */
  rosterIds: string[];
  /** Valid upgrade ids from the shop catalogue. */
  upgradeIds: string[];
  /** Optional seed text when continuing a scheduled follow-up. */
  seed?: string;
  /** Active stream activity sub-state, if any. */
  activity?: {
    label: string;
    narrationHint: string;
    roundsPlayed: number;
    category?: string;
  };
}

const REL_VALUES = ["none", "romantic", "sexual", "dominant", "submissive", "married"] as const;
const METRIC_KEYS = ["hype", "energy", "comfort", "hunger", "bladder", "hygiene", "horny"] as const;
const E = BALANCE.events;

/** Static fallback specs for mock mode, parse failures, and must-address safety nets. */
export const FALLBACK_EVENT_SPECS: EventSpec[] = [
  {
    mode: "notice",
    title: "📦 Something at the door",
    tone: "neutral",
    opening: "A knock echoes through the apartment — unexpected, but not necessarily unwelcome.",
    effects: [{ type: "metric", key: "comfort", delta: 2, note: "a little surprise" }],
  },
  {
    mode: "scene",
    title: "💸 A moment that could pay off",
    tone: "good",
    opening:
      "Your phone buzzes with an opportunity — not huge, but real. The kind of thing that separates a hobby from a career if you play it right.",
    stakes: "How you handle this could move the channel forward — or cost you comfort.",
    effects: [{ type: "money", amount: 40, note: "a modest opportunity" }],
  },
  {
    mode: "scene",
    title: "⚠️ Lines crossed",
    tone: "creepy",
    opening:
      "Something in the room shifts. A viewer you've been trying to ignore has pushed too far — and everyone can feel it, even through the screen.",
    stakes: "This needs a clear response. Boundaries matter here.",
    characterRef: null,
    effects: [
      { type: "metric", key: "comfort", delta: -8, note: "they crossed a line" },
      { type: "metric", key: "comfort", delta: -4 },
    ],
  },
  {
    mode: "scene",
    title: "🪫 Running on empty",
    tone: "danger",
    opening:
      "Your body is sending signals you can't ignore anymore. The thought of performing makes your chest tighten — burnout isn't a metaphor tonight.",
    stakes: "Rest now or pay for it later.",
    effects: [
      { type: "metric", key: "comfort", delta: -4 },
      { type: "metric", key: "energy", delta: -6 },
    ],
  },
  {
    mode: "notice",
    title: "📈 A small wave",
    tone: "good",
    opening: "Something you did earlier is getting traction — a few new faces trickling in, curious whispers in the replies.",
    effects: [
      { type: "followers", delta: 12 },
      { type: "metric", key: "hype", delta: 6 },
    ],
  },
];

export function pickFallbackSpec(ctx: EventDirectorContext): EventSpec {
  const must = ctx.signals.find((s) => s.mustAddress);
  if (must?.id === "threat-3") return { ...FALLBACK_EVENT_SPECS[2] };
  if (must?.id === "burnout") return { ...FALLBACK_EVENT_SPECS[3] };
  if (ctx.isLive && ctx.metrics.hype > 60) return { ...FALLBACK_EVENT_SPECS[4] };
  if (ctx.isLive) return { ...FALLBACK_EVENT_SPECS[1] };
  return { ...FALLBACK_EVENT_SPECS[0] };
}

export async function authorEvent(
  adapter: LlmAdapter,
  ctx: EventDirectorContext,
): Promise<EventSpec | null> {
  const mustAddress = ctx.signals.some((s) => s.mustAddress);
  if (adapter.isMock) {
    if (mustAddress || Math.random() < 0.35) return pickFallbackSpec(ctx);
    return null;
  }

  const req = {
    system: [
      "You are the Event Director for a streamer life-sim. Read the CURRENT game state and decide whether something noteworthy happens right now.",
      "Most of the time, return { \"spec\": null } — calm nights should be calm.",
      "If something fits, return ONE event in { \"spec\": EventSpec }.",
      "Pick mode:",
      "  - \"scene\": interactive, multi-beat (confrontations, a viewer at the door, a big moment)",
      "  - \"notice\": a single narrated beat with immediate effects (small passive happenings)",
      "Compose ONLY from listed capabilities in effects; never invent operations. Code owns every number — your deltas are suggestions and will be clamped.",
      "BACK YOUR NARRATION WITH CAPABILITIES: if your opening says a DM/message arrived, a tip came in, followers spiked, a gift showed up, or a viewer raided, you MUST include the matching effect (incomingDm, money, followers, grantItem, raid, …). Never narrate a consequence you didn't author as an effect.",
      "If the beat is fundamentally someone messaging her privately (a DM, an off-stream ask, a troll's message), use mode \"notice\" with an `incomingDm` effect: bind the sender via `charRef` and give the GIST of why they're reaching out in `note`. The sender writes their own line in-voice and decides what to reveal — don't script their exact words or names. A real DM lands in her inbox and she replies in the DM panel, where the DM director takes over. Do NOT open a scene that merely describes a DM.",
      "Fit THIS state and her trajectory (niche/mastery/recent beats). Do NOT repeat any recent event title.",
      "Reference real online viewers by characterRef: \"online:<id>\"; use \"new\" to introduce someone.",
      mustAddress
        ? "IMPORTANT: A must-address signal is active — you SHOULD author an appropriate scene or notice unless truly impossible."
        : "",
      steeringForTier(ctx.settings),
    ]
      .filter(Boolean)
      .join("\n"),
    messages: [
      {
        role: "user" as const,
        content: formatAuthorContext(ctx),
      },
    ],
    jsonMode: true,
    jsonSchema: EVENT_SPEC_SCHEMA,
  };

  try {
    const parsed = await completeJsonWithRepair(adapter, req, parseAuthorResponse, "story");
    if (parsed) return parsed;
  } catch {
    // fall through to safety net
  }
  if (mustAddress) return pickFallbackSpec(ctx);
  return null;
}

export async function resolveEvent(
  adapter: LlmAdapter,
  ctx: EventDirectorContext,
  transcript: string,
): Promise<EventEffect[]> {
  if (adapter.isMock) {
    const fb = pickFallbackSpec(ctx);
    return fb.effects?.length ? fb.effects : [{ type: "none" }];
  }
  const req = {
    system: [
      "You are the Event Director resolving a played-out scene in a streamer life-sim.",
      "Given the transcript, return JSON { effects: EventEffect[] } that the player's choices earned.",
      "Effects should be proportional to what happened — modest and sparse; emit none when nothing changed.",
      "Use only capability types from the schema. Code clamps every number.",
      steeringForTier(ctx.settings),
    ].join("\n"),
    messages: [
      {
        role: "user" as const,
        content: [
          `Event: ${ctx.seed ?? "director scene"}`,
          `Day ${ctx.metrics.day}, live: ${ctx.isLive}`,
          `Transcript:\n${transcript.slice(-2000)}`,
          "Return { effects: EventEffect[] }.",
        ].join("\n"),
      },
    ],
    jsonMode: true,
    jsonSchema: EVENT_EFFECTS_WRAPPER_SCHEMA,
  };
  try {
    const parsed = await completeJsonWithRepair(adapter, req, (t) => parseEventEffects(t, ctx), "story");
    return parsed?.length ? parsed : [{ type: "none" }];
  } catch {
    return [{ type: "none" }];
  }
}

/** Parse + clamp effects from raw LLM JSON; drops invalid charRef/upgradeId. */
export function parseEventEffects(text: string, ctx?: Pick<EventDirectorContext, "rosterIds" | "upgradeIds">): EventEffect[] | null {
  const json = extractJson<{ effects?: unknown }>(text);
  if (!json || !Array.isArray(json.effects)) return null;
  const roster = new Set(ctx?.rosterIds ?? []);
  const upgrades = new Set(ctx?.upgradeIds ?? []);
  const out: EventEffect[] = [];
  for (const raw of json.effects) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const type = typeof o.type === "string" ? o.type : "";
    const note = typeof o.note === "string" ? o.note.slice(0, 160) : undefined;
    let charRef = typeof o.charRef === "string" ? o.charRef : undefined;
    // The author may reference viewers as "online:<id>" (as in spec.characterRef);
    // effects bind to plain roster ids, so normalize the prefix away.
    if (charRef?.startsWith("online:")) charRef = charRef.slice("online:".length);

    if (type === "metric") {
      const key = typeof o.key === "string" && (METRIC_KEYS as readonly string[]).includes(o.key) ? o.key : null;
      const delta = clampNumber(o.delta, -E.metricDeltaBand, E.metricDeltaBand);
      if (key && delta !== null) out.push({ type, key: key as (typeof METRIC_KEYS)[number], delta, note });
    } else if (type === "money") {
      const amount = clampNumber(o.amount, E.cashMin, E.cashMax);
      if (amount !== null) {
        if (charRef && roster.size && !roster.has(charRef)) continue;
        out.push({ type, amount, charRef, note });
      }
    } else if (type === "followers") {
      const delta = clampNumber(o.delta, E.followersMin, E.followersMax);
      if (delta !== null) out.push({ type, delta, note });
    } else if (type === "subscribers") {
      const delta = clampNumber(o.delta, E.subscribersMin, E.subscribersMax);
      if (delta !== null) out.push({ type, delta, note });
    } else if (type === "affinity" && charRef && roster.has(charRef)) {
      const delta = clampNumber(o.delta, E.affinityMin, E.affinityMax);
      if (delta !== null) out.push({ type, charRef, delta, note });
    } else if (type === "threat" && charRef && roster.has(charRef)) {
      const delta = clampNumber(o.delta, E.threatMin, E.threatMax);
      if (delta !== null) out.push({ type, charRef, delta, note });
    } else if (type === "relationship" && charRef && roster.has(charRef) && typeof o.relationship === "string") {
      if (REL_VALUES.includes(o.relationship as (typeof REL_VALUES)[number])) {
        out.push({
          type,
          charRef,
          relationship: o.relationship as EventEffect & { type: "relationship" } extends { relationship: infer R } ? R : never,
          note,
        });
      }
    } else if (type === "revealName" && charRef && roster.has(charRef) && typeof o.name === "string") {
      out.push({ type, charRef, name: o.name.slice(0, 28), note });
    } else if (type === "blockViewer" && charRef && roster.has(charRef)) {
      out.push({ type, charRef, note });
    } else if (type === "spawnViewer") {
      out.push({
        type,
        archetypeHint: typeof o.archetypeHint === "string" ? o.archetypeHint.slice(0, 40) : undefined,
        note,
      });
    } else if (type === "incomingDm") {
      if (charRef && roster.size && !roster.has(charRef)) continue;
      const message = typeof o.message === "string" ? o.message.trim().slice(0, 400) : undefined;
      out.push({ type, charRef, message, note });
    } else if (type === "grantUpgrade" && typeof o.upgradeId === "string" && upgrades.has(o.upgradeId)) {
      out.push({ type, upgradeId: o.upgradeId, note });
    } else if (type === "grantItem" && typeof o.name === "string") {
      out.push({ type, name: o.name.slice(0, 60), note });
    } else if (type === "masteryXp" && typeof o.domain === "string" && BALANCE.mastery.domains.includes(o.domain as MasteryDomain)) {
      const amount = clampNumber(o.amount, E.masteryXpMin, E.masteryXpMax);
      if (amount !== null) out.push({ type, domain: o.domain as MasteryDomain, amount, note });
    } else if (type === "raid") {
      const size = clampNumber(o.size ?? 1, 1, E.raidSizeMax);
      if (size !== null) out.push({ type, size, note });
    } else if (type === "meetup" && charRef && roster.has(charRef)) {
      const hint =
        typeof o.hint === "string" ? o.hint
        : typeof o.note === "string" ? o.note
        : "they're on their way over";
      const days = clampNumber(o.days ?? 0, 0, E.followupDaysMax);
      out.push({ type, charRef, hint: hint.slice(0, 120), days: days ?? 0, note });
    } else if (type === "scheduleFollowup") {
      const days = clampNumber(o.days, E.followupDaysMin, E.followupDaysMax);
      const seed = typeof o.seed === "string" ? o.seed.slice(0, 200) : "";
      if (days !== null && seed) {
        if (charRef && roster.size && !roster.has(charRef)) continue;
        out.push({ type, days, seed, charRef, note });
      }
    } else if (type === "none") {
      out.push({ type, note });
    }
  }
  return out;
}

function parseAuthorResponse(text: string): EventSpec | null {
  const json = extractJson<{ spec?: unknown }>(text);
  if (!json) return null;
  if (json.spec === null) return null;
  if (!json.spec || typeof json.spec !== "object") return null;
  const o = json.spec as Record<string, unknown>;
  const mode = o.mode === "scene" || o.mode === "notice" ? o.mode : null;
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 80) : "";
  const opening = typeof o.opening === "string" ? o.opening.trim().slice(0, 800) : "";
  if (!mode || !title || !opening) return null;
  const tone = typeof o.tone === "string" ? o.tone.slice(0, 20) : "neutral";
  const stakes = typeof o.stakes === "string" ? o.stakes.slice(0, 160) : undefined;
  const characterRef =
    o.characterRef === null || o.characterRef === "new" || typeof o.characterRef === "string"
      ? (o.characterRef as string | null)
      : undefined;
  let effects: EventEffect[] | undefined;
  if (Array.isArray(o.effects)) {
    const parsed = parseEventEffects(JSON.stringify({ effects: o.effects }));
    if (parsed?.length) effects = parsed;
  }
  return { mode, title, tone, opening, stakes, characterRef, effects };
}

function formatAuthorContext(ctx: EventDirectorContext): string {
  const lines = [
    `Streamer: ${ctx.settings.streamerName}`,
    `Day ${ctx.metrics.day}, live: ${ctx.isLive}`,
    `Cash $${ctx.metrics.cash.toFixed(0)}, followers ${ctx.metrics.followers}, subs ${ctx.metrics.subscribers}`,
    `Hype ${Math.round(ctx.metrics.hype)}, energy ${Math.round(ctx.metrics.energy)}, comfort ${Math.round(ctx.metrics.comfort)}, hunger ${Math.round(ctx.metrics.hunger)}, bladder ${Math.round(ctx.metrics.bladder)}, hygiene ${Math.round(ctx.metrics.hygiene)}`,
    `Build: niche=${ctx.niche}, outfit=${ctx.outfit}, showmanship L${ctx.mastery.showmanship}, composure L${ctx.mastery.composure}, production Q=${ctx.productionQuality}`,
    ctx.segmentAppealSummary ? `Gear appeal: ${ctx.segmentAppealSummary}` : "",
    ctx.recentNarrative ? `Recent beats:\n${ctx.recentNarrative.slice(-600)}` : "",
    ctx.viewers.length
      ? `Online viewers:\n${ctx.viewers.map((v) => `- id=${v.id} @${v.handle} (${v.archetype}, aff ${Math.round(v.affinity)}, threat ${v.threat}, ${v.relationship})${v.memory ? ` mem: ${v.memory.slice(0, 60)}` : ""}`).join("\n")}`
      : "Online viewers: (none)",
    ctx.signals.length ? `Signals:\n${ctx.signals.map((s) => `- ${s.id}: ${s.label}${s.mustAddress ? " [MUST ADDRESS]" : ""}`).join("\n")}` : "",
    ctx.pendingFollowups.length
      ? `Pending follow-ups: ${ctx.pendingFollowups.map((f) => `day ${f.day}: ${f.seed.slice(0, 50)}`).join("; ")}`
      : "",
    ctx.recentEventTitles.length ? `Recent events (avoid repeating): ${ctx.recentEventTitles.join(" | ")}` : "",
    `Pacing: ${ctx.beatsSinceLastEvent} beats / ${ctx.daysSinceLastEvent} days since last event`,
    ctx.seed ? `Follow-up seed: ${ctx.seed}` : "",
    ctx.activity
      ? `Active activity: ${ctx.activity.label} (beat ${ctx.activity.roundsPlayed + 1}). ${ctx.activity.narrationHint} Author activity-specific scenes/notices that fit the current segment — stay in that format, do not pivot stream type.`
      : "",
    'Return JSON: { "spec": EventSpec | null }.',
  ];
  return lines.filter(Boolean).join("\n");
}

function clampNumber(value: unknown, lo: number, hi: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clamp(Math.round(value), lo, hi);
}

const EFFECT_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "metric",
        "money",
        "followers",
        "subscribers",
        "affinity",
        "threat",
        "relationship",
        "revealName",
        "blockViewer",
        "spawnViewer",
        "incomingDm",
        "grantUpgrade",
        "grantItem",
        "masteryXp",
        "raid",
        "meetup",
        "scheduleFollowup",
        "none",
      ],
    },
    key: { type: "string", enum: ["hype", "energy", "comfort", "hunger", "bladder", "hygiene", "horny"] },
    delta: { type: "number" },
    amount: { type: "number" },
    charRef: { type: "string" },
    name: { type: "string" },
    relationship: { type: "string", enum: [...REL_VALUES] },
    upgradeId: { type: "string" },
    domain: { type: "string", enum: ["showmanship", "composure"] },
    size: { type: "number" },
    hint: { type: "string" },
    days: { type: "number" },
    seed: { type: "string" },
    archetypeHint: { type: "string" },
    message: { type: "string" },
    note: { type: "string" },
  },
  required: ["type"],
};

const EVENT_EFFECTS_WRAPPER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    effects: { type: "array", items: EFFECT_ITEM_SCHEMA },
  },
  required: ["effects"],
};

const EVENT_SPEC_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    spec: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["scene", "notice"] },
            title: { type: "string" },
            tone: { type: "string" },
            opening: { type: "string" },
            stakes: { type: "string" },
            characterRef: { type: ["string", "null"] },
            effects: { type: "array", items: EFFECT_ITEM_SCHEMA },
          },
          required: ["mode", "title", "opening"],
        },
      ],
    },
  },
  required: ["spec"],
};
