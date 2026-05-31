import { describe, expect, it } from "vitest";
import { makeClothingItem } from "../items";
import { wardrobeAppeal, starterClothingForOutfit, isLegacyStarterWardrobe, describeEquippedLook } from "../wardrobe";

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
