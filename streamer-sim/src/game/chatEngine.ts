import type { LlmAdapter } from "../llm/adapter";
import { completeJsonWithRepair } from "../llm/adapter";
import { diag } from "../diag/log";
import type { ChatMessage, ChatMessageKind, Metrics, Settings } from "./types";
import { tierIntensity } from "./content";
import { LINES } from "./personas";
import { ARCHETYPE_BY_ID } from "./archetypes";
import type { CharacterSheet, Roster } from "./characters";
import { SEGMENTS, SEGMENT_IDS, type AudienceState } from "./segments";
import { extractJson } from "../llm/json";
import { BALANCE } from "./balance";
import { chance, clamp, pick, randInt, uid } from "../rng/rng";
import { promptSections, activityLockBlock } from "./prompts";
import type { ActivityCategory } from "./types";

export interface ChatContext {
  settings: Settings;
  metrics: Metrics;
  audience: AudienceState;
  roster: Roster;
  online: string[];
  systemPrompt: string;
  actionContext: string;
  /** Last few chat lines, so replies flow from the conversation. */
  recentChat?: string[];
  /** Rolling summary of the stream so far, so callbacks/running jokes emerge. */
  streamMemory?: string;
  /** Each online regular's own recent lines, to keep their voice consistent. */
  characterVoices?: Array<{ handle: string; lines: string[] }>;
  /** Observable body-state cues for chat (never includes private bladder). */
  visibleCues?: string[];
  /** Which zone the active camera shows (on-screen). */
  onScreenZoneLabel?: string;
  /** Where the streamer is physically standing. */
  playerZoneLabel?: string;
  /** Whether the streamer is visible on the active camera angle. */
  playerOnCamera?: boolean;
  /** Short description of what she's wearing. */
  equippedLook?: string;
  /** Active stream activity — steers backseat/scream/vote chat. */
  activity?: { label: string; narrationHint: string; chatHint: string; category?: ActivityCategory };
  count: number;
}

export type ChatVolumeMode = "action" | "continue" | "ambient";

/** Code-owned burst size from hype (+ optional viewer nudge). */
export function chatBurstCount(
  hype: number,
  viewers: number,
  mode: ChatVolumeMode = "action",
): number {
  const c = BALANCE.chat;
  const h = clamp(hype, 0, 100) / 100;
  const base = Math.pow(h, c.actionHypeExp) * c.actionHypeScale + viewers / c.actionViewerDiv;
  const action = clamp(Math.round(base), c.actionMin, c.actionMax);
  if (mode === "continue") {
    return clamp(Math.round(action * c.continueMult), c.continueMin, c.continueMax);
  }
  if (mode === "ambient") {
    return clamp(Math.round(action * c.ambientTickMult), 1, c.ambientTickMax);
  }
  return action;
}

export function chatAmbientPlan(hype: number, viewers: number): {
  ticks: number;
  gapMs: number;
  perTick: number;
} {
  const c = BALANCE.chat;
  if (hype < c.ambientMinHype) {
    return { ticks: 0, gapMs: c.ambientGapMaxMs, perTick: 1 };
  }
  const h = clamp(hype, 0, 100) / 100;
  const ticks = clamp(Math.round(h * c.ambientTicksAt100), c.ambientMinTicks, c.ambientMaxTicks);
  const gapMs = Math.round(c.ambientGapMaxMs - h * (c.ambientGapMaxMs - c.ambientGapMinMs));
  const perTick = chatBurstCount(hype, viewers, "ambient");
  return { ticks, gapMs, perTick };
}

