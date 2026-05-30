/**
 * Mini-game definitions. Picking "Start a game" at the desk enters a gaming
 * sub-state: the streamer is playing `gameId`, and actions are flavored by it
 * until they stop. Lightweight — the game mostly shapes narration + which
 * segments are pleased.
 */

import type { SegmentId } from "./segments";

export interface MiniGame {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  /** Segments that especially enjoy watching this. */
  pleases: SegmentId[];
  /** Baseline hype while playing. */
  hypePerRound: number;
  /** Energy drain per round of play. */
  energyPerRound: number;
}

export const MINI_GAMES: MiniGame[] = [
  {
    id: "horror",
    name: "Spooky Indie Horror",
    emoji: "👻",
    blurb: "Jump scares and screams. Chat lives for your reactions.",
    pleases: ["hype", "trolls"],
    hypePerRound: 9,
    energyPerRound: 5,
  },
  {
    id: "fps",
    name: "Competitive FPS",
    emoji: "🔫",
    blurb: "Clutch or choke. Gamers and backseaters in heaven.",
    pleases: ["hype"],
    hypePerRound: 8,
    energyPerRound: 6,
  },
  {
    id: "cozy-farm",
    name: "Cozy Farming Sim",
    emoji: "🌱",
    blurb: "Calm, wholesome, perfect background vibes.",
    pleases: ["cozy", "lonely"],
    hypePerRound: 4,
    energyPerRound: 2,
  },
  {
    id: "rhythm",
    name: "Rhythm Game",
    emoji: "🎵",
    blurb: "Flashy combos and near-misses. Crowd-pleaser.",
    pleases: ["hype", "simps"],
    hypePerRound: 7,
    energyPerRound: 4,
  },
  {
    id: "dating-sim",
    name: "Dating Sim",
    emoji: "💌",
    blurb: "Reading spicy routes aloud. Simps eat it up.",
    pleases: ["simps", "lonely"],
    hypePerRound: 6,
    energyPerRound: 3,
  },
  {
    id: "variety-party",
    name: "Party Minigames",
    emoji: "🎲",
    blurb: "Chaotic fun, great for viewer participation.",
    pleases: ["hype", "cozy"],
    hypePerRound: 6,
    energyPerRound: 4,
  },
];

export const GAME_BY_ID: Record<string, MiniGame> = Object.fromEntries(
  MINI_GAMES.map((g) => [g.id, g]),
);
