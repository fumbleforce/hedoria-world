/**
 * Fixed starter-character presets offered during onboarding. Each one fills the
 * streamer identity (name, persona, gender), the visual descriptions used for
 * image generation, and a sensible niche + outfit. Purely data — the onboarding
 * UI applies these to settings + the character visual; nothing here generates
 * images or calls an LLM.
 */

import type { NicheId } from "./niches";
import type { OutfitId } from "./outfits";

export interface CharacterPreset {
  id: string;
  label: string;
  blurb: string;
  name: string;
  gender: string;
  persona: string;
  faceDescription: string;
  bodyDescription: string;
  niche: NicheId;
  outfit: OutfitId;
}

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: "abby",
    label: "Abby — Bubbly Variety",
    blurb: "The classic cozy-energy variety streamer trying to go full-time.",
    name: "Abby",
    gender: "female",
    persona:
      "A bubbly variety streamer in her early 20s trying to make rent and go full-time. Quick-witted, a little shy, warms up to chat.",
    faceDescription:
      "Warm brown eyes, light freckles across her nose, soft natural makeup, warm approachable smile.",
    bodyDescription:
      "Early 20s woman, shoulder-length soft pink hair, petite build, cute bubbly streamer energy.",
    niche: "variety",
    outfit: "cute",
  },
  {
    id: "mina",
    label: "Mina — Cozy Chatter",
    blurb: "Soft-spoken late-night cozy streams; lo-fi, candles, real talk.",
    name: "Mina",
    gender: "female",
    persona:
      "A gentle, soft-spoken cozy streamer in her mid-20s. Late-night lo-fi vibes, candles, and heartfelt conversations. Reads every message and remembers the regulars.",
    faceDescription:
      "Calm hazel eyes, minimal makeup, a few faint freckles, a soft thoughtful half-smile.",
    bodyDescription:
      "Mid-20s woman, long wavy chestnut hair often in a loose bun, average build, oversized cardigan energy.",
    niche: "cozy",
    outfit: "cozy",
  },
  {
    id: "rae",
    label: "Rae — High-Energy Gamer",
    blurb: "Loud, competitive, meme-fluent gaming streamer with a hype crowd.",
    name: "Rae",
    gender: "female",
    persona:
      "A loud, competitive gaming streamer in her early 20s. Trash-talks in good fun, meme-fluent, thrives on hype and clutch moments. Equal parts skill and chaos.",
    faceDescription:
      "Sharp green eyes with winged eyeliner, animated expressive brows, a wide competitive grin.",
    bodyDescription:
      "Early 20s woman, dyed teal undercut, athletic build, gaming jersey and a headset always on.",
    niche: "gaming",
    outfit: "casual",
  },
  {
    id: "jun",
    label: "Jun — Just Chatting",
    blurb: "Charismatic talk-show host energy; storytime, hot takes, debates.",
    name: "Jun",
    gender: "male",
    persona:
      "A charismatic just-chatting streamer in his mid-20s with talk-show host energy. Storytime, hot takes, and good-faith debates. Confident, curious, quick on his feet.",
    faceDescription:
      "Dark friendly eyes, a neat short beard, easy confident smile, expressive eyebrows.",
    bodyDescription:
      "Mid-20s man, short dark tousled hair, lean build, smart-casual button-up with the sleeves rolled.",
    niche: "justchatting",
    outfit: "casual",
  },
  {
    id: "violet",
    label: "Violet — Bold & Flirty",
    blurb: "Confident, teasing, camera-savvy. Plays to the simps and whales.",
    name: "Violet",
    gender: "female",
    persona:
      "A confident, camera-savvy streamer in her mid-20s who leans into bold, flirty banter. Knows exactly how to work a crowd, teases the regulars, and isn't easily flustered.",
    faceDescription:
      "Striking violet-contact eyes, bold red lip, sharp confident smirk, glamorous makeup.",
    bodyDescription:
      "Mid-20s woman, long sleek dark hair with violet tips, curvy hourglass figure, bold fashion sense.",
    niche: "spicy",
    outfit: "bold",
  },
];
