import type { Upgrade, UpgradeCategory } from "./types";

export const UPGRADE_CATEGORIES: UpgradeCategory[] = ["gear", "furniture", "apartment"];

export const UPGRADE_CATEGORY_LABEL: Record<UpgradeCategory, string> = {
  gear: "Gear",
  furniture: "Furniture",
  apartment: "Apartment",
};
import { SEGMENTS, type SegmentId } from "./segments";
import { BALANCE, type BalanceConfig } from "./balance";
import { LEGACY_CAM_UPGRADE_IDS } from "./cameras";

/** True when an upgrade is décor (furniture with targeted segment appeal). */
export function isDecoration(up: Upgrade): boolean {
  return up.category === "furniture" && !!up.effects.segmentAppeal && Object.keys(up.effects.segmentAppeal).length > 0;
}

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
    id: "studio-lighting",
    name: "Studio Lighting Kit",
    category: "gear",
    cost: 320,
    description: "Polished, professional glow — raises the whole ceiling.",
    effects: { hypeMult: 1.08, productionQuality: 1 },
  },
  {
    id: "lava-lamp",
    name: "Lava Lamp & Plush Rug",
    category: "furniture",
    cost: 110,
    description: "Soft, dreamy corner. Draws and delights the cozy crowd.",
    decorPrompt: "A groovy lava lamp glowing pink and purple beside a small plush shag rug, cozy streamer décor.",
    effects: { segmentAppeal: { cozy: 2, lonely: 1 } },
  },
  {
    id: "neon-arcade",
    name: "Neon Arcade Signs",
    category: "furniture",
    cost: 160,
    description: "Loud, electric backdrop the hype beasts love.",
    decorPrompt: "Neon arcade-style wall signs in electric cyan and magenta, retro gaming streamer backdrop.",
    effects: { segmentAppeal: { hype: 2, trolls: 1 } },
  },
  {
    id: "premium-backdrop",
    name: "Premium Velvet Backdrop",
    category: "furniture",
    cost: 420,
    description: "Exclusive, high-end vibe that flatters the whales.",
    decorPrompt: "A rich deep-purple velvet backdrop curtain with soft studio lighting, premium streamer set.",
    effects: { segmentAppeal: { whales: 2 }, incomeMult: 1.05 },
  },
  {
    id: "rgb-led-strip",
    name: "RGB LED Strip Kit",
    category: "furniture",
    cost: 95,
    description: "Pulsing color behind the desk. Gamers and hype beasts feel at home.",
    decorPrompt: "RGB LED light strips mounted behind a desk, cycling purple and blue, gamer streamer vibe.",
    effects: { segmentAppeal: { hype: 2 } },
  },
  {
    id: "velvet-throw",
    name: "Velvet Throw & Fairy Lights",
    category: "furniture",
    cost: 85,
    description: "Soft, flirty corner energy. Simps and cozy viewers linger.",
    decorPrompt: "A blush-pink velvet throw blanket draped on a couch with warm fairy lights, intimate cozy décor.",
    effects: { segmentAppeal: { simps: 2, cozy: 1 } },
  },
  {
    id: "gold-framed-art",
    name: "Gold-Framed Wall Art",
    category: "furniture",
    cost: 280,
    description: "Statement piece that signals taste — whales notice.",
    decorPrompt: "Large gold-framed abstract wall art in jewel tones, upscale streamer apartment décor.",
    effects: { segmentAppeal: { whales: 1, cozy: 1 } },
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
    effects: { comfortPerDay: 4 },
  },
  {
    id: "plant-wall",
    name: "Plant Wall",
    category: "furniture",
    cost: 130,
    description: "Cozy backdrop. Comfort + small viewer bump.",
    effects: { comfortPerDay: 3, viewerMult: 1.05 },
  },
  {
    id: "soundproofing",
    name: "Acoustic Panels",
    category: "furniture",
    cost: 180,
    description: "Quieter nights, better sleep.",
    effects: { comfortPerDay: 3 },
  },
  {
    id: "loft-apartment",
    name: "Move to a Loft",
    category: "apartment",
    cost: 1500,
    description: "More space and prestige — but rent goes up.",
    effects: { viewerMult: 1.3, incomeMult: 1.1, rentPerDay: 25, comfortPerDay: 5 },
  },
];

