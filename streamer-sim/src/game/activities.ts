/**
 * Activity definitions — the generic sub-state that flavors live beats.
 * Games are one category; performance/creative/chill/intimate activities share
 * the same engine. Started from ActivityPicker; some must be bought in the shop.
 */

import type { NicheId } from "./niches";
import type { SegmentId } from "./segments";
import type { ActivityCategory, ActivityState } from "./types";

export type { ActivityCategory };

export interface Activity {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  category: ActivityCategory;
  /** Segments that especially enjoy watching this. */
  pleases: SegmentId[];
  /** Steers the activity-story narration pass each beat. */
  narrationHint: string;
  /** Steers chat bursts while this activity is active. */
  chatHint: string;
  /** Baseline hype per live beat while active. */
  hypePerRound?: number;
  /** Energy drain per live beat while active. */
  energyPerRound?: number;
  /** Requires No Limits / custom content tier. */
  noLimitsOnly?: boolean;
  /** Minimum content-tier intensity to start. */
  minIntensity?: number;
  /** Shop price; omit = free. */
  cost?: number;
  /** Niches this activity synergizes with (shown in shop). */
  nicheSynergy?: NicheId[];
  /** Must be live to start (default true). */
  liveOnly?: boolean;
}

export const ACTIVITIES: Activity[] = [
  // --- games (migrated from games.ts) ---
  {
    id: "horror",
    name: "Spooky Indie Horror",
    emoji: "👻",
    blurb: "Jump scares and screams. Chat lives for your reactions.",
    category: "game",
    pleases: ["hype", "trolls"],
    narrationHint: "She is playing a spooky indie horror game. Describe jump scares, her reactions, the tense silence between scares, and chat losing their minds.",
    chatHint: "Backseat horror fans: scream for clips, dare her to keep going, react to jump scares, ask 'did you see that?!'",
    hypePerRound: 9,
    energyPerRound: 5,
    cost: 80,
    nicheSynergy: ["gaming", "variety"],
  },
  {
    id: "fps",
    name: "Competitive FPS",
    emoji: "🔫",
    blurb: "Clutch or choke. Gamers and backseaters in heaven.",
    category: "game",
    pleases: ["hype"],
    narrationHint: "She is in a competitive FPS match. Describe clutch plays, whiffs, callouts, and the sweat of ranked.",
    chatHint: "Backseat gamers: call strats, roast missed shots, hype clutches, argue about loadouts.",
    hypePerRound: 8,
    energyPerRound: 6,
    cost: 60,
    nicheSynergy: ["gaming"],
  },
  {
    id: "cozy-farm",
    name: "Cozy Farming Sim",
    emoji: "🌱",
    blurb: "Calm, wholesome, perfect background vibes.",
    category: "game",
    pleases: ["cozy", "lonely"],
    narrationHint: "She is playing a cozy farming sim. Describe peaceful chores, cute animals, and chat vibing in the background.",
    chatHint: "Wholesome chat: name the animals, suggest crops, share cozy memes, keep the vibe soft.",
    hypePerRound: 4,
    energyPerRound: 2,
    cost: 45,
    nicheSynergy: ["cozy", "justchatting"],
  },
  {
    id: "rhythm",
    name: "Rhythm Game",
    emoji: "🎵",
    blurb: "Flashy combos and near-misses. Crowd-pleaser.",
    category: "game",
    pleases: ["hype", "simps"],
    narrationHint: "She is playing a rhythm game. Describe combos, near-misses, full clears, and the crowd going wild.",
    chatHint: "Hype the combos, request songs, react to full clears and near-fails.",
    hypePerRound: 7,
    energyPerRound: 4,
    cost: 50,
    nicheSynergy: ["gaming", "variety"],
  },
  {
    id: "dating-sim",
    name: "Dating Sim",
    emoji: "💌",
    blurb: "Reading spicy routes aloud. Simps eat it up.",
    category: "game",
    pleases: ["simps", "lonely"],
    narrationHint: "She is playing a dating sim and reading routes aloud. Describe route choices, romantic beats, and chat voting on options.",
    chatHint: "Vote on dialogue choices, ship characters, simp over routes, ask her to pick the spicy option.",
    hypePerRound: 6,
    energyPerRound: 3,
    minIntensity: 1,
    cost: 55,
    nicheSynergy: ["justchatting", "spicy"],
  },
  {
    id: "variety-party",
    name: "Party Minigames",
    emoji: "🎲",
    blurb: "Chaotic fun, great for viewer participation.",
    category: "game",
    pleases: ["hype", "cozy"],
    narrationHint: "She is playing chaotic party minigames. Describe silly minigame rounds and chat participation.",
    chatHint: "Cheer for minigame wins, suggest silly challenges, react to chaos.",
    hypePerRound: 6,
    energyPerRound: 4,
    cost: 40,
    nicheSynergy: ["variety", "gaming"],
  },
  // --- non-game activities (free prefills) ---
  {
    id: "read-aloud",
    name: "Read a Book Aloud",
    emoji: "📖",
    blurb: "Story time for chat. Cozy and intimate.",
    category: "performance",
    pleases: ["cozy", "lonely"],
    narrationHint: "She is reading a book aloud to chat. Describe the passage, her voice, and the quiet focus of story time.",
    chatHint: "React to the story, ask what happens next, share favorite lines, stay quiet during tense bits.",
    hypePerRound: 3,
    energyPerRound: 2,
    nicheSynergy: ["cozy", "justchatting"],
  },
  {
    id: "asmr",
    name: "ASMR Session",
    emoji: "🎧",
    blurb: "Soft sounds and whispers. Hypnotic for the lonely crowd.",
    category: "performance",
    pleases: ["cozy", "lonely", "simps"],
    narrationHint: "She is doing an ASMR stream — soft sounds, whispers, tapping. Describe the sensory details.",
    chatHint: "Request triggers, whisper reactions, 'tingles' comments, keep volume low in text.",
    hypePerRound: 4,
    energyPerRound: 2,
    nicheSynergy: ["cozy", "justchatting"],
  },
  {
    id: "karaoke",
    name: "Karaoke",
    emoji: "🎤",
    blurb: "Sing for chat. Hype and simps unite.",
    category: "performance",
    pleases: ["hype", "simps", "cozy"],
    narrationHint: "She is singing karaoke on stream. Describe the song, her performance, and chat singing along.",
    chatHint: "Request songs, hype the chorus, roast or praise the high notes.",
    hypePerRound: 7,
    energyPerRound: 4,
    nicheSynergy: ["variety", "justchatting"],
  },
  {
    id: "cook-on-cam",
    name: "Cook on Cam",
    emoji: "🍳",
    blurb: "Make something in the kitchenette while chat watches.",
    category: "creative",
    pleases: ["cozy", "lonely"],
    narrationHint: "She is cooking on cam. Describe sizzling pans, chopping, tasting, and chat hungry comments.",
    chatHint: "Ask for the recipe, drool over smells, suggest ingredients.",
    hypePerRound: 4,
    energyPerRound: 3,
    nicheSynergy: ["cozy", "justchatting"],
  },
  {
    id: "workout",
    name: "Workout on Cam",
    emoji: "💪",
    blurb: "Sweat it out live. Hype crowd loves the grind.",
    category: "performance",
    pleases: ["hype", "simps"],
    narrationHint: "She is working out on cam. Describe reps, breath, sweat, and chat cheering her on.",
    chatHint: "Count reps, hype the set, flirt carefully, ask for water breaks.",
    hypePerRound: 6,
    energyPerRound: 5,
    nicheSynergy: ["variety", "spicy"],
  },
  {
    id: "body-paint",
    name: "Body Painting",
    emoji: "🎨",
    blurb: "Art on skin. Bold and visual.",
    category: "creative",
    pleases: ["simps", "whales"],
    narrationHint: "She is doing body painting on stream. Describe colors, brush strokes, and chat watching the art emerge.",
    chatHint: "Suggest designs, hype the reveal, tip for requests.",
    hypePerRound: 5,
    energyPerRound: 3,
    minIntensity: 2,
    nicheSynergy: ["spicy", "justchatting"],
  },
  {
    id: "masturbate-on-cam",
    name: "Masturbate on Cam",
    emoji: "🔥",
    blurb: "No Limits only. The intimate stream.",
    category: "intimate",
    pleases: ["simps", "whales", "lonely"],
    narrationHint: "She is masturbating on cam (No Limits). Describe the intimate beat tastefully but explicitly per tier steering.",
    chatHint: "Simps and whales react intensely: encouragement, tips, thirsty comments — per content tier.",
    hypePerRound: 8,
    energyPerRound: 4,
    noLimitsOnly: true,
    minIntensity: 4,
    nicheSynergy: ["spicy"],
  },
];

