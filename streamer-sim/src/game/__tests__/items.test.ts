import { describe, expect, it } from "vitest";
import {
  CLOTHING_SHOP,
  clothingShopLockReason,
  clothingShopUnlocked,
  filterClothingShop,
  matchesClothingGenderFilter,
} from "../items";

describe("clothing shop", () => {
  it("every catalogue entry has gender", () => {
    expect(CLOTHING_SHOP.every((e) => e.gender)).toBe(true);
  });

  it("underwear requires risqué tier or higher", () => {
    const underwear = CLOTHING_SHOP.filter((e) => e.slot === "underwear" && e.minTier !== "unhinged");
    expect(underwear.length).toBeGreaterThan(0);
    for (const piece of underwear) {
      expect(piece.minTier).toBe("risque");
      expect(clothingShopUnlocked(piece, "wholesome")).toBe(false);
      expect(clothingShopUnlocked(piece, "cheeky")).toBe(false);
      expect(clothingShopUnlocked(piece, "risque")).toBe(true);
      expect(clothingShopUnlocked(piece, "unhinged")).toBe(true);
    }
  });

  it("explicit pieces require No Limits tier", () => {
    const explicit = CLOTHING_SHOP.filter((e) => e.minTier === "unhinged");
    expect(explicit.length).toBeGreaterThan(0);
    for (const piece of explicit) {
      expect(clothingShopUnlocked(piece, "risque")).toBe(false);
      expect(clothingShopUnlocked(piece, "unhinged")).toBe(true);
      expect(clothingShopUnlocked(piece, "custom")).toBe(true);
      expect(clothingShopLockReason(piece)).toBe("No Limits tier required");
    }
  });

  it("gender filter is cosmetic — unisex appears in men's and women's filters", () => {
    const hoodie = CLOTHING_SHOP.find((e) => e.id === "cloth-cozy-hoodie")!;
    expect(matchesClothingGenderFilter(hoodie, "female")).toBe(true);
    expect(matchesClothingGenderFilter(hoodie, "male")).toBe(true);
    expect(matchesClothingGenderFilter(hoodie, "unisex")).toBe(true);

    const polo = CLOTHING_SHOP.find((e) => e.id === "cloth-m-polo")!;
    expect(matchesClothingGenderFilter(polo, "male")).toBe(true);
    expect(matchesClothingGenderFilter(polo, "female")).toBe(false);
  });

  it("filterClothingShop combines gender and slot filters", () => {
    const menTops = filterClothingShop(CLOTHING_SHOP, { gender: "male", slot: "top", tier: "wholesome" });
    expect(menTops.every((e) => e.slot === "top")).toBe(true);
    expect(menTops.every((e) => e.gender === "male" || e.gender === "unisex")).toBe(true);
    expect(menTops.some((e) => e.id === "cloth-m-polo")).toBe(true);
    expect(menTops.some((e) => e.id === "cloth-cute-blouse")).toBe(false);
  });

  it("filterClothingShop hides content-tier-locked pieces entirely", () => {
    const all = filterClothingShop(CLOTHING_SHOP, { gender: "all", slot: "all", tier: "wholesome" });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => !e.minTier)).toBe(true);
    expect(all.some((e) => e.slot === "underwear")).toBe(false);

    const risque = filterClothingShop(CLOTHING_SHOP, { gender: "all", slot: "all", tier: "risque" });
    expect(risque.some((e) => e.minTier === "risque")).toBe(true);
    expect(risque.some((e) => e.minTier === "unhinged")).toBe(false);
  });

  it("includes men's and women's catalogue pieces", () => {
    expect(CLOTHING_SHOP.some((e) => e.gender === "male")).toBe(true);
    expect(CLOTHING_SHOP.some((e) => e.gender === "female")).toBe(true);
    expect(CLOTHING_SHOP.filter((e) => e.gender === "male").length).toBeGreaterThanOrEqual(10);
    expect(CLOTHING_SHOP.filter((e) => e.gender === "female").length).toBeGreaterThanOrEqual(15);
  });
});
