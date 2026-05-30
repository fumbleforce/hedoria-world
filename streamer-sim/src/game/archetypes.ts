/**
 * The ~20 chatter archetypes. The "masses" are bucketed into these; every named
 * character is also seeded from one. Each archetype maps to one economic segment
 * (see segments.ts) so the spine math still applies, while archetypes give finer
 * personality, naming flavor, and chat voice.
 */

import type { SegmentId } from "./segments";

export interface Archetype {
  id: string;
  label: string;
  /** Which economic segment this archetype feeds. */
  segment: SegmentId;
  /** One-line personality used in prompts + tooltips. */
  blurb: string;
  /** Handle-name fragments for procedural handles. */
  nameParts: string[];
  /** Sample chat lines for offline generation. */
  lines: string[];
  /** Minimum content intensity for this archetype to appear. */
  minIntensity: number;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: "hype-fan", label: "Hype Fan", segment: "hype",
    blurb: "Pure energy. Spams caps and emotes on every good moment.",
    nameParts: ["pog", "hype", "based", "letsgo", "champ"],
    lines: ["LETS GOOO", "POG", "W stream", "clip that!!", "chat we are SO back"],
    minIntensity: 0,
  },
  {
    id: "backseat", label: "Backseater", segment: "hype",
    blurb: "Always knows a better way to do it. Means well, mostly.",
    nameParts: ["coach", "tips", "actually", "wellactually", "pro"],
    lines: ["you should try the other way", "actually if you—", "trust me on this one", "no no go left"],
    minIntensity: 0,
  },
  {
    id: "lurker", label: "Lurker", segment: "cozy",
    blurb: "Watches quietly for hours. Rarely speaks; it's a big deal when they do.",
    nameParts: ["lurk", "ghost", "shadow", "quiet", "longtime"],
    lines: ["been lurking, love the vibe", "first message in months lol", "o/", "hi (lurking again)"],
    minIntensity: 0,
  },
  {
    id: "cozy-regular", label: "Cozy Regular", segment: "cozy",
    blurb: "Here for the calm. Knows the schedule, brings good vibes.",
    nameParts: ["cozy", "comfy", "tea", "blanket", "soft"],
    lines: ["this is so comfy", "perfect background for studying", "love these chill streams", "tea brewed, ready"],
    minIntensity: 0,
  },
  {
    id: "curious", label: "Curious Newbie", segment: "cozy",
    blurb: "First-timer asking how everything works.",
    nameParts: ["new", "firsttime", "justfound", "noob", "hello"],
    lines: ["first time here, what's the game?", "how long have you streamed?", "do you have a schedule?", "what mic is that?"],
    minIntensity: 0,
  },
  {
    id: "softboy", label: "Soft Admirer", segment: "lonely",
    blurb: "Sweet, a little awkward, clearly smitten and over-shares.",
    nameParts: ["soft", "shy", "quiet", "yourfan", "biggest"],
    lines: ["you're so easy to talk to", "made my whole day better", "i look forward to this all week", "you're really kind"],
    minIntensity: 0,
  },
  {
    id: "parasocial", label: "Parasocial Heart", segment: "lonely",
    blurb: "Treats the stream as a real friendship. Warm but a bit much.",
    nameParts: ["forever", "always", "number1", "devoted", "yours"],
    lines: ["you're my best friend honestly", "i tell my coworkers about you", "do you remember me from last week?", "we have such a connection"],
    minIntensity: 0,
  },
  {
    id: "simp", label: "Simp", segment: "simps",
    blurb: "Tips for attention and flirts openly. PG-13.",
    nameParts: ["simp", "smitten", "yourking", "devoted", "captain"],
    lines: ["marry me", "you look amazing today", "take my money", "the wink got me"],
    minIntensity: 1,
  },
  {
    id: "flirt", label: "Flirt", segment: "simps",
    blurb: "Smooth-talker, always pushing the banter a little further.",
    nameParts: ["smooth", "charm", "casanova", "slick", "honey"],
    lines: ["come on, just for me?", "you know you like the attention 😏", "dangerous smile today", "ok that was cute"],
    minIntensity: 1,
  },
  {
    id: "whale", label: "Whale", segment: "whales",
    blurb: "Big spender. Tips huge, expects to be acknowledged by name.",
    nameParts: ["king", "boss", "vip", "patron", "mr"],
    lines: ["here's a little something", "treat yourself", "you've earned it", "say my name and it's doubled"],
    minIntensity: 0,
  },
  {
    id: "troll", label: "Troll", segment: "trolls",
    blurb: "Here to get a rise. Mid-tier bait, mostly harmless.",
    nameParts: ["troll", "ratio", "mid", "salty", "hater"],
    lines: ["mid", "ratio", "this is kinda boring", "L take", "do something interesting"],
    minIntensity: 0,
  },
  {
    id: "edgelord", label: "Edgelord", segment: "trolls",
    blurb: "Says provocative things for shock. Tests boundaries.",
    nameParts: ["edge", "chaos", "anon", "void", "doomer"],
    lines: ["say something controversial", "do a dare", "bet you won't", "spice it up coward"],
    minIntensity: 1,
  },
  {
    id: "memer", label: "Memer", segment: "hype",
    blurb: "Communicates entirely in references and copypasta.",
    nameParts: ["meme", "kappa", "copium", "deluxe", "certified"],
    lines: ["certified hood classic", "he's literally me", "copium", "🗿", "based and stream-pilled"],
    minIntensity: 0,
  },
  {
    id: "mod", label: "Moderator", segment: "cozy",
    blurb: "Keeps the peace. Loyal, protective, dry humor.",
    nameParts: ["mod", "janitor", "warden", "keeper", "guard"],
    lines: ["timed out a weirdo, carry on", "behave, people 😤", "no doxxing, ever", "reminder: be kind"],
    minIntensity: 0,
  },
  {
    id: "donator", label: "Generous Regular", segment: "lonely",
    blurb: "Not rich, but tips what they can. Genuinely supportive.",
    nameParts: ["kind", "support", "fan", "buddy", "pal"],
    lines: ["small tip, big fan", "for the late-night snacks", "you deserve this", "keep going!"],
    minIntensity: 0,
  },
  {
    id: "gamer", label: "Gamer Peer", segment: "hype",
    blurb: "Talks shop about games and setups, wants co-op.",
    nameParts: ["gg", "noscope", "frag", "respawn", "clutch"],
    lines: ["what's your rank?", "we should duo", "that was clean", "rematch when?"],
    minIntensity: 0,
  },
  {
    id: "critic", label: "Critic", segment: "trolls",
    blurb: "Withholds approval, doles out 'constructive' feedback.",
    nameParts: ["critic", "review", "notes", "honest", "real"],
    lines: ["the audio's a little off", "pacing was better last week", "not your best bit", "needs work but ok"],
    minIntensity: 0,
  },
  {
    id: "hype-mom", label: "Wholesome Elder", segment: "cozy",
    blurb: "Older viewer who treats you like family. Endearing.",
    nameParts: ["auntie", "grandma", "papa", "mama", "elder"],
    lines: ["eat something, dear", "so proud of you", "you remind me of my niece", "don't stay up too late"],
    minIntensity: 0,
  },
  {
    id: "creep", label: "Creep", segment: "stalkers",
    blurb: "Boundary-pusher who gets too personal, too specific.",
    nameParts: ["watcher", "shadow", "midnight", "thelast", "nameless"],
    lines: ["do you ever stream alone late?", "i saw what you wore yesterday", "you can't ignore me forever", "do that again. for me."],
    minIntensity: 2,
  },
  {
    id: "stalker", label: "Stalker", segment: "stalkers",
    blurb: "Knows things they shouldn't. The dark end of parasocial.",
    nameParts: ["always", "closer", "outside", "yourshadow", "no404"],
    lines: ["nice neighborhood 👀", "i'll bring it to you in person", "i know your schedule", "we're meant to be"],
    minIntensity: 2,
  },
];

export const ARCHETYPE_BY_ID: Record<string, Archetype> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.id, a]),
);

export function archetypesForSegment(segment: SegmentId): Archetype[] {
  return ARCHETYPES.filter((a) => a.segment === segment);
}
