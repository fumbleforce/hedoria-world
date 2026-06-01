/**
 * Character talents — something the streamer is already good at, chosen during
 * onboarding. Each talent unlocks a free stream activity + quick actions and
 * grants a synergy bonus while that activity is active.
 */

import type { LiveQuickAction } from "./liveActions";
import type { NicheId } from "./niches";
import type { SegmentId } from "./segments";

export interface Talent {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  /** Short tag woven into persona / starter-kit prompts. */
  personaTag: string;
  /** Activity id in activities.ts (must match a talent-gated entry). */
  activityId: string;
  /** Extra quick actions surfaced in the live Actions menu. */
  quickActions: LiveQuickAction[];
  /** Segments that get the synergy bonus while the talent activity runs. */
  pleases: SegmentId[];
  nicheSynergy?: NicheId[];
}

export const TALENTS: Talent[] = [
  {
    id: "singer",
    label: "Singer",
    emoji: "🎤",
    blurb: "You can carry a tune. Chat loves a live vocal.",
    personaTag: "a confident singer who can belt or go soft on command",
    activityId: "talent-singing",
    quickActions: [
      { label: "🎵 Sing a cover", prompt: "sing a cover song for chat with real feeling" },
      { label: "🎶 Take a song request", prompt: "take a song request from chat and perform it" },
    ],
    pleases: ["hype", "simps", "cozy"],
    nicheSynergy: ["variety", "justchatting"],
  },
  {
    id: "guitarist",
    label: "Guitarist",
    emoji: "🎸",
    blurb: "You play guitar. Fingerstyle, riffs, the whole thing.",
    personaTag: "a guitarist who can riff, strum, and vibe on cam",
    activityId: "talent-guitar",
    quickActions: [
      { label: "🎸 Play a riff", prompt: "play a catchy guitar riff for chat" },
      { label: "🎶 Jam with chat", prompt: "improvise a short guitar jam based on chat's mood" },
    ],
    pleases: ["hype", "cozy", "lonely"],
    nicheSynergy: ["cozy", "justchatting"],
  },
  {
    id: "comedian",
    label: "Stand-up Comedian",
    emoji: "🎭",
    blurb: "You can work a crowd. Bits, callbacks, crowd work.",
    personaTag: "a quick stand-up comedian with tight bits and good timing",
    activityId: "talent-comedy",
    quickActions: [
      { label: "😂 Do a bit", prompt: "perform a tight stand-up bit for chat" },
      { label: "🎤 Crowd work", prompt: "do crowd work — riff off chat's usernames and messages" },
    ],
    pleases: ["hype", "trolls", "cozy"],
    nicheSynergy: ["variety", "justchatting"],
  },
  {
    id: "analyst",
    label: "Financial Analyst",
    emoji: "📈",
    blurb: "Markets, charts, hot takes. You explain money clearly.",
    personaTag: "a sharp financial analyst who makes markets feel accessible",
    activityId: "talent-finance",
    quickActions: [
      { label: "📊 Chart breakdown", prompt: "walk chat through a chart or market move in plain language" },
      { label: "💡 Hot take", prompt: "give a bold but reasoned financial hot take for chat" },
    ],
    pleases: ["whales", "lonely", "cozy"],
    nicheSynergy: ["justchatting", "variety"],
  },
  {
    id: "dancer",
    label: "Dancer",
    emoji: "💃",
    blurb: "You move well on cam. Hype crowds eat it up.",
    personaTag: "a expressive dancer with clean lines and camera presence",
    activityId: "talent-dance",
    quickActions: [
      { label: "💃 Freestyle", prompt: "freestyle dance to whatever track is playing" },
      { label: "🕺 Learn a move", prompt: "teach chat a simple dance move step by step" },
    ],
    pleases: ["hype", "simps", "whales"],
    nicheSynergy: ["spicy", "variety"],
  },
  {
    id: "artist",
    label: "Visual Artist",
    emoji: "🎨",
    blurb: "Drawing, painting, digital art — you create on cam.",
    personaTag: "a visual artist who sketches and paints with chat watching",
    activityId: "talent-art",
    quickActions: [
      { label: "✏️ Quick sketch", prompt: "do a quick sketch based on a chat prompt" },
      { label: "🖌 Layer colors", prompt: "add color and detail to the piece on cam" },
    ],
    pleases: ["cozy", "lonely", "whales"],
    nicheSynergy: ["cozy", "justchatting"],
  },
  {
    id: "chef",
    label: "Chef",
    emoji: "🍳",
    blurb: "You actually cook. Plating, knife skills, real recipes.",
    personaTag: "a skilled home chef who plates and explains real recipes on cam",
    activityId: "talent-cooking",
    quickActions: [
      { label: "🍳 Plate a dish", prompt: "cook and plate a dish on cam, narrating each step" },
      { label: "🔪 Knife skills", prompt: "show off clean knife work and prep technique for chat" },
    ],
    pleases: ["cozy", "lonely", "whales"],
    nicheSynergy: ["cozy", "variety"],
  },
  {
    id: "fitness",
    label: "Fitness Coach",
    emoji: "🏋️",
    blurb: "Form, reps, and follow-along workouts. You lead the burn.",
    personaTag: "an upbeat fitness coach who leads follow-along workouts with good form cues",
    activityId: "talent-fitness",
    quickActions: [
      { label: "🏋️ Lead a set", prompt: "lead chat through a follow-along workout set" },
      { label: "🧘 Cooldown stretch", prompt: "guide chat through a calm cooldown stretch" },
    ],
    pleases: ["hype", "simps", "lonely"],
    nicheSynergy: ["variety", "spicy"],
  },
  {
    id: "dj",
    label: "DJ / Producer",
    emoji: "🎧",
    blurb: "You mix and produce. Drops, transitions, live sets.",
    personaTag: "a DJ and music producer who mixes live sets and builds beats on cam",
    activityId: "talent-dj",
    quickActions: [
      { label: "🎧 Drop a mix", prompt: "spin a live mix and hype the drop with chat" },
      { label: "🎚️ Build a beat", prompt: "build a beat layer by layer, taking chat suggestions" },
    ],
    pleases: ["hype", "simps", "whales"],
    nicheSynergy: ["variety", "spicy"],
  },
  {
    id: "magician",
    label: "Magician",
    emoji: "🪄",
    blurb: "Card tricks and illusions. Chat tries to catch the move.",
    personaTag: "a close-up magician who performs card tricks and illusions on cam",
    activityId: "talent-magic",
    quickActions: [
      { label: "🪄 Pull a trick", prompt: "perform a close-up magic trick and tease the method" },
      { label: "🃏 Card flourish", prompt: "do a flashy card flourish and dare chat to follow it" },
    ],
    pleases: ["hype", "trolls", "cozy"],
    nicheSynergy: ["variety", "justchatting"],
  },
  {
    id: "voiceactor",
    label: "Voice Actor",
    emoji: "🎙️",
    blurb: "Impressions, character voices, dramatic reads. Range for days.",
    personaTag: "a versatile voice actor with sharp impressions and character voices",
    activityId: "talent-voice",
    quickActions: [
      { label: "🎙️ Do an impression", prompt: "do a spot-on impression chat requests" },
      { label: "📜 Dramatic read", prompt: "dramatically read a chat message in a character voice" },
    ],
    pleases: ["hype", "trolls", "lonely"],
    nicheSynergy: ["justchatting", "variety"],
  },
  {
    id: "cosplayer",
    label: "Cosplayer",
    emoji: "🧵",
    blurb: "Costumes and craft. WIP builds, makeup, and reveals.",
    personaTag: "a dedicated cosplayer who builds costumes and does character makeup on cam",
    activityId: "talent-cosplay",
    quickActions: [
      { label: "🧵 Work the build", prompt: "work on a cosplay build piece and explain the craft" },
      { label: "💄 Character makeup", prompt: "do a character makeup transformation for chat" },
    ],
    pleases: ["simps", "whales", "cozy"],
    nicheSynergy: ["spicy", "variety"],
  },
  {
    id: "chess",
    label: "Chess Player",
    emoji: "♟️",
    blurb: "Tactics, blitz, and teaching. You think out loud.",
    personaTag: "a strong chess player who narrates tactics and plays blitz on cam",
    activityId: "talent-chess",
    quickActions: [
      { label: "♟️ Play blitz", prompt: "play a blitz chess game narrating your thinking" },
      { label: "🧠 Puzzle rush", prompt: "solve a chess puzzle and explain the key idea to chat" },
    ],
    pleases: ["lonely", "cozy", "whales"],
    nicheSynergy: ["justchatting", "gaming"],
  },
];

export const TALENT_BY_ID: Record<string, Talent> = Object.fromEntries(
  TALENTS.map((t) => [t.id, t]),
);

/** Empty string — no stream skill chosen. */
export const NO_TALENT_ID = "";

export const DEFAULT_TALENT_ID = NO_TALENT_ID;

export function talentById(id: string | undefined): Talent | null {
  if (!id) return null;
  return TALENT_BY_ID[id] ?? null;
}

export function randomTalent(): Talent {
  return TALENTS[Math.floor(Math.random() * TALENTS.length)]!;
}

/** Quick actions for the chosen talent (empty if unknown). */
export function talentQuickActions(talentId: string | undefined): LiveQuickAction[] {
  return talentById(talentId)?.quickActions ?? [];
}