export async function generateChatBurst(
  adapter: LlmAdapter,
  ctx: ChatContext,
): Promise<ChatMessage[]> {
  if (adapter.isMock) return mockBurst(ctx);
  try {
    const parsed = await completeJsonWithRepair(
      adapter,
      buildRequest(ctx),
      (text) => {
        const msgs = parseChat(text, ctx.roster);
        return msgs.length > 0 ? msgs : null;
      },
      "chat",
    );
    if (parsed && parsed.length > 0) return parsed;
    diag.warn("chat", "LLM chat empty/unparseable after repair; using neutral filler");
  } catch (err) {
    diag.warn("chat", "LLM chat failed; using neutral filler", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // In LLM mode we must NOT emit canned archetype/persona dialogue — those read
  // as scripted and (worse) get fed back as "voice" and parroted. On a genuine
  // model failure, fall back to innocuous neutral filler only.
  return fallbackBurst(ctx);
}

/** Ultra-generic, non-characterful filler for LLM-mode failures. Never scripted dialogue. */
const NEUTRAL_FILLER: readonly string[] = [
  "lol", "real", "W", "fr", "o/", "ngl yeah", "this is nice", "hi chat",
  "back again", "good vibes", "true", "haha", "oh nice",
];

function fallbackBurst(ctx: ChatContext): ChatMessage[] {
  const onlineChars = ctx.online.map((id) => ctx.roster[id]).filter(Boolean);
  const n = clamp(Math.round(ctx.count * 0.5), 1, 4);
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    const who = onlineChars.length && chance(0.6) ? pick(onlineChars) : null;
    out.push({
      id: uid("msg"),
      user: who ? who.handle : anonHandle(),
      text: pick(NEUTRAL_FILLER),
      kind: "normal",
      characterId: who?.id,
      scripted: true,
      ts: Date.now(),
    });
  }
  return out;
}

export function audienceSummary(a: AudienceState): string {
  return (
    SEGMENT_IDS.filter((id) => a[id].population >= 1)
      .map((id) => `${SEGMENTS[id].label} ×${a[id].population.toFixed(0)} (${a[id].satisfaction.toFixed(0)}%)`)
      .join(", ") || "nearly empty"
  );
}

// --------------------------------------------------------------- LLM path

function buildRequest(ctx: ChatContext) {
  const onlineChars = ctx.online.map((id) => ctx.roster[id]).filter(Boolean).slice(0, 12);
  const named = onlineChars
    .map((c) => `${c.handle} (${ARCHETYPE_BY_ID[c.archetypeId]?.label}, affinity ${Math.round(c.affinity)})`)
    .join("; ");
  const dynamics = describeDynamics(onlineChars);
  const voices = ctx.characterVoices?.length
    ? ctx.characterVoices
        .filter((v) => v.lines.length)
        .map((v) => `- ${v.handle}: ${v.lines.slice(-3).map((l) => `"${l}"`).join(" ")}`)
        .join("\n")
    : "";
  const user = promptSections([
    { heading: "Audience mix", body: audienceSummary(ctx.audience) },
    {
      heading: "Named regulars online",
      body: named ? named : undefined,
    },
    { heading: "Chat dynamics", body: dynamics || undefined },
    {
      heading: "Stream memory",
      body: ctx.streamMemory?.trim() || undefined,
    },
    {
      heading: "Character voices (stay consistent)",
      body: voices || undefined,
    },
    {
      heading: "Stream setup",
      body: ctx.onScreenZoneLabel
        ? `On-screen camera shows: ${ctx.onScreenZoneLabel}. Streamer is at: ${ctx.playerZoneLabel ?? ctx.onScreenZoneLabel}${ctx.playerOnCamera === false ? " (OFF CAMERA — chat can't see her right now)" : ""}.${ctx.equippedLook ? ` Wearing: ${ctx.equippedLook}.` : ""}`
        : undefined,
    },
    {
      heading: "Room vibe",
      body: `Viewers: ${Math.round(ctx.metrics.currentViewers)}, hype: ${Math.round(ctx.metrics.hype)}/100.`,
    },
    {
      heading: "Visible cues",
      body: ctx.visibleCues?.length ? ctx.visibleCues.join("; ") : undefined,
    },
    {
      heading: "Recent chat (do not repeat)",
      body: ctx.recentChat?.length
        ? ctx.recentChat.slice(-6).join("\n")
        : undefined,
    },
    {
      heading: "Active activity (locked — chat stays in segment)",
      body: ctx.activity
        ? activityLockBlock(ctx.activity)
        : undefined,
    },
    {
      heading: "React to this",
      body: `${ctx.settings.streamerName} just did/said: ${ctx.actionContext}`,
    },
    {
      heading: "Output",
      body: `Produce about ${ctx.count} short messages reacting directly to the above. Prefer named regulars. Occasionally let two regulars @-mention each other (troll baiting simp, mod clapback, shipping).`,
    },
  ]);
  return {
    system: ctx.systemPrompt,
    messages: [{ role: "user" as const, content: user }],
    jsonMode: true,
    jsonSchema: chatSchema(),
  };
}

function chatSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            user: { type: "string" },
            text: { type: "string" },
            kind: {
              type: "string",
              enum: [
                "normal", "hype", "question", "troll", "flirty", "creepy",
                "donation", "follow", "sub", "raid", "mod",
              ],
            },
            amount: { type: "number" },
          },
          required: ["user", "text", "kind"],
        },
      },
    },
    required: ["messages"],
  };
}

/**
 * Spot pairs of online regulars who'd play off each other and hint the model to
 * let them interact, so feuds/ships emerge from the named cast — not just
 * reactions to the streamer.
 */
