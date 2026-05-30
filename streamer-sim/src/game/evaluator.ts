import type { LlmAdapter } from "../llm/adapter";
import { diag } from "../diag/log";
import { ACTION_TAGS, type ActionTag, type ActionVerdict, type PlayerAction } from "./actions";
import { SEGMENT_IDS, type SegmentId } from "./segments";
import { fillPrompt } from "./prompts";
import type { Settings } from "./types";
import { steeringForTier } from "./content";
import { extractJson } from "../llm/json";
import { clamp } from "../rng/rng";

export interface EvalContext {
  settings: Settings;
  /** Resolved evaluator system prompt (after overrides + var fill happen upstream). */
  evaluatorPrompt: string;
  /** Compact audience snapshot string for context. */
  audienceSummary: string;
  isLive: boolean;
  /** Where in the apartment she currently is (e.g. "couch"). */
  zoneLabel: string;
  /** Last few live chat lines, for fresh per-beat grounding (keeps prose varied). */
  recentChat?: string[];
  /** Her current stat vibe (changes every beat), so narration doesn't repeat. */
  vibe?: string;
}

/**
 * Evaluate a player action into a structured verdict. Always returns something
 * valid: uses the LLM when a real backend is configured, otherwise a
 * deterministic keyword evaluator. On any LLM error/parse-failure it falls back
 * to the local evaluator so the game never stalls.
 */
