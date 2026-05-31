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
import { chance, pick, randInt, uid } from "../rng/rng";

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
  count: number;
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
    diag.warn("chat", "LLM chat empty/unparseable after repair; using mock burst");
  } catch (err) {
    diag.warn("chat", "LLM chat failed; using mock burst", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return mockBurst(ctx);
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
  const memory = ctx.streamMemory?.trim()
    ? `Stream so far (callbacks/running jokes welcome): ${ctx.streamMemory.trim()}`
    : "";
  const voices = ctx.characterVoices?.length
    ? "Keep each regular's voice consistent with how they've talked tonight:\n" +
      ctx.characterVoices
        .filter((v) => v.lines.length)
        .map((v) => `- ${v.handle}: ${v.lines.slice(-3).map((l) => `"${l}"`).join(" ")}`)
        .join("\n")
    : "";
  const recent = ctx.recentChat?.length
    ? `Already on screen (these are DONE — never repost or re-word any of them; move the conversation forward instead):\n${ctx.recentChat.slice(-6).join("\n")}`
    : "";
  const user = [
    `Audience mix: ${audienceSummary(ctx.audience)}`,
    named ? `Named regulars currently watching (use some of these handles): ${named}` : "",
    dynamics,
    memory,
    voices,
    `Vibe — viewers: ${Math.round(ctx.metrics.currentViewers)}, hype: ${Math.round(ctx.metrics.hype)}/100.`,
    recent,
    `>>> ${ctx.settings.streamerName} just did this, REACT SPECIFICALLY TO IT: ${ctx.actionContext}`,
    `Produce about ${ctx.count} short messages reacting directly to that. Prefer the named regulars for some lines. Occasionally let two regulars talk to EACH OTHER (a troll baiting a simp, a mod clapping back, two regulars shipping or bantering) by @-mentioning a handle, not just reacting to the streamer.`,
  ]
    .filter(Boolean)
    .join("\n");
  return { system: ctx.systemPrompt, messages: [{ role: "user" as const, content: user }], jsonMode: true };
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

export function mockBurst(ctx: ChatContext): ChatMessage[] {
  const intensity = tierIntensity(ctx.settings.contentTier);
  const n = Math.max(2, ctx.count + randInt(-1, 1));
  const out: ChatMessage[] = [];
  const onlineChars = ctx.online.map((id) => ctx.roster[id]).filter(Boolean);

  for (let i = 0; i < n; i += 1) {
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

function fromCharacter(c: CharacterSheet, intensity: number): ChatMessage {
  const arch = ARCHETYPE_BY_ID[c.archetypeId];
  let kind: ChatMessageKind = "normal";
  let text = arch ? pick(arch.lines) : "hi";
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
  return { id: uid("msg"), user: c.handle, text, kind, amount, characterId: c.id, ts: Date.now() };
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
  return { id: uid("msg"), user: a.handle, text, kind, characterId: a.id, ts: Date.now() };
}

function anonLine(intensity: number, force?: ChatMessageKind): ChatMessage {
  const kind: ChatMessageKind = force ?? pick(["normal", "normal", "hype", "question", "troll"]);
  let text = LINES[kind]?.length ? pick(LINES[kind]) : "";
  let amount: number | undefined;
  if (kind === "follow") text = "followed";
  if (kind === "creepy" && intensity < 2) text = pick(LINES.flirty);
  return { id: uid("msg"), user: anonHandle(), text, kind, amount, ts: Date.now() };
}

function anonHandle(): string {
  const a = pick(["anon", "viewer", "user", "guest", "rando", "lurker"]);
  return `${a}${randInt(100, 9999)}`;
}