export const ACTIVITY_BY_ID: Record<string, Activity> = Object.fromEntries(
  ACTIVITIES.map((a) => [a.id, a]),
);

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  game: "Games",
  performance: "Performance",
  creative: "Creative",
  chill: "Chill",
  intimate: "Intimate",
};

export function activityStateFrom(def: Activity, clock: number): ActivityState {
  return {
    activityId: def.id,
    label: `${def.emoji} ${def.name}`,
    pleases: [...def.pleases],
    narrationHint: def.narrationHint,
    chatHint: def.chatHint,
    roundsPlayed: 0,
    startedClock: clock,
    category: def.category,
  };
}

export function customActivityState(text: string, clock: number): ActivityState {
  const trimmed = text.trim().slice(0, 120);
  return {
    activityId: "custom",
    label: trimmed.slice(0, 60),
    customText: trimmed,
    pleases: [],
    narrationHint: `She is doing something custom for chat: "${trimmed}". Advance this specific activity beat by beat with concrete sensory detail.`,
    chatHint: `React to her doing: "${trimmed}". Stay in character for this kind of stream content.`,
    roundsPlayed: 0,
    startedClock: clock,
  };
}

/** Purchasable activities (have a cost). */
export function purchasableActivities(): Activity[] {
  return ACTIVITIES.filter((a) => a.cost != null && a.cost > 0);
}
