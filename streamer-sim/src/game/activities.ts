/**
 * Activity definitions — the generic sub-state that flavors live beats.
 * Games are one category; performance/creative/chill/intimate activities share
 * the same engine. Started from ActivityPicker; some must be bought in the shop.
 */

import { hasFixedCameraInZone, type PlacedCamera } from "./cameras";
import { isNoLimits, NSFW_BUILD, tierIntensity } from "./content";
import type { NicheId } from "./niches";
import type { SegmentId } from "./segments";
import { ZONES, type ZoneId } from "./studio";
import type { ActivityCategory, ActivityState, ContentTier } from "./types";

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
  /** Hidden and blocked outside dev builds (prod never ships this activity). */
  devOnly?: boolean;
  /** Minimum content-tier intensity to start. */
  minIntensity?: number;
  /** Shop price; omit = free. */
  cost?: number;
  /** Niches this activity synergizes with (shown in shop). */
  nicheSynergy?: NicheId[];
  /** When set, only shown if settings.talent matches (free talent stream mode). */
  talent?: string;
  /** Must be live to start (default true). */
  liveOnly?: boolean;
  /** Fixed camera must be placed in this zone (portable cams do not count). */
  requiredZone?: ZoneId;
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
    narrationHint: "The streamer is playing a spooky indie horror game. Describe jump scares, their reactions, the tense silence between scares, and chat losing their minds.",
    chatHint: "Backseat horror fans: scream for clips, dare them to keep going, react to jump scares, ask 'did you see that?!'",
    hypePerRound: 9,
    energyPerRound: 5,
    cost: 80,
    nicheSynergy: ["gaming", "variety"],
    requiredZone: "desk",
  },
  {
    id: "fps",
    name: "Competitive FPS",
    emoji: "🔫",
    blurb: "Clutch or choke. Gamers and backseaters in heaven.",
    category: "game",
    pleases: ["hype"],
    narrationHint: "The streamer is in a competitive FPS match. Describe clutch plays, whiffs, callouts, and the sweat of ranked.",
    chatHint: "Backseat gamers: call strats, roast missed shots, hype clutches, argue about loadouts.",
    hypePerRound: 8,
    energyPerRound: 6,
    cost: 60,
    nicheSynergy: ["gaming"],
    requiredZone: "desk",
  },
  {
    id: "cozy-farm",
    name: "Cozy Farming Sim",
    emoji: "🌱",
    blurb: "Calm, wholesome, perfect background vibes.",
    category: "game",
    pleases: ["cozy", "lonely"],
    narrationHint: "The streamer is playing a cozy farming sim. Describe peaceful chores, cute animals, and chat vibing in the background.",
    chatHint: "Wholesome chat: name the animals, suggest crops, share cozy memes, keep the vibe soft.",
    hypePerRound: 4,
    energyPerRound: 2,
    cost: 45,
    nicheSynergy: ["cozy", "justchatting"],
    requiredZone: "desk",
  },
  {
    id: "rhythm",
    name: "Rhythm Game",
    emoji: "🎵",
    blurb: "Flashy combos and near-misses. Crowd-pleaser.",
    category: "game",
    pleases: ["hype", "simps"],
    narrationHint: "The streamer is playing a rhythm game. Describe combos, near-misses, full clears, and the crowd going wild.",
    chatHint: "Hype the combos, request songs, react to full clears and near-fails.",
    hypePerRound: 7,
    energyPerRound: 4,
    cost: 50,
    nicheSynergy: ["gaming", "variety"],
    requiredZone: "desk",
  },
  {
    id: "dating-sim",
    name: "Dating Sim",
    emoji: "💌",
    blurb: "Reading spicy routes aloud. Simps eat it up.",
    category: "game",
    pleases: ["simps", "lonely"],
    narrationHint: "The streamer is playing a dating sim and reading routes aloud. Describe route choices, romantic beats, and chat voting on options.",
    chatHint: "Vote on dialogue choices, ship characters, simp over routes, ask them to pick the spicy option.",
    hypePerRound: 6,
    energyPerRound: 3,
    minIntensity: 2,
    cost: 55,
    nicheSynergy: ["justchatting", "spicy"],
    requiredZone: "desk",
  },
  {
    id: "variety-party",
    name: "Party Minigames",
    emoji: "🎲",
    blurb: "Chaotic fun, great for viewer participation.",
    category: "game",
    pleases: ["hype", "cozy"],
    narrationHint: "The streamer is playing chaotic party minigames. Describe silly minigame rounds and chat participation.",
    chatHint: "Cheer for minigame wins, suggest silly challenges, react to chaos.",
    hypePerRound: 6,
    energyPerRound: 4,
    cost: 40,
    nicheSynergy: ["variety", "gaming"],
    requiredZone: "desk",
  },
  // --- non-game activities (free prefills) ---
  {
    id: "read-aloud",
    name: "Read a Book Aloud",
    emoji: "📖",
    blurb: "Story time for chat. Cozy and intimate.",
    category: "performance",
    pleases: ["cozy", "lonely"],
    narrationHint: "The streamer is reading a book aloud to chat. Describe the passage, their voice, and the quiet focus of story time.",
    chatHint: "React to the story, ask what happens next, share favorite lines, stay quiet during tense bits.",
    hypePerRound: 3,
    energyPerRound: 2,
    nicheSynergy: ["cozy", "justchatting"],
    requiredZone: "couch",
  },
  {
    id: "asmr",
    name: "ASMR Session",
    emoji: "🎧",
    blurb: "Soft sounds and whispers. Hypnotic for the lonely crowd.",
    category: "performance",
    pleases: ["cozy", "lonely", "simps"],
    narrationHint: "The streamer is doing an ASMR stream — soft sounds, whispers, tapping. Describe the sensory details.",
    chatHint: "Request triggers, whisper reactions, 'tingles' comments, keep volume low in text.",
    hypePerRound: 4,
    energyPerRound: 2,
    minIntensity: 2,
    nicheSynergy: ["cozy", "justchatting"],
    requiredZone: "desk",
  },
  {
    id: "karaoke",
    name: "Karaoke",
    emoji: "🎤",
    blurb: "Sing for chat. Hype and simps unite.",
    category: "performance",
    pleases: ["hype", "simps", "cozy"],
    narrationHint: "The streamer is singing karaoke on stream. Describe the song, their performance, and chat singing along.",
    chatHint: "Request songs, hype the chorus, roast or praise the high notes.",
    hypePerRound: 7,
    energyPerRound: 4,
    nicheSynergy: ["variety", "justchatting"],
    requiredZone: "desk",
  },
  {
    id: "cook-on-cam",
    name: "Cook on Cam",
    emoji: "🍳",
    blurb: "Make something in the kitchenette while chat watches.",
    category: "creative",
    pleases: ["cozy", "lonely"],
    narrationHint: "The streamer is cooking on cam. Describe sizzling pans, chopping, tasting, and chat hungry comments.",
    chatHint: "Ask for the recipe, drool over smells, suggest ingredients.",
    hypePerRound: 4,
    energyPerRound: 3,
    nicheSynergy: ["cozy", "justchatting"],
    requiredZone: "kitchenette",
  },
  {
    id: "workout",
    name: "Workout on Cam",
    emoji: "💪",
    blurb: "Sweat it out live. Hype crowd loves the grind.",
    category: "performance",
    pleases: ["hype", "simps"],
    narrationHint: "The streamer is working out on cam. Describe reps, breath, sweat, and chat cheering them on.",
    chatHint: "Count reps, hype the set, cheer them on, ask for water breaks.",
    hypePerRound: 6,
    energyPerRound: 5,
    nicheSynergy: ["variety", "spicy"],
    requiredZone: "couch",
  },
  {
    id: "body-paint",
    name: "Body Painting",
    emoji: "🎨",
    blurb: "Art on skin. Bold and visual.",
    category: "creative",
    pleases: ["simps", "whales"],
    narrationHint: "The streamer is doing body painting on stream. Describe colors, brush strokes, and chat watching the art emerge.",
    chatHint: "Suggest designs, hype the reveal, tip for requests.",
    hypePerRound: 5,
    energyPerRound: 3,
    minIntensity: 4,
    nicheSynergy: ["spicy", "justchatting"],
    requiredZone: "bathroom",
  },
  {
    id: "masturbate-on-cam",
    name: "Masturbate on Cam",
    emoji: "🔥",
    blurb: "No Limits only. The intimate stream.",
    category: "intimate",
    pleases: ["simps", "whales", "lonely"],
    narrationHint: "The streamer is masturbating on cam (No Limits). Describe the intimate beat tastefully but explicitly per tier steering.",
    chatHint: "Simps and whales react intensely: encouragement, tips, thirsty comments — per content tier.",
    hypePerRound: 8,
    energyPerRound: 4,
    noLimitsOnly: true,
    devOnly: true,
    minIntensity: 4,
    nicheSynergy: ["spicy"],
    requiredZone: "bed",
  },
  // --- talent-gated stream modes (free; shown only for matching talent) ---
  {
    id: "talent-singing",
    name: "Live Singing",
    emoji: "🎤",
    blurb: "Your signature vocal stream. Chat requests, covers, and chorus moments.",
    category: "performance",
    pleases: ["hype", "simps", "cozy"],
    narrationHint: "The streamer is singing live on stream — describe the song, their voice, the mood, and chat singing along or getting emotional.",
    chatHint: "Request songs, hype the chorus, react to high notes, share lyrics in chat.",
    hypePerRound: 8,
    energyPerRound: 4,
    talent: "singer",
    nicheSynergy: ["variety", "justchatting"],
    requiredZone: "desk",
  },
  {
    id: "talent-guitar",
    name: "Live Guitar",
    emoji: "🎸",
    blurb: "Fingerstyle, riffs, and chill jams. Your instrument, your vibe.",
    category: "performance",
    pleases: ["hype", "cozy", "lonely"],
    narrationHint: "The streamer is playing guitar live — describe the riff, the rhythm, their focus, and chat vibing to the sound.",
    chatHint: "Request songs, hype the riff, ask for an encore, react to the mood.",
    hypePerRound: 7,
    energyPerRound: 4,
    talent: "guitarist",
    nicheSynergy: ["cozy", "justchatting"],
    requiredZone: "couch",
  },
  {
    id: "talent-comedy",
    name: "Stand-up Set",
    emoji: "🎭",
    blurb: "Bits, crowd work, and callbacks. You own the room.",
    category: "performance",
    pleases: ["hype", "trolls", "cozy"],
    narrationHint: "The streamer is doing a stand-up comedy set on stream — describe the bit, the punchline landing, crowd work, and chat losing it.",
    chatHint: "Laugh at the punchlines, suggest topics, roast back gently, ask for an encore bit.",
    hypePerRound: 8,
    energyPerRound: 5,
    talent: "comedian",
    nicheSynergy: ["variety", "justchatting"],
    requiredZone: "couch",
  },
  {
    id: "talent-finance",
    name: "Market Breakdown",
    emoji: "📈",
    blurb: "Charts, trends, and plain-language money talk.",
    category: "creative",
    pleases: ["whales", "lonely", "cozy"],
    narrationHint: "The streamer is doing a financial analysis stream — describe the chart, the thesis, the numbers, and chat asking smart follow-ups.",
    chatHint: "Ask about tickers, challenge their thesis, share portfolio stories, hype a good explanation.",
    hypePerRound: 5,
    energyPerRound: 3,
    talent: "analyst",
    nicheSynergy: ["justchatting", "variety"],
    requiredZone: "desk",
  },
  {
    id: "talent-dance",
    name: "Dance Stream",
    emoji: "💃",
    blurb: "Freestyle, choreography, and camera-ready movement.",
    category: "performance",
    pleases: ["hype", "simps", "whales"],
    narrationHint: "The streamer is dancing on stream — describe the moves, the music, their energy, and chat hyping every drop.",
    chatHint: "Hype the moves, request songs, cheer them on, count the combo.",
    hypePerRound: 8,
    energyPerRound: 5,
    talent: "dancer",
    nicheSynergy: ["spicy", "variety"],
    requiredZone: "couch",
  },
  {
    id: "talent-art",
    name: "Live Art",
    emoji: "🎨",
    blurb: "Sketch, paint, or illustrate while chat watches the piece emerge.",
    category: "creative",
    pleases: ["cozy", "lonely", "whales"],
    narrationHint: "The streamer is creating visual art live — describe the strokes, colors, the piece taking shape, and chat suggesting details.",
    chatHint: "Suggest what to draw next, hype the reveal, ask about technique, tip for requests.",
    hypePerRound: 5,
    energyPerRound: 3,
    talent: "artist",
    nicheSynergy: ["cozy", "justchatting"],
    requiredZone: "desk",
  },
  {
    id: "talent-cooking",
    name: "Chef's Table",
    emoji: "🍳",
    blurb: "Real cooking on cam — prep, plating, and tasting.",
    category: "creative",
    pleases: ["cozy", "lonely", "whales"],
    narrationHint: "The streamer is cooking a real dish on cam — describe prep, sizzling, plating, tasting, and chat getting hungry.",
    chatHint: "Ask for the recipe, suggest ingredients, drool over the plating, request a taste verdict.",
    hypePerRound: 5,
    energyPerRound: 3,
    talent: "chef",
    nicheSynergy: ["cozy", "variety"],
    requiredZone: "kitchenette",
  },
  {
    id: "talent-fitness",
    name: "Follow-Along Workout",
    emoji: "🏋️",
    blurb: "Lead chat through a real workout with form cues.",
    category: "performance",
    pleases: ["hype", "simps", "lonely"],
    narrationHint: "The streamer is leading a follow-along workout — describe the reps, the burn, their form cues, and chat sweating along.",
    chatHint: "Count reps, ask for modifications, hype the last set, beg for a water break.",
    hypePerRound: 6,
    energyPerRound: 6,
    talent: "fitness",
    nicheSynergy: ["variety", "spicy"],
    requiredZone: "couch",
  },
  {
    id: "talent-dj",
    name: "Live DJ Set",
    emoji: "🎧",
    blurb: "Mix tracks and build beats with chat hyping the drops.",
    category: "performance",
    pleases: ["hype", "simps", "whales"],
    narrationHint: "The streamer is spinning a live DJ set — describe the transitions, the build, the drop, and chat going off.",
    chatHint: "Hype the drop, request tracks, rate the transition, vibe in the chat.",
    hypePerRound: 8,
    energyPerRound: 4,
    talent: "dj",
    nicheSynergy: ["variety", "spicy"],
    requiredZone: "desk",
  },
  {
    id: "talent-magic",
    name: "Magic Set",
    emoji: "🪄",
    blurb: "Close-up tricks and illusions; chat tries to catch the method.",
    category: "performance",
    pleases: ["hype", "trolls", "cozy"],
    narrationHint: "The streamer is performing close-up magic — describe the setup, the reveal, the misdirection, and chat losing it.",
    chatHint: "Try to guess the trick, demand a slow-mo replay, hype the reveal, accuse them of editing.",
    hypePerRound: 7,
    energyPerRound: 4,
    talent: "magician",
    nicheSynergy: ["variety", "justchatting"],
    requiredZone: "couch",
  },
  {
    id: "talent-voice",
    name: "Voice Acting",
    emoji: "🎙️",
    blurb: "Impressions, character voices, and dramatic chat reads.",
    category: "performance",
    pleases: ["hype", "trolls", "lonely"],
    narrationHint: "The streamer is doing voice acting — describe the impressions, the character voices, the range, and chat requesting more.",
    chatHint: "Request impressions, throw character prompts, hype the range, roast the misses.",
    hypePerRound: 7,
    energyPerRound: 4,
    talent: "voiceactor",
    nicheSynergy: ["justchatting", "variety"],
    requiredZone: "desk",
  },
  {
    id: "talent-cosplay",
    name: "Cosplay Build",
    emoji: "🧵",
    blurb: "Costume craft and character makeup, building toward a reveal.",
    category: "creative",
    pleases: ["simps", "whales", "cozy"],
    narrationHint: "The streamer is working on a cosplay build — describe the craft, the materials, the makeup, and chat hyping the reveal.",
    chatHint: "Ask about materials, suggest characters, hype the reveal, tip for requests.",
    hypePerRound: 5,
    energyPerRound: 3,
    talent: "cosplayer",
    nicheSynergy: ["spicy", "variety"],
    requiredZone: "desk",
  },
  {
    id: "talent-chess",
    name: "Chess Stream",
    emoji: "♟️",
    blurb: "Blitz games and puzzles with running tactical commentary.",
    category: "game",
    pleases: ["lonely", "cozy", "whales"],
    narrationHint: "The streamer is playing chess live — describe the position, the tactics they spot, the time scramble, and chat backseating.",
    chatHint: "Backseat the moves, call the blunders, argue the opening, hype the checkmate.",
    hypePerRound: 5,
    energyPerRound: 3,
    talent: "chess",
    nicheSynergy: ["justchatting", "gaming"],
    requiredZone: "desk",
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

/** Activity picker section order. */
export const ACTIVITY_CATEGORY_ORDER: ActivityCategory[] = [
  "game",
  "performance",
  "creative",
  "chill",
  "intimate",
];

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
    narrationHint: `The streamer is doing something custom for chat: "${trimmed}". Advance this specific activity beat by beat with concrete sensory detail.`,
    chatHint: `React to them doing: "${trimmed}". Stay in character for this kind of stream content.`,
    roundsPlayed: 0,
    startedClock: clock,
  };
}

/** Purchasable activities (have a cost). */
export function purchasableActivities(): Activity[] {
  return ACTIVITIES.filter((a) => a.cost != null && a.cost > 0);
}

/** Whether an activity should appear in pickers and shop at the current content tier. */
export function activityVisibleAtTier(a: Activity, tier: ContentTier): boolean {
  if (a.devOnly && !NSFW_BUILD) return false;
  if (a.noLimitsOnly && !isNoLimits(tier)) return false;
  if (a.minIntensity != null && tierIntensity(tier) < a.minIntensity) return false;
  return true;
}

/** Whether an activity should appear given tier gates and placed cameras. */
export function activityVisible(
  a: Activity,
  tier: ContentTier,
  cameras: readonly PlacedCamera[],
): boolean {
  if (!activityVisibleAtTier(a, tier)) return false;
  if (a.requiredZone && !hasFixedCameraInZone(cameras, a.requiredZone)) return false;
  return true;
}

/** Short lock reason when a fixed camera is missing from the required zone. */
export function activityCameraLockReason(a: Activity): string | null {
  if (!a.requiredZone) return null;
  const label = ZONES[a.requiredZone]?.label ?? a.requiredZone;
  return `Place a camera at the ${label} first`;
}