export async function evaluateAction(
  adapter: LlmAdapter,
  action: PlayerAction,
  ctx: EvalContext,
): Promise<ActionVerdict> {
  if (adapter.isMock) {
    const v = localEvaluate(action, ctx);
    logVerdict("local", action, v);
    return v;
  }
  try {
    const req = {
      system: ctx.evaluatorPrompt,
      messages: [
        {
          role: "user" as const,
          content: [
            `STREAM STATUS: ${ctx.isLive ? "LIVE (broadcasting on webcam right now)" : "OFFLINE (not broadcasting — she is just at home)"}.`,
            `HER LOCATION: ${ctx.zoneLabel}.`,
            ctx.isLive ? `Audience right now: ${ctx.audienceSummary}` : "",
            ctx.isLive && ctx.vibe ? `Her current vibe: ${ctx.vibe}.` : "",
            ctx.isLive && ctx.recentChat?.length
              ? `Live chat in the last moment:\n${ctx.recentChat.join("\n")}`
              : "",
            `She does this (${action.source}): ${action.text}`,
            action.hint ? `Hint: ${action.hint}` : "",
            ctx.isLive
              ? "Classify how the live audience reacts. Ground the narration in THIS specific moment (her vibe, the chat above) so it reads fresh — never reuse stock phrasing."
              : "She is OFFLINE — set every segment appeal to 0 / omit appeal, since no one is watching. Just judge plausibility and narrate.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      jsonMode: true,
    };
    const res = await adapter.complete(req, { kind: "story" });
    const parsed = parseVerdict(res.text);
    if (parsed) {
      logVerdict("llm", action, parsed);
      return parsed;
    }
    diag.warn("evaluator", "LLM verdict unparseable; using local fallback", {
      raw: res.text.slice(0, 200),
    });
  } catch (err) {
    diag.warn("evaluator", "LLM evaluate failed; using local fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const v = localEvaluate(action, ctx);
  logVerdict("local-fallback", action, v);
  return v;
}

function logVerdict(via: string, action: PlayerAction, v: ActionVerdict): void {
  diag.info("evaluator", `verdict via ${via}`, {
    action: action.text,
    source: action.source,
    plausible: v.plausible,
    tags: v.tags,
    intensity: v.intensity,
    appeal: v.appeal,
    pressure: v.pressure,
    setsBoundary: v.setsBoundary,
  });
}

// ----------------------------------------------------------------- LLM parse

function parseVerdict(text: string): ActionVerdict | null {
  const json = extractJson<Record<string, unknown>>(text);
  if (!json || typeof json !== "object") return null;
  const tagSet = new Set<string>(ACTION_TAGS);
  const tags = Array.isArray(json.tags)
    ? (json.tags as unknown[]).filter((t): t is ActionTag => typeof t === "string" && tagSet.has(t))
    : [];
  const appeal: Partial<Record<SegmentId, number>> = {};
  if (json.appeal && typeof json.appeal === "object") {
    for (const id of SEGMENT_IDS) {
      const v = (json.appeal as Record<string, unknown>)[id];
      if (typeof v === "number") appeal[id] = clamp(v, -3, 3);
    }
  }
  const pressure = sanitizePressure(json.pressure);
  const narration =
    typeof json.narration === "string" && json.narration.trim()
      ? json.narration.trim()
      : "You take a beat.";
  return {
    plausible: json.plausible !== false,
    reason: typeof json.reason === "string" ? json.reason : undefined,
    tags,
    intensity: clamp(typeof json.intensity === "number" ? json.intensity : 2, 1, 5),
    appeal,
    pressure,
    narration,
    setsBoundary: json.setsBoundary === true,
  };
}

function sanitizePressure(raw: unknown): ActionVerdict["pressure"] {
  const out: ActionVerdict["pressure"] = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of ["hype", "energy", "mood", "comfort"] as const) {
    const v = r[k];
    if (v === "up" || v === "down" || v === "none") out[k] = v;
  }
  return out;
}

// ----------------------------------------------------------------- local eval

interface Rule {
  match: RegExp;
  tags: ActionTag[];
  intensity?: number;
  appeal?: Partial<Record<SegmentId, number>>;
  pressure?: ActionVerdict["pressure"];
  setsBoundary?: boolean;
  narration?: string;
}

/**
 * Keyword-driven evaluator used offline (no API key) and as the always-available
 * fallback. Same contract as the LLM path; deliberately broad so most freeform
 * input lands on a sensible label.
 */
const RULES: Rule[] = [
  {
    match: /\b(joke|laugh|funny|pun|meme|bit|silly|goof)\b/i,
    tags: ["funny", "energetic"],
    appeal: { hype: 2, trolls: 1, cozy: 1 },
    pressure: { hype: "up", energy: "down", mood: "up" },
    narration: "You crack a joke and your own laugh sells it — chat lights up.",
  },
  {
    match: /\b(dance|sing|song|perform|play|game|stunt|trick)\b/i,
    tags: ["energetic", "skillful", "hype"],
    intensity: 3,
    appeal: { hype: 3, simps: 1, cozy: -1 },
    pressure: { hype: "up", energy: "down" },
    narration: "You launch into a bit, hamming it up for the lens.",
  },
  {
    match: /\b(flirt\w*|wink|tease|teasing|daring|blow a kiss|seduce|sexy|suggestive|lingerie|strip)\b/i,
    tags: ["flirty", "teasing", "suggestive", "bold"],
    intensity: 3,
    appeal: { simps: 3, whales: 1, lonely: 1, cozy: -2, stalkers: 1 },
    pressure: { hype: "up", comfort: "down" },
    narration: "You lean toward the cam with a teasing little smile.",
  },
  {
    match: /\b(cry|vulnerable|honest|confess|lonely|story|childhood|struggle|open up|vent)\b/i,
    tags: ["personal", "vulnerable", "kind"],
    intensity: 2,
    appeal: { lonely: 3, whales: 1, stalkers: 2, trolls: -1 },
    pressure: { mood: "down", comfort: "down" },
    narration: "You go quiet and share something real. The chat slows, listening.",
  },
  {
    match: /\b(thank|shout ?out|appreciate|grateful|acknowledge|read.*name)\b/i,
    tags: ["grateful", "personal", "kind"],
    appeal: { whales: 3, lonely: 2, simps: 1 },
    pressure: { mood: "up" },
    narration: "You give a heartfelt shout-out by name. Someone feels seen.",
  },
  {
    match: /\b(block|report|ban|boundary|no\b|stop|enough|not comfortable|won'?t)\b/i,
    tags: ["boundary-setting", "bold"],
    setsBoundary: true,
    appeal: { stalkers: -3, simps: -1, cozy: 1, hype: 1 },
    pressure: { comfort: "up", mood: "up" },
    narration: "You set a firm boundary, calm and clear. It lands.",
  },
  {
    match: /\b(ignore|mute|skip|move on)\b/i,
    tags: ["dismissive"],
    appeal: { trolls: -2, lonely: -1 },
    pressure: {},
    narration: "You let it slide and move on.",
  },
  {
    match: /\b(rage|argue|fight|clap ?back|roast|insult|edgy|controversial)\b/i,
    tags: ["edgy", "reactive", "drama", "chaotic"],
    intensity: 3,
    appeal: { trolls: 3, hype: 1, cozy: -3 },
    pressure: { hype: "up", mood: "down", comfort: "down" },
    narration: "You take the bait and fire back. Chat erupts into chaos.",
  },
  {
    match: /\b(chill|relax|calm|cozy|just talking|just chatting|hang out|hang)\b/i,
    tags: ["chill", "cozy", "calm", "kind"],
    appeal: { cozy: 3, lonely: 1, trolls: -1 },
    pressure: { energy: "up", comfort: "up" },
    narration: "You settle into an easy, cozy rhythm with chat.",
  },
];

function localEvaluate(action: PlayerAction, ctx: EvalContext): ActionVerdict {
  const text = `${action.text} ${action.hint ?? ""}`.toLowerCase();
  const intensityCap = tierCap(ctx.settings);

  for (const rule of RULES) {
    if (rule.match.test(text)) {
      return {
        plausible: true,
        tags: rule.tags,
        intensity: clamp(rule.intensity ?? 2, 1, intensityCap),
        appeal: rule.appeal ?? {},
        pressure: rule.pressure ?? {},
        setsBoundary: rule.setsBoundary,
        narration: rule.narration ?? "You do your thing for the camera.",
      };
    }
  }
  // Generic fallback: a mild, broadly-likeable beat.
  return {
    plausible: true,
    tags: ["personal", "calm"],
    intensity: 1,
    appeal: { cozy: 1, lonely: 1 },
    pressure: { energy: "down" },
    narration: `You ${action.text.replace(/[.!?]+$/, "")}. Chat takes it in.`,
  };
}

function tierCap(s: Settings): number {
  switch (s.contentTier) {
    case "wholesome":
      return 2;
    case "flirty":
      return 3;
    case "risque":
      return 4;
    case "unhinged":
      return 5;
    case "custom":
      return 5;
  }
}

// re-export so callers can build the steering for the system prompt
export { steeringForTier, fillPrompt };
