/**
 * Fixed starter-character presets offered during onboarding. Each one fills the
 * streamer identity (name, persona, gender), the visual descriptions used for
 * image generation, and a sensible outfit vibe. Default clothing comes
 * from `starterClothingFor(preset.outfit, preset.gender)` in wardrobe.ts.
 */

import type { CharacterVisual, Settings } from "./types";
import type { Item } from "./items";
import type { OutfitId } from "./outfits";
import { dominantOutfitVibe, type ClothingSlot } from "./wardrobe";

export interface CharacterPreset {
  id: string;
  label: string;
  blurb: string;
  name: string;
  gender: string;
  persona: string;
  faceDescription: string;
  bodyDescription: string;
  outfit: OutfitId;
  talent: string;
}

/** Preset-card gender dot color (onboarding quick-start grid only). */
export type PresetGenderDot = "female" | "male" | "other";

export function presetGenderDot(gender: string): PresetGenderDot {
  if (gender === "female") return "female";
  if (gender === "male") return "male";
  return "other";
}

/** Role line shown under the name on preset cards (from `label`, without the dash). */
export function presetCardRole(p: CharacterPreset): string {
  const sep = " — ";
  const i = p.label.indexOf(sep);
  return i >= 0 ? p.label.slice(i + sep.length) : p.label;
}

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: "abby",
    label: "Abby — Bubbly Variety",
    blurb: "The classic cozy-energy variety streamer trying to go full-time.",
    name: "Abby",
    gender: "female",
    persona:
      "A bubbly variety streamer in her late 20s trying to make rent and go full-time. Quick-witted, a little shy, warms up to chat.",
    faceDescription:
      "Warm brown eyes, light freckles across her nose, soft natural makeup, warm approachable smile.",
    bodyDescription:
      "Late 20s woman, shoulder-length soft pink hair, normal build, cute bubbly streamer energy.",
    outfit: "cute",
    talent: "singer",
  },
  {
    id: "mina",
    label: "Mina — Cozy Chatter",
    blurb: "Soft-spoken late-night cozy streams; lo-fi, candles, real talk.",
    name: "Mina",
    gender: "female",
    persona:
      "A gentle, soft-spoken cozy streamer in her late 20s. Late-night lo-fi vibes, candles, and heartfelt conversations. Reads every message and remembers the regulars.",
    faceDescription:
      "Calm hazel eyes, minimal makeup, a few faint freckles, a soft thoughtful half-smile.",
    bodyDescription:
      "Late 20s woman, long wavy chestnut hair often in a loose bun, average build, calm cozy streamer energy.",
    outfit: "cozy",
    talent: "guitarist",
  },
  {
    id: "rae",
    label: "Rae — High-Energy Gamer",
    blurb: "Loud, competitive, meme-fluent gaming streamer with a hype crowd.",
    name: "Rae",
    gender: "female",
    persona:
      "A loud, competitive gaming streamer in her late 20s. Trash-talks in good fun, meme-fluent, thrives on hype and clutch moments. Equal parts skill and chaos.",
    faceDescription:
      "Sharp green eyes with winged eyeliner, animated expressive brows, a wide competitive grin.",
    bodyDescription:
      "Late 20s woman, dyed teal undercut, athletic build.",
    outfit: "casual",
    talent: "dancer",
  },
  {
    id: "jun",
    label: "Jun — Just Chatting",
    blurb: "Charismatic talk-show host energy; storytime, hot takes, debates.",
    name: "Jun",
    gender: "male",
    persona:
      "A charismatic just-chatting streamer in his late 20s with talk-show host energy. Storytime, hot takes, and good-faith debates. Confident, curious, quick on his feet.",
    faceDescription:
      "Dark friendly eyes, a neat short beard, easy confident smile, expressive eyebrows.",
    bodyDescription:
      "Late 20s man, short dark tousled hair, lean build.",
    outfit: "casual",
    talent: "comedian",
  },
  {
    id: "marcus",
    label: "Marcus — Ranked Grinder",
    blurb: "Sweaty but funny FPS main; comms on, ego checked at the door.",
    name: "Marcus",
    gender: "male",
    persona:
      "A competitive FPS streamer in his late 20s who grinds ranked but keeps chat laughing. Calls every play, roasts himself when he whiffs, and hypes the squad.",
    faceDescription:
      "Intense brown eyes, strong jaw, light stubble, focused grin that breaks into a goofy laugh.",
    bodyDescription:
      "Late 20s man, short fade haircut, athletic build.",
    outfit: "casual",
    talent: "dancer",
  },
  {
    id: "eli",
    label: "Eli — Soft Night Owl",
    blurb: "Gentle art-and-chill streams; watercolor, playlists, quiet company.",
    name: "Eli",
    gender: "male",
    persona:
      "A soft-spoken cozy streamer in his late 20s who paints, listens to lo-fi, and keeps the room calm. Remembers names, validates feelings, never rushes the vibe.",
    faceDescription:
      "Warm gray-blue eyes, soft features, faint smile, a few paint smudges on his cheek sometimes.",
    bodyDescription:
      "Late 20s man, wavy sandy blond hair in a low bun, slim build.",
    outfit: "cozy",
    talent: "artist",
  },
  {
    id: "dante",
    label: "Dante — Gym & Banter",
    blurb: "Confident fitness-and-flirt energy; push-ups, polls, playful ego.",
    name: "Dante",
    gender: "male",
    persona:
      "A bold, camera-comfortable streamer in his late 20s who mixes workout challenges with flirty banter. Teases chat, takes dares, and plays the charming menace.",
    faceDescription:
      "Hazel eyes, defined cheekbones, bright white smile, neatly trimmed beard.",
    bodyDescription:
      "Late 20s man, short curly black hair, muscular lean build.",
    outfit: "bold",
    talent: "dancer",
  },
  {
    id: "owen",
    label: "Owen — Variety Dad Friend",
    blurb: "Wholesome chaos: cooking fails, tier lists, and earnest advice.",
    name: "Owen",
    gender: "male",
    persona:
      "A warm variety streamer in his late 20s with dad-friend energy. Tries new games, ranks snacks, gives surprisingly good life advice, and laughs at his own jokes.",
    faceDescription:
      "Kind green eyes, laugh lines, relaxed half-beard, approachable open smile.",
    bodyDescription:
      "Late 20s man, receding brown hair, dad-bod build.",
    outfit: "casual",
    talent: "comedian",
  },
  {
    id: "kai",
    label: "Kai — Chill Speedrunner",
    blurb: "Laid-back routing nerd; PB attempts, chill chat, no tilt.",
    name: "Kai",
    gender: "male",
    persona:
      "A mellow gaming streamer in his late 20s obsessed with speedruns and clean routes. Explains strats calmly, celebrates PBs quietly, and never yells at RNG.",
    faceDescription:
      "Dark calm eyes behind thin rectangular glasses, relaxed expression, small knowing smirk.",
    bodyDescription:
      "Late 20s man, black hair in a middle part, slim build.",
    outfit: "cozy",
    talent: "analyst",
  },
  {
    id: "alex",
    label: "Alex — Talk Show Host",
    blurb: "Talk-show flow; interviews, hot takes, gentle chaos.",
    name: "Alex",
    gender: "nonbinary",
    persona:
      "A charismatic nonbinary streamer in their late 20s with talk-show host energy. Hosts debates, reads donations with flair, and keeps the room inclusive.",
    faceDescription:
      "Expressive amber eyes, sharp cheekbones, subtle eyeliner, confident half-smile.",
    bodyDescription:
      "Late 20s nonbinary streamer, platinum buzz cut, lean build.",
    outfit: "bold",
    talent: "comedian",
  },
  {
    id: "sam",
    label: "Sam — Creative Misfit",
    blurb: "Art, cosplay WIPs, and weird side quests — cozy but unhinged.",
    name: "Sam",
    gender: "nonbinary",
    persona:
      "A playful nonbinary variety streamer in their late 20s who streams art, cosplay progress, and odd creative challenges. Chaotic good, meme-literate, fiercely kind to regulars.",
    faceDescription:
      "Bright hazel eyes, freckles, asymmetrical undercut with a teal streak, mischievous grin.",
    bodyDescription:
      "Late 20s nonbinary streamer, medium height, asymmetrical undercut with a teal streak.",
    outfit: "cute",
    talent: "artist",
  },
  {
    id: "violet",
    label: "Violet — Bold & Flirty",
    blurb: "Confident, teasing, camera-savvy. Plays to the simps and whales.",
    name: "Violet",
    gender: "female",
    persona:
      "A confident, camera-savvy streamer in her late 20s who leans into bold, flirty banter. Knows exactly how to work a crowd, teases the regulars, and isn't easily flustered.",
    faceDescription:
      "Striking violet-contact eyes, bold red lip, sharp confident smirk, glamorous makeup.",
    bodyDescription:
      "Late 20s woman, long sleek dark hair with violet tips, curvy hourglass figure.",
    outfit: "bold",
    talent: "singer",
  },
];

/** True when settings + character visual still match a preset exactly. */
export function characterPresetMatches(
  preset: CharacterPreset,
  settings: Pick<Settings, "streamerName" | "gender" | "streamerPersona" | "talent">,
  character: Pick<CharacterVisual, "faceDescription" | "bodyDescription">,
  equipped: Partial<Record<ClothingSlot, string>>,
  inventory: readonly Item[],
): boolean {
  return (
    preset.name === settings.streamerName &&
    preset.gender === settings.gender &&
    preset.persona === settings.streamerPersona &&
    preset.outfit === dominantOutfitVibe(equipped, inventory) &&
    preset.talent === settings.talent &&
    preset.faceDescription === character.faceDescription &&
    preset.bodyDescription === character.bodyDescription
  );
}

export function matchingCharacterPresetId(
  settings: Pick<Settings, "streamerName" | "gender" | "streamerPersona" | "talent">,
  character: Pick<CharacterVisual, "faceDescription" | "bodyDescription">,
  equipped: Partial<Record<ClothingSlot, string>>,
  inventory: readonly Item[],
): string | null {
  return CHARACTER_PRESETS.find((p) => characterPresetMatches(p, settings, character, equipped, inventory))?.id ?? null;
}
