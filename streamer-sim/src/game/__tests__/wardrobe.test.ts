import { describe, expect, it } from "vitest";
import { makeClothingItem } from "../items";
import {
  wardrobeAppeal,
  dominantOutfitVibe,
  starterClothingFor,
  starterClothingForOutfit,
  starterClothingForGender,
  isLegacyStarterWardrobe,
  describeEquippedLook,
  underwearVisibleAtTier,
} from "../wardrobe";
import { genderMode } from "../gender";

describe("wardrobe", () => {
  it("starter set is real garments: underwear + top + bottom", () => {
    const { items, equipped } = starterClothingForOutfit("cute");
    const slots = items.map((i) => i.slot).sort();
    expect(slots).toEqual(["bottom", "top", "underwear"]);
    expect(equipped.top).toBeTruthy();
    expect(equipped.bottom).toBeTruthy();
    expect(equipped.underwear).toBeTruthy();
    expect(items.every((i) => i.slot !== "full")).toBe(true);
  });

  it("detects the obsolete single full-outfit starter as legacy", () => {
    const legacy = [
      makeClothingItem({ name: "Cute Starter", description: "x", slot: "full", vibes: { cute: 2 } }),
    ];
    expect(isLegacyStarterWardrobe(legacy)).toBe(true);
    const real = starterClothingForOutfit("cozy").items;
    expect(isLegacyStarterWardrobe(real)).toBe(false);
  });

  it("describeEquippedLook always lists core slots with explicit nothing", () => {
    const jeans = makeClothingItem({ name: "Jeans", description: "x", slot: "bottom", vibes: { casual: 1 } });
    expect(describeEquippedLook({}, [])).toBe("underwear: nothing, top: nothing, bottom: nothing");
    expect(describeEquippedLook({ bottom: jeans.id }, [jeans])).toBe(
      "underwear: nothing, top: nothing, bottom: Jeans",
    );
    const set = starterClothingForOutfit("casual");
    const look = describeEquippedLook(set.equipped, set.items);
    expect(look).toMatch(/underwear: Cotton Bra & Briefs/);
    expect(look).toMatch(/top: Everyday Tee/);
    expect(look).toMatch(/bottom: Blue Jeans/);
  });

  it("describeEquippedLook omits covered underwear when top and bottom are worn", () => {
    const set = starterClothingForOutfit("casual");
    expect(describeEquippedLook(set.equipped, set.items, { hideCoveredUnderwear: true })).toBe(
      "top: Everyday Tee, bottom: Blue Jeans",
    );
  });

  it("describeEquippedLook omits underwear at cheeky and below", () => {
    const set = starterClothingForOutfit("casual");
    expect(underwearVisibleAtTier("cheeky")).toBe(false);
    expect(underwearVisibleAtTier("risque")).toBe(true);
    expect(describeEquippedLook(set.equipped, set.items, { contentTier: "cheeky" })).toBe(
      "top: Everyday Tee, bottom: Blue Jeans",
    );
    expect(describeEquippedLook(set.equipped, set.items, { contentTier: "risque" })).toMatch(
      /underwear: Cotton Bra & Briefs/,
    );
  });

  it("starterClothingFor applies outfit vibe with gender-appropriate underwear", () => {
    const boldMale = starterClothingFor("bold", "male");
    const names = boldMale.items.map((i) => i.name);
    expect(names).toContain("Black Boxer Briefs");
    expect(names).toContain("Cropped Tank");
    expect(names).toContain("Slim Black Jeans");
    expect(names).not.toContain("Lace Lingerie Set");
    expect(names).not.toContain("Faux-Leather Mini");
    expect(dominantOutfitVibe(boldMale.equipped, boldMale.items)).toBe("bold");
  });

  it("male starter sets avoid female-coded garments across vibes", () => {
    for (const outfit of ["casual", "cozy", "cute", "bold"] as const) {
      const names = starterClothingFor(outfit, "male").items.map((i) => i.name);
      expect(names.some((n) => /bra|lingerie|skirt|mini/i.test(n))).toBe(false);
    }
  });

  it("dominantOutfitVibe follows equipped item vibes", () => {
    const set = starterClothingFor("cozy", "female");
    expect(dominantOutfitVibe(set.equipped, set.items)).toBe("cozy");
    const casual = starterClothingForGender("male");
    expect(dominantOutfitVibe(casual.equipped, casual.items)).toBe("casual");
  });

  it("gender starter sets differ by mode", () => {
    const female = starterClothingForGender("female");
    const male = starterClothingForGender("male");
    const custom = starterClothingForGender("nonbinary");
    expect(female.items.map((i) => i.name)).toContain("Cotton Bra & Briefs");
    expect(male.items.map((i) => i.name)).toContain("Cotton Boxer Briefs");
    expect(custom.items.map((i) => i.name)).toContain("Neutral Boxer Briefs");
    expect(genderMode("nonbinary")).toBe("custom");
    expect(female.items.every((i) => i.meta?.starterWardrobe === "1")).toBe(true);
  });

  it("stacks vibe tags with diminishing returns", () => {
    const pieces = Array.from({ length: 5 }, (_, i) =>
      makeClothingItem({
        name: `Cute piece ${i}`,
        description: "cute",
        slot: "accessory",
        vibes: { cute: 1 },
      }),
    );
    const slots = ["head", "top", "bottom", "feet", "accessory"] as const;
    const eq: Record<string, string> = {};
    pieces.forEach((p, i) => { eq[slots[i]] = p.id; });
    const one = wardrobeAppeal({ head: pieces[0].id }, pieces);
    const five = wardrobeAppeal(eq, pieces);
    expect((five.hype ?? 0) + (five.simps ?? 0)).toBeGreaterThan((one.hype ?? 0) + (one.simps ?? 0));
  });
});