function describeDynamics(chars: CharacterSheet[]): string {
  const seg = (c: CharacterSheet) => ARCHETYPE_BY_ID[c.archetypeId]?.segment;
  const find = (s: string) => chars.find((c) => seg(c) === s);
  const lines: string[] = [];
  const troll = find("trolls");
  const simp = find("simps");
  const mod = chars.find((c) => c.isMod);
  if (troll && simp) lines.push(`${troll.handle} loves baiting ${simp.handle} — let them spar.`);
  if (mod && troll) lines.push(`${mod.handle} (mod) won't let ${troll.handle} run wild.`);
  // Two high-affinity regulars who aren't antagonists may "ship"/banter.
  const friendly = chars.filter((c) => c.affinity >= 50 && seg(c) !== "trolls" && seg(c) !== "stalkers");
  if (friendly.length >= 2) lines.push(`${friendly[0].handle} and ${friendly[1].handle} are chat buddies; they riff together.`);
  return lines.length ? `Chat dynamics: ${lines.join(" ")}` : "";
}

function parseChat(text: string, roster: Roster): ChatMessage[] {
  const json = extractJson<{ messages?: unknown } | unknown[]>(text);
  if (!json) return [];
  // Accept either { messages: [...] } or a bare [...] array.
  const arr = Array.isArray(json) ? json : (json as { messages?: unknown }).messages;
  if (!Array.isArray(arr)) return [];
  const valid: ChatMessageKind[] = [
    "normal", "hype", "question", "troll", "flirty", "creepy",
    "donation", "follow", "sub", "raid", "mod",
  ];
  const byHandle = new Map(Object.values(roster).map((c) => [c.handle.toLowerCase(), c.id]));
  const out: ChatMessage[] = [];
  for (const raw of arr) {
    const r = raw as { user?: unknown; text?: unknown; kind?: unknown; amount?: unknown };
    const user = typeof r.user === "string" ? r.user.slice(0, 24) : "anon";
    const kind = (valid as string[]).includes(r.kind as string) ? (r.kind as ChatMessageKind) : "normal";
    const t = typeof r.text === "string" ? r.text.slice(0, 200) : "";
    if (!t && kind !== "follow") continue;
    const amount = typeof r.amount === "number" && r.amount > 0 ? Math.round(r.amount * 100) / 100 : undefined;
    const characterId = byHandle.get(user.toLowerCase());
    out.push({ id: uid("msg"), user, text: t, kind, amount, characterId, ts: Date.now() });
  }
  return out;
}

// --------------------------------------------------------------- local mock

function activityMockLine(category?: ActivityCategory): string | null {
  const pools: Partial<Record<ActivityCategory, string[]>> = {
    game: [
      "go left go left!!",
      "CLIP THAT",
      "backseat gaming at its finest",
      "you missed the shot lol",
    ],
    performance: ["this is so good", "more!!", "goosebumps", "don't stop"],
    creative: ["love the colors", "show the progress", "that's fire"],
    chill: ["vibes", "so cozy", "this is my comfort stream"],
    intimate: ["👀", "you're so bold", "keep going"],
  };
  const lines = category ? pools[category] : undefined;
  return lines ? pick(lines) : pick(["this segment hits", "chat is locked in", "W stream"]);
}

export function mockBurst(ctx: ChatContext): ChatMessage[] {
  const intensity = tierIntensity(ctx.settings.contentTier);
  const n = Math.max(1, ctx.count + randInt(-1, 1));
  const out: ChatMessage[] = [];
  const onlineChars = ctx.online.map((id) => ctx.roster[id]).filter(Boolean);
  const activityLine = ctx.activity ? activityMockLine(ctx.activity.category) : null;

  for (let i = 0; i < n; i += 1) {
    if (activityLine && i === 0 && chance(0.55)) {
      out.push({
        id: uid("msg"),
        user: onlineChars.length ? pick(onlineChars).handle : anonHandle(),
        text: activityLine,
        kind: ctx.activity?.category === "game" ? "hype" : "normal",
        characterId: onlineChars.length ? pick(onlineChars).id : undefined,
        scripted: true,
        ts: Date.now(),
      });
      continue;
    }
    // ~65% of lines come from a named online character when we have them.
    if (onlineChars.length && chance(0.65)) {
      out.push(fromCharacter(pick(onlineChars), intensity));
    } else {
      out.push(anonLine(intensity));
    }
  }
  // ~20% of bursts: one regular @-mentions another (a feud or a ship).
  if (onlineChars.length >= 2 && chance(0.2)) {
    const line = crossTalk(onlineChars);
    if (line) out.push(line);
  }
  if (chance(0.05)) out.push(anonLine(intensity, "follow"));
  return out;
}

