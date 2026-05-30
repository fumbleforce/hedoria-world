import type { Upgrade } from "./types";

/** Catalogue of purchasable upgrades. Effects fold into the live model. */
export const UPGRADES: readonly Upgrade[] = [
  {
    id: "usb-mic",
    name: "USB Condenser Mic",
    category: "gear",
    cost: 120,
    description: "Crisper audio. Viewers stick around longer.",
    effects: { viewerMult: 1.1, hypeMult: 1.05 },
  },
  {
    id: "ring-light",
    name: "Ring Light",
    category: "gear",
    cost: 90,
    description: "Flattering glow. A little more hype per bit.",
    effects: { hypeMult: 1.1 },
  },
  {
    id: "1080p-cam",
    name: "1080p Webcam",
    category: "gear",
    cost: 260,
    description: "Sharp picture pulls a bigger crowd.",
    effects: { viewerMult: 1.25 },
  },
  {
    id: "green-screen",
    name: "Green Screen",
    category: "gear",
    cost: 150,
    description: "Pro look. Donations trend up.",
    effects: { incomeMult: 1.15 },
  },
  {
    id: "gaming-chair",
    name: "Gaming Chair",
    category: "furniture",
    cost: 200,
    description: "Comfier marathons; you wake up happier.",
    effects: { moodPerDay: 4 },
  },
  {
    id: "plant-wall",
    name: "Plant Wall",
    category: "furniture",
    cost: 130,
    description: "Cozy backdrop. Mood + small viewer bump.",
    effects: { moodPerDay: 3, viewerMult: 1.05 },
  },
  {
    id: "soundproofing",
    name: "Acoustic Panels",
    category: "furniture",
    cost: 180,
    description: "Quieter nights, better sleep.",
    effects: { moodPerDay: 3 },
  },
  {
    id: "loft-apartment",
    name: "Move to a Loft",
    category: "apartment",
    cost: 1500,
    description: "More space and prestige — but rent goes up.",
    effects: { viewerMult: 1.3, incomeMult: 1.1, rentPerDay: 25, moodPerDay: 5 },
  },
];

export interface Multipliers {
  viewer: number;
  hype: number;
  income: number;
  moodPerDay: number;
  rentPerDay: number;
}

const BASE_RENT_PER_DAY = 20;

export function multipliersFor(ownedIds: readonly string[]): Multipliers {
  const m: Multipliers = {
    viewer: 1,
    hype: 1,
    income: 1,
    moodPerDay: 0,
    rentPerDay: BASE_RENT_PER_DAY,
  };
  for (const up of UPGRADES) {
    if (!ownedIds.includes(up.id)) continue;
    if (up.effects.viewerMult) m.viewer *= up.effects.viewerMult;
    if (up.effects.hypeMult) m.hype *= up.effects.hypeMult;
    if (up.effects.incomeMult) m.income *= up.effects.incomeMult;
    if (up.effects.moodPerDay) m.moodPerDay += up.effects.moodPerDay;
    if (up.effects.rentPerDay) m.rentPerDay += up.effects.rentPerDay;
  }
  return m;
}
