import type { LlmAdapter } from "../llm/adapter";
import { completeJsonWithRepair } from "../llm/adapter";
import { extractJson } from "../llm/json";
import type { CharacterSheet } from "./characters";
import type { DmLine, Metrics, Settings } from "./types";
import { steeringForTier } from "./content";
import { clamp } from "../rng/rng";

export type DmEffect =
  | { type: "tip"; amount: number; note?: string }
  | { type: "gift"; item: string; note?: string }
  | { type: "image"; subject: string; note?: string }
  | { type: "request"; ask: string; note?: string }
  | { type: "reveal"; name: string; note?: string }
  | { type: "affinity"; delta: number; note?: string }
  | { type: "threat"; delta: number; note?: string }
  | { type: "relationship"; relationship: "none" | "romantic" | "sexual" | "dominant" | "submissive" | "married"; note?: string }
  | { type: "meetup"; hint: string; note?: string }
  | { type: "none"; note?: string };

export interface DmDirectorContext {
  settings: Settings;
  character: CharacterSheet;
  history: DmLine[];
  metrics: Pick<Metrics, "cash" | "comfort" | "mood" | "day">;
  streamMemory?: string;
}

export async function directDm(adapter: LlmAdapter, ctx: DmDirectorContext): Promise<DmEffect[]> {
  if (adapter.isMock) return localDirect(ctx);
  const req = {
    system: [
      "You are a game director for DM consequences in a streamer life-sim.",
      "Read the DM exchange and return JSON effects that are justified by what was said.",
      "Effects should be modest and sparse; emit none when nothing actionable happened.",
      "Do not invent impossible events or huge money swings.",
      "Field rules per effect type: tip→amount; gift→item; image→subject; request→ask; reveal→name; affinity/threat→delta; relationship→relationship; meetup→hint (a short summary of the plan to come over, e.g. 'on their way to your apartment'). Always include the type's required field.",
      "When the viewer is heading to or arriving at the streamer's home, emit a SINGLE `meetup` effect (not one per message).",
      steeringForTier(ctx.settings),
    ].join("\n"),
    messages: [
      {
        role: "user" as const,
        content: [
          `Streamer: ${ctx.settings.streamerName}`,
          `Viewer: ${ctx.character.handle} (${ctx.character.relationship}, affinity ${Math.round(ctx.character.affinity)}, threat ${ctx.character.threat})`,
          ctx.character.memory ? `Viewer memory: ${ctx.character.memory}` : "",
          ctx.streamMemory ? `Stream memory: ${ctx.streamMemory}` : "",
          `Current day: ${ctx.metrics.day}`,
          "DM thread (oldest first):",
          ...ctx.history.slice(-12).map((l) => `${l.role === "me" ? "Streamer" : "Viewer"}: ${l.text}`),
          "Return JSON: { effects: DmEffect[] }.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    jsonMode: true,
    jsonSchema: EFFECT_SCHEMA,
  };
  const parsed = await completeJsonWithRepair(adapter, req, parseDmEffects, "story");
  return parsed && parsed.length ? parsed : [{ type: "none" }];
}

function localDirect(ctx: DmDirectorContext): DmEffect[] {
  const last = ctx.history.slice(-2).map((l) => l.text.toLowerCase()).join("\n");
  const effects: DmEffect[] = [];
  if (/\b(on my way|be there|coming over|your place|address|apartment)\b/i.test(last)) {
    effects.push({ type: "meetup", hint: "they said they are on the way" });
  }
  const money = /\$(\d{1,3})/.exec(last);
  if (money) {
    effects.push({ type: "tip", amount: clamp(Number(money[1]), 1, 80) });
  } else if (/\b(tip|sent you|cashapp|venmo)\b/i.test(last)) {
    effects.push({ type: "tip", amount: 10 });
  }
  if (/\b(photo|pic|selfie|image)\b/i.test(last)) effects.push({ type: "image", subject: "phone selfie" });
  if (/\bgift|bought you|package\b/i.test(last)) effects.push({ type: "gift", item: "a small gift" });
  if (/\bmy name is\b/i.test(last) && !ctx.character.displayName) {
    const m = /my name is ([a-z][a-z' -]{1,20})/i.exec(last);
    if (m) effects.push({ type: "reveal", name: titleCase(m[1].trim()) });
  }
  return effects.length ? effects : [{ type: "none" }];
}

function parseDmEffects(text: string): DmEffect[] | null {
  const json = extractJson<{ effects?: unknown }>(text);
  if (!json || !Array.isArray(json.effects)) return null;
  const out: DmEffect[] = [];
  for (const raw of json.effects) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const type = typeof o.type === "string" ? o.type : "";
    const note = typeof o.note === "string" ? o.note.slice(0, 160) : undefined;
    if (type === "tip") {
      const amount = clampNumber(o.amount, 1, 120);
      if (amount !== null) out.push({ type, amount, note });
    } else if (type === "gift" && typeof o.item === "string") {
      out.push({ type, item: o.item.slice(0, 80), note });
    } else if (type === "image" && typeof o.subject === "string") {
      out.push({ type, subject: o.subject.slice(0, 80), note });
    } else if (type === "request" && typeof o.ask === "string") {
      out.push({ type, ask: o.ask.slice(0, 120), note });
    } else if (type === "reveal" && typeof o.name === "string") {
      out.push({ type, name: o.name.slice(0, 28), note });
    } else if (type === "affinity") {
      const delta = clampNumber(o.delta, -8, 8);
      if (delta !== null) out.push({ type, delta, note });
    } else if (type === "threat") {
      const delta = clampNumber(o.delta, -2, 2);
      if (delta !== null) out.push({ type, delta, note });
    } else if (type === "relationship" && typeof o.relationship === "string") {
      if (["none", "romantic", "sexual", "dominant", "submissive", "married"].includes(o.relationship)) {
        out.push({ type, relationship: o.relationship as Extract<DmEffect, { type: "relationship" }>["relationship"], note });
      }
    } else if (type === "meetup") {
      // Be tolerant: models often emit `meetup` with a `note` (or `name`) but no
      // `hint`. Don't drop the whole visit over a missing field — derive a hint.
      const rawHint =
        typeof o.hint === "string" ? o.hint
        : typeof o.note === "string" ? o.note
        : typeof o.ask === "string" ? o.ask
        : "they're on their way over";
      out.push({ type, hint: rawHint.slice(0, 120), note });
    } else if (type === "none") {
      out.push({ type, note });
    }
  }
  return out;
}

function clampNumber(value: unknown, lo: number, hi: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clamp(Math.round(value), lo, hi);
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : ""))
    .join(" ");
}

const EFFECT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    effects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["tip", "gift", "image", "request", "reveal", "affinity", "threat", "relationship", "meetup", "none"],
          },
          amount: { type: "number" },
          item: { type: "string" },
          subject: { type: "string" },
          ask: { type: "string" },
          name: { type: "string" },
          delta: { type: "number" },
          relationship: { type: "string", enum: ["none", "romantic", "sexual", "dominant", "submissive", "married"] },
          hint: { type: "string" },
          note: { type: "string" },
        },
        required: ["type"],
      },
    },
  },
  required: ["effects"],
};