/** Twitch-style follow/sub notification line for passive live growth. */
export function growthPing(
  roster: Roster,
  onlineIds: string[],
  kind: "follow" | "sub",
): ChatMessage {
  const online = onlineIds.map((id) => roster[id]).filter(Boolean);
  if (online.length && chance(0.45)) {
    const c = pick(online);
    if (kind === "follow") {
      return {
        id: uid("msg"),
        user: c.handle,
        text: "followed!",
        kind: "follow",
        characterId: c.id,
        scripted: true,
        ts: Date.now(),
      };
    }
    const amount = 5;
    const text = pick(LINES.sub) || "just subscribed!";
    return {
      id: uid("msg"),
      user: c.handle,
      text,
      kind: "sub",
      amount,
      characterId: c.id,
      scripted: true,
      ts: Date.now(),
    };
  }
  if (kind === "follow") return anonLine(1, "follow");
  const amount = 5;
  return {
    id: uid("msg"),
    user: anonHandle(),
    text: pick(LINES.sub) || "just subscribed!",
    kind: "sub",
    amount,
    scripted: true,
    ts: Date.now(),
  };
}

function fromCharacter(c: CharacterSheet, intensity: number): ChatMessage {
  const arch = ARCHETYPE_BY_ID[c.archetypeId];
  let kind: ChatMessageKind = "normal";
  let text = arch ? pick(arch.lines) : "hi";
  if (c.personality.speechTic && chance(0.35)) {
    text = `${text} ${c.personality.speechTic}`;
  }
  if (c.personality.fixation && c.threat >= 1 && chance(0.25)) {
    text = pick([
      `still thinking about ${c.personality.fixation} btw`,
      `you ever notice ${c.personality.fixation}?`,
      `just saying — ${c.personality.fixation}`,
    ]);
  }
  let amount: number | undefined;

  const seg = arch?.segment;
  if (seg === "stalkers" && intensity >= 2) kind = "creepy";
  else if (seg === "simps") kind = chance(0.3) ? "flirty" : "normal";
  else if (seg === "trolls") kind = chance(0.5) ? "troll" : "normal";
  else if (seg === "hype") kind = chance(0.5) ? "hype" : "normal";
  else if (c.isMod) kind = chance(0.4) ? "mod" : "normal";

  // Whales / generous folks occasionally tip in-character.
  if ((seg === "whales" || c.archetypeId === "donator") && chance(0.25)) {
    kind = "donation";
    amount = seg === "whales" ? pick([50, 75, 100, 150]) : pick([3, 5, 10, 20]);
    text = `tipped $${amount} — ${text}`;
  }
  return { id: uid("msg"), user: c.handle, text, kind, amount, characterId: c.id, scripted: true, ts: Date.now() };
}

/** One online regular talking AT another — bait, clapback, or shipping. */
function crossTalk(chars: CharacterSheet[]): ChatMessage | null {
  const a = pick(chars);
  const others = chars.filter((c) => c.id !== a.id);
  if (!others.length) return null;
  const b = pick(others);
  const segA = ARCHETYPE_BY_ID[a.archetypeId]?.segment;
  let text: string;
  let kind: ChatMessageKind = "normal";
  if (segA === "trolls") { text = `@${b.handle} you're so easy to wind up lol`; kind = "troll"; }
  else if (a.isMod) { text = `@${b.handle} knock it off 😤`; kind = "mod"; }
  else if (segA === "simps") { text = `@${b.handle} stop ratioing me 😭`; kind = "flirty"; }
  else text = pick([`@${b.handle} fr fr`, `@${b.handle} we're always here huh`, `lol @${b.handle} called it`]);
  return { id: uid("msg"), user: a.handle, text, kind, characterId: a.id, scripted: true, ts: Date.now() };
}

function anonLine(intensity: number, force?: ChatMessageKind): ChatMessage {
  const kind: ChatMessageKind = force ?? pick(["normal", "normal", "hype", "question", "troll"]);
  let text = LINES[kind]?.length ? pick(LINES[kind]) : "";
  let amount: number | undefined;
  if (kind === "follow") text = "followed";
  if (kind === "creepy" && intensity < 2) text = pick(LINES.flirty);
  return { id: uid("msg"), user: anonHandle(), text, kind, amount, scripted: true, ts: Date.now() };
}

function anonHandle(): string {
  const a = pick(["anon", "viewer", "user", "guest", "rando", "lurker"]);
  return `${a}${randInt(100, 9999)}`;
}
