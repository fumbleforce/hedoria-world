import type { ChatMessageKind } from "./types";

/** Pool of chatter handles for the mock chat generator + LLM seeding. */
export const HANDLES: readonly string[] = [
  "xX_nightowl_Xx", "pogchampion", "lurkerLarry", "salty_steve", "mike_rowave",
  "definitely_not_a_bot", "ggez_andy", "couchgremlin", "vibe_merchant", "kappa_king",
  "softboi_99", "yourBiggestFan", "anon4127", "the_real_dave", "snackgoblin",
  "moonlight_mara", "404_namenotfound", "captain_chaos", "based_dept", "uwu_destroyer",
  "midnight_dм", "first_time_viewer", "longtime_lurker", "mod_amanda", "tipsy_tom",
  "shadowfan_x", "keyboard_warrior", "the_watcher_22", "doomscroller", "hopeless_simp",
];

export const MOD_HANDLES: readonly string[] = ["mod_amanda", "mod_kev", "TheJanitor"];

/** Message banks keyed by kind. Used by the local mock generator. */
export const LINES: Record<ChatMessageKind, readonly string[]> = {
  normal: [
    "hey what's the plan today",
    "just got here, what'd i miss",
    "this song slaps",
    "lol",
    "real",
    "chat is moving fast today",
    "how's everyone doing",
    "ngl this is comfy",
    "W stream",
    "the lighting looks great today",
  ],
  hype: [
    "LETS GOOOO",
    "POG",
    "best streamer fr",
    "you're so good at this",
    "raid incoming i can feel it",
    "this is peak content",
    "clip that!!",
    "chat we are SO back",
  ],
  question: [
    "what mic do you use?",
    "how long have you been streaming?",
    "are you doing the late stream tonight?",
    "whats your setup?",
    "do you have a discord?",
    "what game next",
  ],
  troll: [
    "mid",
    "ratio",
    "this is kinda boring tbh",
    "do something interesting",
    "L take",
    "touch grass",
    "why is the cam so laggy",
  ],
  flirty: [
    "you look really cute today ngl",
    "marry me",
    "stop being so adorable challenge (impossible)",
    "my heart can't take the wink",
    "ok but the outfit is doing numbers",
    "you're literally my type",
  ],
  creepy: [
    "i know which neighborhood that view is from 👀",
    "do you ever stream alone late at night?",
    "saw you weren't wearing the ring today",
    "i'll be your number one no matter what you say",
    "what's your address i wanna send a 'gift'",
    "do that again. for me.",
    "you can't ignore me forever you know",
  ],
  donation: [
    "keep up the great work!",
    "for the late night snacks 🍜",
    "you deserve this and more",
    "small tip, big fan",
    "buy yourself something nice",
    "",
  ],
  follow: ["", "", ""],
  sub: ["happy to support!", "month 3 lets go", "take my money", ""],
  raid: ["raiding with the squad! <3", "brought the gremlins over", "go follow NOW chat"],
  mod: [
    "be nice in chat please",
    "timed out a weirdo, carry on",
    "reminder: no doxxing, ever",
    "behave, people 😤",
  ],
  system: [],
  streamer: [],
};
