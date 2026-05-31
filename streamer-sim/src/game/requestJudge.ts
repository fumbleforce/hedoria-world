import type { LlmAdapter } from "../llm/adapter";
import { completeJsonWithRepair } from "../llm/adapter";
import { extractJson } from "../llm/json";
import type { Settings } from "./types";
import { clamp } from "../rng/rng";

export interface RequestJudgeItem {
  index: number;
  ask: string;
  handle: string;
  rewardLabel: string;
}

export interface RequestJudgeContext {
  settings: Settings;
  requests: RequestJudgeItem[];
  streamMemory: string;
  recentStory: string;
  recentChat: string[];
  day: number;
  isLive: boolean;
}

export interface RequestFulfillmentEntry {
  index: number;
  fulfilled: boolean;
  evidence: string;
  bonusAffinity?: number;
  reaction?: string;
}

export type RequestFulfillmentResult = { entries: RequestFulfillmentEntry[] };

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at", "with", "your", "my", "me", "you",
  "stream", "vlog", "video", "do", "a", "please", "can", "could", "would", "will", "i", "we", "it", "is",
]);

export async function judgeRequestFulfillment(
  adapter: LlmAdapter,
  ctx: RequestJudgeContext,
): Promise<RequestFulfillmentResult> {
  if (!ctx.requests.length) return { entries: [] };
  if (adapter.isMock) return localJudge(ctx);

  const req = {
    system: [
      "You are judging whether a streamer has fulfilled viewer content requests in a life-sim.",
      "Read the recent stream/story content and decide, for each numbered request, whether the streamer clearly did what was asked.",
      "Semantic match is OK (e.g. 'repotting vlog' is satisfied by a plant-repotting segment). Be conservative — vague or unrelated content means fulfilled=false.",
      "Return exactly one entry per input request, keyed by the provided index.",
      "bonusAffinity: 0-2 only when they went notably above and beyond on that ask; otherwise omit or 0.",
      "reaction: one short thank-you message in the viewer's voice, only when fulfilled=true.",
      "Return JSON: { entries: [{ index, fulfilled, evidence, bonusAffinity?, reaction? }] }.",
    ].join("\n"),
    messages: [
      {
        role: "user" as const,
        content: [
          `Streamer: ${ctx.settings.streamerName}`,
          `Day: ${ctx.day}`,
          ctx.isLive ? "Currently live." : "Offline — judging recent story beats.",
          ctx.streamMemory ? `Stream memory: ${ctx.streamMemory}` : "",
          ctx.recentStory ? `Recent story:\n${ctx.recentStory}` : "(no recent story)",
          ctx.recentChat.length ? `Recent chat:\n${ctx.recentChat.join("\n")}` : "",
          "Open requests to judge:",
          ...ctx.requests.map(
            (r) => `#${r.index}: @${r.handle} asked for "${r.ask}" (reward: ${r.rewardLabel})`,
          ),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    jsonMode: true,
    jsonSchema: FULFILLMENT_SCHEMA,
  };

  const parsed = await completeJsonWithRepair(adapter, req, parseFulfillment, "story");
  return parsed ?? { entries: [] };
}

function localJudge(ctx: RequestJudgeContext): RequestFulfillmentResult {
  const corpus = `${ctx.recentStory}\n${ctx.recentChat.join("\n")}`.toLowerCase();
  const entries: RequestFulfillmentEntry[] = [];

  for (const item of ctx.requests) {
    const tokens = tokenize(item.ask);
    const matched = tokens.filter((t) => corpus.includes(t));
    const fulfilled = matched.length >= 2 || (tokens.length === 1 && matched.length >= 1);
    entries.push({
      index: item.index,
      fulfilled,
      evidence: fulfilled ? `matched: ${matched.join(", ")}` : "",
    });
  }

  return { entries };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function parseFulfillment(text: string): RequestFulfillmentResult | null {
  const json = extractJson<{ entries?: unknown }>(text);
  if (!json || !Array.isArray(json.entries)) return null;

  const entries: RequestFulfillmentEntry[] = [];
  for (const raw of json.entries) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const index = typeof o.index === "number" && Number.isFinite(o.index) ? Math.round(o.index) : null;
    if (index === null || index < 1) continue;
    const fulfilled = o.fulfilled === true;
    const evidence = typeof o.evidence === "string" ? o.evidence.slice(0, 160) : "";
    const bonusRaw = typeof o.bonusAffinity === "number" ? o.bonusAffinity : 0;
    const bonusAffinity = fulfilled ? clamp(Math.round(bonusRaw), 0, 2) : undefined;
    const reaction = fulfilled && typeof o.reaction === "string" ? o.reaction.slice(0, 160) : undefined;
    entries.push({ index, fulfilled, evidence, bonusAffinity, reaction });
  }

  return { entries };
}

const FULFILLMENT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          fulfilled: { type: "boolean" },
          evidence: { type: "string" },
          bonusAffinity: { type: "number" },
          reaction: { type: "string" },
        },
        required: ["index", "fulfilled"],
      },
    },
  },
  required: ["entries"],
};
