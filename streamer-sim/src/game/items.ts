import { uid } from "../rng/rng";
import type { VibeId } from "./outfits";
import type { ClothingSlot } from "./wardrobe";

export type ItemCategory = "clothing" | "gift" | "prop" | "misc";

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

/** Shop catalogue entries for purchasable clothing. */
export interface ClothingShopEntry {
  id: string;
  name: string;
  description: string;
  cost: number;
  slot: ClothingSlot;
  vibes: Partial<Record<VibeId, number>>;
}

export const CLOTHING_SHOP: readonly ClothingShopEntry[] = [
  // Tops
  {
    id: "cloth-cozy-hoodie",
    name: "Oversized Hoodie",
    description: "Soft, warm, and very streamable.",
    cost: 45,
    slot: "top",
    vibes: { cozy: 1, casual: 0.5 },
  },
  {
    id: "cloth-cute-blouse",
    name: "Frilly Blouse",
    description: "Sweet, photogenic, a little flirty.",
    cost: 50,
    slot: "top",
    vibes: { cute: 1 },
  },
  {
    id: "cloth-bold-corset",
    name: "Statement Corset Top",
    description: "Eye-catching and bold on cam.",
    cost: 75,
    slot: "top",
    vibes: { bold: 1.5, cute: 0.5 },
  },
  // Bottoms
  {
    id: "cloth-cute-skirt",
    name: "Pleated Mini Skirt",
    description: "Photogenic and playful.",
    cost: 55,
    slot: "bottom",
    vibes: { cute: 1, casual: 0.5 },
  },
  {
    id: "cloth-cozy-joggers",
    name: "Soft Joggers",
    description: "Lounge-stream essential.",
    cost: 35,
    slot: "bottom",
    vibes: { cozy: 1 },
  },
  {
    id: "cloth-bold-leather",
    name: "Faux-Leather Pants",
    description: "Sleek and daring.",
    cost: 80,
    slot: "bottom",
    vibes: { bold: 1 },
  },
  // Underwear
  {
    id: "cloth-cute-lingerie",
    name: "Cute Lingerie Set",
    description: "A matching bra and panties with bows.",
    cost: 60,
    slot: "underwear",
    vibes: { cute: 1 },
  },
  {
    id: "cloth-bold-lace",
    name: "Black Lace Set",
    description: "Daring lace lingerie.",
    cost: 85,
    slot: "underwear",
    vibes: { bold: 1.5 },
  },
  {
    id: "cloth-cozy-comfies",
    name: "Comfy Cotton Set",
    description: "Soft, unfussy everyday underwear.",
    cost: 25,
    slot: "underwear",
    vibes: { cozy: 0.5, casual: 0.5 },
  },
  // Accessories / extras
  {
    id: "cloth-cute-bow",
    name: "Hair Bow Clip",
    description: "A tiny detail that reads cute from a mile away.",
    cost: 25,
    slot: "head",
    vibes: { cute: 1 },
  },
  {
    id: "cloth-cozy-socks",
    name: "Fuzzy Bed Socks",
    description: "Peak cozy energy.",
    cost: 20,
    slot: "feet",
    vibes: { cozy: 1 },
  },
  {
    id: "cloth-bold-heels",
    name: "Platform Heels",
    description: "Bold silhouette, bold energy.",
    cost: 90,
    slot: "feet",
    vibes: { bold: 1 },
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
