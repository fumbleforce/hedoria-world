import type { IndexedWorld } from "../world/indexer";
import type { PackNpc } from "../schema/packSchema";
import type { LlmRequest } from "./types";

export type NpcChatMessage = {
  role: "player" | "npc";
  text: string;
};

export type NpcChatContext = {
  npc: PackNpc;
  world: IndexedWorld | null;
  history: NpcChatMessage[];
  /** The new player utterance that should be appended as the next user turn. */
  playerInput: string;
};

/**
 * Build a Gemini-friendly LlmRequest for an in-game NPC chat turn. The system
 * prompt freezes the NPC into character and surfaces the immediate world
 * context (region, location, faction); the messages array is a verbatim
 * replay of the conversation so far, with the new player input appended.
 *
 * Caching note: LlmAdapter hashes the full request JSON. Because we append
 * the player's new turn each call, the hash changes every turn — so the
 * cache won't replay a stale response unless the *exact* same conversation
 * occurs twice on the same save.
 */
export function buildNpcChatRequest(ctx: NpcChatContext): LlmRequest {
  const { npc, world, history, playerInput } = ctx;
  const npcType = world?.pack.npcTypes[npc.type];
  const faction = npc.faction ? world?.pack.factions[npc.faction] : undefined;
  const location = npc.currentLocation
    ? world?.pack.locations[npc.currentLocation]
    : undefined;
  const region = location?.region
    ? world?.pack.regions[location.region]
    : undefined;

  const lines: string[] = [
    "You are an NPC inside a small adventure game. Stay strictly in character.",
    "Reply with ONE short, vivid line (1-3 sentences). No stage directions, no asterisks, no system narration, no quotation marks around your reply.",
    "Never break the fourth wall. Never reference 'the player', 'the user', the AI, prompts, or game mechanics. Speak in first person.",
    "If asked about facts you do not plausibly know, deflect or speculate as the character would.",
    "",
    `Character: ${npc.name}`,
    `Type: ${npc.type || "person"}${npcType?.description ? ` — ${npcType.description}` : ""}`,
  ];
  if (npc.gender) lines.push(`Gender: ${npc.gender}`);
  lines.push(`Tier: ${npc.tier}`);
  if (faction) {
    lines.push(`Faction: ${faction.name}${faction.basicInfo ? ` — ${faction.basicInfo}` : ""}`);
  }
  if (npc.personality?.length) {
    lines.push(`Personality: ${npc.personality.join("; ")}`);
  }
  if (location) {
    lines.push(`Current location: ${location.name}${location.basicInfo ? ` — ${location.basicInfo}` : ""}`);
  }
  if (region) {
    lines.push(`Region: ${region.name}${region.basicInfo ? ` — ${region.basicInfo}` : ""}`);
  }

  const system = lines.join("\n");

  const messages = history.map<{ role: "user" | "assistant"; content: string }>((m) => ({
    role: m.role === "player" ? "user" : "assistant",
    content: m.text,
  }));
  messages.push({ role: "user", content: playerInput });

  return {
    system,
    messages,
    jsonMode: false,
  };
}