export interface Multipliers {
  viewer: number;
  hype: number;
  income: number;
  comfortPerDay: number;
  rentPerDay: number;
  /** Summed global production quality (lifts appeal for all segments). */
  productionQuality: number;
  /** Summed targeted baseline appeal per segment from owned décor. */
  segmentAppeal: Partial<Record<SegmentId, number>>;
}


export function multipliersFor(ownedIds: readonly string[], balance: BalanceConfig = BALANCE): Multipliers {
  const m: Multipliers = {
    viewer: 1,
    hype: 1,
    income: 1,
    comfortPerDay: 0,
    rentPerDay: balance.economy.rentBase,
    productionQuality: 0,
    segmentAppeal: {},
  };
  for (const up of UPGRADES) {
    if (!ownedIds.includes(up.id)) continue;
    // Legacy camera upgrades migrated to the placeable camera system — skip their stats.
    if (LEGACY_CAM_UPGRADE_IDS.has(up.id)) continue;
    if (up.effects.viewerMult) m.viewer *= up.effects.viewerMult;
    if (up.effects.hypeMult) m.hype *= up.effects.hypeMult;
    if (up.effects.incomeMult) m.income *= up.effects.incomeMult;
    if (up.effects.comfortPerDay) m.comfortPerDay += up.effects.comfortPerDay;
    if (up.effects.rentPerDay) m.rentPerDay += up.effects.rentPerDay;
    if (up.effects.productionQuality) m.productionQuality += up.effects.productionQuality;
    if (up.effects.segmentAppeal) {
      for (const [seg, v] of Object.entries(up.effects.segmentAppeal) as [SegmentId, number][]) {
        m.segmentAppeal[seg] = (m.segmentAppeal[seg] ?? 0) + v;
      }
    }
  }
  return m;
}

/** Human-readable stat lines for one upgrade's effects (inventory / shop detail). */
export function formatUpgradeEffects(effects: Upgrade["effects"]): string[] {
  const lines: string[] = [];
  if (effects.viewerMult && effects.viewerMult !== 1) {
    const pct = Math.round((effects.viewerMult - 1) * 100);
    lines.push(`${pct >= 0 ? "+" : ""}${pct}% viewers`);
  }
  if (effects.hypeMult && effects.hypeMult !== 1) {
    const pct = Math.round((effects.hypeMult - 1) * 100);
    lines.push(`${pct >= 0 ? "+" : ""}${pct}% hype`);
  }
  if (effects.incomeMult && effects.incomeMult !== 1) {
    const pct = Math.round((effects.incomeMult - 1) * 100);
    lines.push(`${pct >= 0 ? "+" : ""}${pct}% income`);
  }
  if (effects.comfortPerDay) lines.push(`+${effects.comfortPerDay} comfort/day`);
  if (effects.rentPerDay) lines.push(`+$${effects.rentPerDay} rent/day`);
  if (effects.productionQuality) {
    lines.push(`+${effects.productionQuality} production quality`);
  }
  if (effects.segmentAppeal) {
    for (const [seg, v] of Object.entries(effects.segmentAppeal) as [SegmentId, number][]) {
      if (v) lines.push(`+${v} ${SEGMENTS[seg].label} appeal`);
    }
  }
  return lines;
}

/** Combined passive bonuses from everything you own. */
export function formatMultipliersSummary(m: Multipliers): string[] {
  const lines: string[] = [];
  if (m.viewer !== 1) lines.push(`Viewers ×${m.viewer.toFixed(2)}`);
  if (m.hype !== 1) lines.push(`Hype ×${m.hype.toFixed(2)}`);
  if (m.income !== 1) lines.push(`Income ×${m.income.toFixed(2)}`);
  if (m.comfortPerDay) lines.push(`Comfort +${m.comfortPerDay}/day`);
  lines.push(`Rent $${m.rentPerDay}/day`);
  if (m.productionQuality) lines.push(`Production quality +${m.productionQuality}`);
  for (const [seg, v] of Object.entries(m.segmentAppeal) as [SegmentId, number][]) {
    if (v) lines.push(`${SEGMENTS[seg].label} appeal +${v}`);
  }
  return lines;
}

/** Décor upgrades shown in the shop with visualize buttons. */
export function decorationUpgrades(): Upgrade[] {
  return UPGRADES.filter(isDecoration);
}
