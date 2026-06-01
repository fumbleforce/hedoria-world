import { uid } from "../rng/rng";
import { isNoLimits, tierIntensity } from "./content";
import type { VibeId } from "./outfits";
import type { ContentTier } from "./types";
import type { ClothingSlot } from "./wardrobe";

export type ItemCategory = "clothing" | "gift" | "prop" | "misc";

export const ITEM_CATEGORIES: ItemCategory[] = ["clothing", "gift", "prop", "misc"];

export const ITEM_CATEGORY_LABEL: Record<ItemCategory, string> = {
  clothing: "Clothing",
  gift: "Gifts",
  prop: "Props",
  misc: "Misc",
};

export interface Item {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  generated?: boolean;
  imageId?: string;
  meta?: Record<string, string>;
}

export interface ClothingItem extends Item {
  category: "clothing";
  slot: ClothingSlot;
  vibes: Partial<Record<VibeId, number>>;
}

export function isClothingItem(item: Item): item is ClothingItem {
  return item.category === "clothing" && "slot" in item && "vibes" in item;
}

export function makeItem(
  partial: Omit<Item, "id"> & { id?: string },
): Item {
  return { id: partial.id ?? uid("item"), ...partial };
}

export function makeClothingItem(
  partial: Omit<ClothingItem, "id" | "category"> & { id?: string },
): ClothingItem {
  return {
    id: partial.id ?? uid("item"),
    category: "clothing",
    ...partial,
  };
}

/** Who a shop piece is styled for — filtering only; anyone can buy any piece. */
export type ClothingGender = "female" | "male" | "unisex";

export type ClothingGenderFilter = "all" | ClothingGender;

export type ClothingSlotFilter = "all" | ClothingSlot;

/** Shop catalogue entries for purchasable clothing. */
export interface ClothingShopEntry {
  id: string;
  name: string;
  description: string;
  cost: number;
  slot: ClothingSlot;
  vibes: Partial<Record<VibeId, number>>;
  gender: ClothingGender;
  /** Minimum content tier to buy (underwear → risqué; explicit pieces → No Limits). */
  minTier?: ContentTier;
}

/** True when the player's content tier allows buying this shop piece. */
export function clothingShopUnlocked(entry: ClothingShopEntry, tier: ContentTier): boolean {
  if (!entry.minTier) return true;
  if (entry.minTier === "unhinged") return isNoLimits(tier);
  return tierIntensity(tier) >= tierIntensity(entry.minTier);
}

/** Short lock reason for shop cards. */
export function clothingShopLockReason(entry: ClothingShopEntry): string | null {
  if (!entry.minTier) return null;
  if (entry.minTier === "unhinged") return "No Limits tier required";
  if (entry.minTier === "risque") return "Risqué tier or higher required";
  return "Higher content tier required";
}

/** Gender filter — unisex pieces appear in both men's and women's filters. */
export function matchesClothingGenderFilter(
  entry: ClothingShopEntry,
  filter: ClothingGenderFilter,
): boolean {
  if (filter === "all") return true;
  return entry.gender === filter || entry.gender === "unisex";
}

export function matchesClothingSlotFilter(
  entry: ClothingShopEntry,
  filter: ClothingSlotFilter,
): boolean {
  return filter === "all" || entry.slot === filter;
}

export function filterClothingShop(
  entries: readonly ClothingShopEntry[],
  opts: { gender: ClothingGenderFilter; slot: ClothingSlotFilter; tier: ContentTier },
): ClothingShopEntry[] {
  // Content-tier-locked pieces are hidden entirely — never shown as locked cards.
  return entries.filter(
    (e) =>
      clothingShopUnlocked(e, opts.tier) &&
      matchesClothingGenderFilter(e, opts.gender) &&
      matchesClothingSlotFilter(e, opts.slot),
  );
}

export const CLOTHING_SHOP: readonly ClothingShopEntry[] = [
  // ── Women's tops ──
  {
    id: "cloth-cute-blouse",
    name: "Frilly Blouse",
    description: "Sweet, photogenic, a little flirty.",
    cost: 50,
    slot: "top",
    gender: "female",
    vibes: { cute: 1 },
  },
  {
    id: "cloth-w-wrap-blouse",
    name: "Wrap Blouse",
    description: "Flattering tie waist — polished but approachable.",
    cost: 58,
    slot: "top",
    gender: "female",
    vibes: { cute: 0.5, casual: 0.5 },
  },
  {
    id: "cloth-w-offshoulder-knit",
    name: "Off-Shoulder Knit",
    description: "Soft knit that frames the collarbone on cam.",
    cost: 52,
    slot: "top",
    gender: "female",
    vibes: { cozy: 0.5, cute: 1 },
  },
  {
    id: "cloth-w-cropped-cardigan",
    name: "Cropped Cardigan",
    description: "Layer-friendly and cozy without hiding your fit.",
    cost: 48,
    slot: "top",
    gender: "female",
    vibes: { cozy: 1 },
  },
  {
    id: "cloth-w-silk-cami",
    name: "Silk Camisole",
    description: "Light, glossy, and a little daring under good lighting.",
    cost: 65,
    slot: "top",
    gender: "female",
    vibes: { cute: 0.5, bold: 0.5 },
  },
  {
    id: "cloth-bold-corset",
    name: "Statement Corset Top",
    description: "Eye-catching and bold on cam.",
    cost: 75,
    slot: "top",
    gender: "female",
    vibes: { bold: 1.5, cute: 0.5 },
  },
  {
    id: "cloth-w-turtleneck",
    name: "Ribbed Turtleneck",
    description: "Sleek, smart, and surprisingly photogenic.",
    cost: 44,
    slot: "top",
    gender: "female",
    vibes: { casual: 1, cozy: 0.5 },
  },
  // ── Men's tops ──
  {
    id: "cloth-m-polo",
    name: "Classic Polo",
    description: "Clean collar energy — reads put-together on cam.",
    cost: 42,
    slot: "top",
    gender: "male",
    vibes: { casual: 1 },
  },
  {
    id: "cloth-m-graphic-tee",
    name: "Graphic Band Tee",
    description: "Instant personality. Chat will ask about the band.",
    cost: 38,
    slot: "top",
    gender: "male",
    vibes: { casual: 0.5, bold: 0.5 },
  },
  {
    id: "cloth-m-henley",
    name: "Henley Shirt",
    description: "Cozy long-sleeve with a relaxed neckline.",
    cost: 40,
    slot: "top",
    gender: "male",
    vibes: { cozy: 1, casual: 0.5 },
  },
  {
    id: "cloth-m-oxford",
    name: "Oxford Button-Down",
    description: "Crisp and versatile — smart without trying too hard.",
    cost: 55,
    slot: "top",
    gender: "male",
    vibes: { casual: 1 },
  },
  {
    id: "cloth-m-muscle-tank",
    name: "Muscle Tank",
    description: "Shows the work. Bold without being loud.",
    cost: 32,
    slot: "top",
    gender: "male",
    vibes: { bold: 1, casual: 0.5 },
  },
  {
    id: "cloth-m-flannel",
    name: "Plaid Flannel",
    description: "Lumberjack cozy or grunge depending on how you wear it.",
    cost: 46,
    slot: "top",
    gender: "male",
    vibes: { cozy: 1, casual: 0.5 },
  },
  // ── Unisex tops ──
  {
    id: "cloth-cozy-hoodie",
    name: "Oversized Hoodie",
    description: "Soft, warm, and very streamable.",
    cost: 45,
    slot: "top",
    gender: "unisex",
    vibes: { cozy: 1, casual: 0.5 },
  },
  // ── Women's bottoms ──
  {
    id: "cloth-cute-skirt",
    name: "Pleated Mini Skirt",
    description: "Photogenic and playful.",
    cost: 55,
    slot: "bottom",
    gender: "female",
    vibes: { cute: 1, casual: 0.5 },
  },
  {
    id: "cloth-w-midi-skirt",
    name: "A-Line Midi Skirt",
    description: "Elegant swing — great for sitting streams.",
    cost: 62,
    slot: "bottom",
    gender: "female",
    vibes: { cute: 0.5, casual: 0.5 },
  },
  {
    id: "cloth-w-highwaist-jeans",
    name: "High-Waist Jeans",
    description: "Classic fit that photographs well from the desk angle.",
    cost: 68,
    slot: "bottom",
    gender: "female",
    vibes: { casual: 1 },
  },
  {
    id: "cloth-w-wide-leg",
    name: "Wide-Leg Trousers",
    description: "Flowy silhouette with quiet confidence.",
    cost: 72,
    slot: "bottom",
    gender: "female",
    vibes: { bold: 0.5, casual: 0.5 },
  },
  {
    id: "cloth-w-denim-mini",
    name: "Denim Mini Skirt",
    description: "Casual staple with a flirty edge.",
    cost: 48,
    slot: "bottom",
    gender: "female",
    vibes: { casual: 0.5, cute: 0.5 },
  },
  {
    id: "cloth-w-highwaist-shorts",
    name: "High-Waist Shorts",
    description: "Summer stream essential — legs on display, still cute.",
    cost: 42,
    slot: "bottom",
    gender: "female",
    vibes: { cute: 0.5, casual: 0.5 },
  },
  // ── Men's bottoms ──
  {
    id: "cloth-m-chinos",
    name: "Slim Chinos",
    description: "Smart casual — works for chatting or IRL segments.",
    cost: 58,
    slot: "bottom",
    gender: "male",
    vibes: { casual: 1 },
  },
  {
    id: "cloth-m-cargo",
    name: "Cargo Pants",
    description: "Utility pockets, relaxed fit, streetwear energy.",
    cost: 54,
    slot: "bottom",
    gender: "male",
    vibes: { casual: 0.5, bold: 0.5 },
  },
  {
    id: "cloth-m-gym-shorts",
    name: "Gym Shorts",
    description: "Just-chatting comfort with athletic vibes.",
    cost: 34,
    slot: "bottom",
    gender: "male",
    vibes: { casual: 0.5, bold: 0.5 },
  },
  {
    id: "cloth-m-relaxed-jeans",
    name: "Relaxed-Fit Jeans",
    description: "Broken-in denim that reads effortless.",
    cost: 64,
    slot: "bottom",
    gender: "male",
    vibes: { casual: 1 },
  },
  // ── Unisex bottoms ──
  {
    id: "cloth-cozy-joggers",
    name: "Soft Joggers",
    description: "Lounge-stream essential.",
    cost: 35,
    slot: "bottom",
    gender: "unisex",
    vibes: { cozy: 1 },
  },
  {
    id: "cloth-bold-leather",
    name: "Faux-Leather Pants",
    description: "Sleek and daring.",
    cost: 80,
    slot: "bottom",
    gender: "unisex",
    vibes: { bold: 1 },
  },
  // ── Full outfits ──
  {
    id: "cloth-w-wrap-dress",
    name: "Wrap Dress",
    description: "One piece, instant polish — great for special streams.",
    cost: 88,
    slot: "full",
    gender: "female",
    vibes: { cute: 1, bold: 0.5 },
  },
  {
    id: "cloth-w-sundress",
    name: "Floral Sundress",
    description: "Light, breezy, and very photogenic.",
    cost: 76,
    slot: "full",
    gender: "female",
    vibes: { cute: 0.5, casual: 0.5 },
  },
  // ── Outerwear ──
  {
    id: "cloth-w-trench",
    name: "Trench Coat",
    description: "Statement outer layer — mysterious main-character energy.",
    cost: 120,
    slot: "outer",
    gender: "female",
    vibes: { bold: 1 },
  },
  {
    id: "cloth-w-blazer",
    name: "Cropped Blazer",
    description: "Structured shoulders and a sharp silhouette.",
    cost: 95,
    slot: "outer",
    gender: "female",
    vibes: { bold: 0.5, casual: 0.5 },
  },
  {
    id: "cloth-m-denim-jacket",
    name: "Denim Jacket",
    description: "Timeless layer for casual streams.",
    cost: 78,
    slot: "outer",
    gender: "male",
    vibes: { casual: 1 },
  },
  {
    id: "cloth-m-bomber",
    name: "Bomber Jacket",
    description: "Streetwear staple with bold presence.",
    cost: 92,
    slot: "outer",
    gender: "male",
    vibes: { bold: 1, casual: 0.5 },
  },
  // ── Underwear (risqué+) ──
  {
    id: "cloth-cozy-comfies",
    name: "Comfy Cotton Set",
    description: "Soft, unfussy everyday underwear.",
    cost: 25,
    slot: "underwear",
    gender: "unisex",
    minTier: "risque",
    vibes: { cozy: 0.5, casual: 0.5 },
  },
  {
    id: "cloth-cute-lingerie",
    name: "Cute Lingerie Set",
    description: "A matching bra and panties with bows.",
    cost: 60,
    slot: "underwear",
    gender: "female",
    minTier: "risque",
    vibes: { cute: 1 },
  },
  {
    id: "cloth-bold-lace",
    name: "Black Lace Set",
    description: "Daring lace lingerie.",
    cost: 85,
    slot: "underwear",
    gender: "female",
    minTier: "risque",
    vibes: { bold: 1.5 },
  },
  {
    id: "cloth-m-boxer-briefs",
    name: "Cotton Boxer Briefs Pack",
    description: "Comfortable everyday fit — nothing fancy.",
    cost: 28,
    slot: "underwear",
    gender: "male",
    minTier: "risque",
    vibes: { casual: 0.5 },
  },
  {
    id: "cloth-m-black-briefs",
    name: "Black Boxer Briefs",
    description: "Sleek and minimal.",
    cost: 32,
    slot: "underwear",
    gender: "male",
    minTier: "risque",
    vibes: { bold: 0.5, casual: 0.5 },
  },
  // ── Underwear / revealing (No Limits only) ──
  {
    id: "cloth-nl-micro-bikini",
    name: "Micro Bikini Set",
    description: "Barely there — maximum skin on cam.",
    cost: 55,
    slot: "underwear",
    gender: "female",
    minTier: "unhinged",
    vibes: { bold: 2 },
  },
  {
    id: "cloth-nl-open-cup",
    name: "Open-Cup Lingerie",
    description: "Provocative cutouts — chat will lose it.",
    cost: 95,
    slot: "underwear",
    gender: "female",
    minTier: "unhinged",
    vibes: { bold: 2, cute: 0.5 },
  },
  {
    id: "cloth-nl-sheer-crop",
    name: "Sheer Mesh Crop Top",
    description: "See-through fabric — suggestive even layered.",
    cost: 68,
    slot: "top",
    gender: "female",
    minTier: "unhinged",
    vibes: { bold: 1.5 },
  },
  {
    id: "cloth-nl-harness",
    name: "Leather Chest Harness",
    description: "Strappy, dominant, impossible to ignore.",
    cost: 88,
    slot: "accessory",
    gender: "unisex",
    minTier: "unhinged",
    vibes: { bold: 2 },
  },
  {
    id: "cloth-nl-fishnet-body",
    name: "Fishnet Bodystocking",
    description: "Full-body mesh — wear alone or under everything.",
    cost: 72,
    slot: "full",
    gender: "female",
    minTier: "unhinged",
    vibes: { bold: 2 },
  },
  {
    id: "cloth-nl-cutout-bodysuit",
    name: "Strappy Cut-Out Bodysuit",
    description: "Strategic holes everywhere the camera looks.",
    cost: 98,
    slot: "full",
    gender: "female",
    minTier: "unhinged",
    vibes: { bold: 2, cute: 0.5 },
  },
  {
    id: "cloth-nl-micro-skirt",
    name: "Pleather Micro Skirt",
    description: "Ridiculously short — every movement is content.",
    cost: 58,
    slot: "bottom",
    gender: "female",
    minTier: "unhinged",
    vibes: { bold: 2 },
  },
  // ── Head ──
  {
    id: "cloth-cute-bow",
    name: "Hair Bow Clip",
    description: "A tiny detail that reads cute from a mile away.",
    cost: 25,
    slot: "head",
    gender: "female",
    vibes: { cute: 1 },
  },
  {
    id: "cloth-m-baseball-cap",
    name: "Baseball Cap",
    description: "Casual default — bad hair day approved.",
    cost: 22,
    slot: "head",
    gender: "male",
    vibes: { casual: 0.5 },
  },
  {
    id: "cloth-m-beanie",
    name: "Knit Beanie",
    description: "Cozy headwear for late-night streams.",
    cost: 24,
    slot: "head",
    gender: "unisex",
    vibes: { cozy: 1 },
  },
  {
    id: "cloth-w-beret",
    name: "Wool Beret",
    description: "Artsy, slightly pretentious, very cute.",
    cost: 30,
    slot: "head",
    gender: "female",
    vibes: { cute: 0.5, bold: 0.5 },
  },
  // ── Feet ──
  {
    id: "cloth-cozy-socks",
    name: "Fuzzy Bed Socks",
    description: "Peak cozy energy.",
    cost: 20,
    slot: "feet",
    gender: "unisex",
    vibes: { cozy: 1 },
  },
  {
    id: "cloth-bold-heels",
    name: "Platform Heels",
    description: "Bold silhouette, bold energy.",
    cost: 90,
    slot: "feet",
    gender: "female",
    vibes: { bold: 1 },
  },
  {
    id: "cloth-w-ankle-boots",
    name: "Ankle Booties",
    description: "Polished and a little edgy.",
    cost: 85,
    slot: "feet",
    gender: "female",
    vibes: { bold: 0.5, casual: 0.5 },
  },
  {
    id: "cloth-w-ballet-flats",
    name: "Ballet Flats",
    description: "Soft and feminine — subtle but sweet.",
    cost: 45,
    slot: "feet",
    gender: "female",
    vibes: { cute: 1 },
  },
  {
    id: "cloth-m-sneakers",
    name: "White Sneakers",
    description: "Clean kicks that go with everything.",
    cost: 70,
    slot: "feet",
    gender: "male",
    vibes: { casual: 1 },
  },
  {
    id: "cloth-m-boots",
    name: "Work Boots",
    description: "Rugged, grounded, masculine energy.",
    cost: 95,
    slot: "feet",
    gender: "male",
    vibes: { bold: 0.5, casual: 0.5 },
  },
  // ── Accessories ──
  {
    id: "cloth-w-layered-necklace",
    name: "Layered Necklace",
    description: "Delicate chains that catch the ring light.",
    cost: 35,
    slot: "accessory",
    gender: "female",
    vibes: { cute: 0.5 },
  },
  {
    id: "cloth-w-statement-earrings",
    name: "Statement Earrings",
    description: "Big hoops — frame the face on cam.",
    cost: 38,
    slot: "accessory",
    gender: "female",
    vibes: { bold: 0.5, cute: 0.5 },
  },
  {
    id: "cloth-m-chain",
    name: "Silver Chain",
    description: "Simple neck chain — low-key flex.",
    cost: 40,
    slot: "accessory",
    gender: "male",
    vibes: { bold: 0.5, casual: 0.5 },
  },
];

export const CLOTHING_SHOP_BY_ID = Object.fromEntries(
  CLOTHING_SHOP.map((e) => [e.id, e]),
) as Record<string, ClothingShopEntry>;

export function clothingFromShop(entry: ClothingShopEntry): ClothingItem {
  return makeClothingItem({
    name: entry.name,
    description: entry.description,
    slot: entry.slot,
    vibes: { ...entry.vibes },
    meta: { shopId: entry.id },
  });
}
