import { describe, it, expect } from "vitest";
import {
  initialMastery,
  normalizeMastery,
  masteryLevel,
  masteryCostMult,
  masteryXpForAction,
  masteryProgress,
} from "../mastery";
import { BALANCE } from "../balance";

describe("mastery", () => {
  it("starts every domain at zero", () => {
    const m = initialMastery();
    expect(m.showmanship).toBe(0);
    expect(m.composure).toBe(0);
  });

  it("normalizes a partial save to all domains", () => {
    const m = normalizeMastery({ showmanship: 120 });
    expect(m.showmanship).toBe(120);
    expect(m.composure).toBe(0);
  });

  it("levels on a sqrt curve", () => {
    const c = BALANCE.mastery.levelCurve;
    expect(masteryLevel(0)).toBe(0);
    expect(masteryLevel(c)).toBe(1); // sqrt(1) = 1
    expect(masteryLevel(c * 4)).toBe(2); // sqrt(4) = 2
    expect(masteryLevel(c * 9)).toBe(3);
  });

  it("reduces cost per level but never below the floor", () => {
    expect(masteryCostMult(0)).toBe(1);
    // level 1 → 1 - efficiencyPerLevel
    expect(masteryCostMult(BALANCE.mastery.levelCurve)).toBeCloseTo(
      1 - BALANCE.mastery.efficiencyPerLevel,
      5,
    );
    // an absurd amount of XP is floored, never free
    expect(masteryCostMult(BALANCE.mastery.levelCurve * 10000)).toBe(
      BALANCE.mastery.efficiencyFloor,
    );
    expect(masteryCostMult(1e9)).toBeGreaterThanOrEqual(BALANCE.mastery.efficiencyFloor);
  });

  it("awards XP only to domains whose tags the action carried, scaled by intensity", () => {
    const showy = masteryXpForAction(["energetic", "hype"], 3);
    expect(showy.showmanship).toBe(BALANCE.mastery.xpPerIntensity * 3);
    expect(showy.composure).toBeUndefined();

    const intimate = masteryXpForAction(["flirty", "vulnerable"], 2);
    expect(intimate.composure).toBe(BALANCE.mastery.xpPerIntensity * 2);
    expect(intimate.showmanship).toBeUndefined();

    const neutral = masteryXpForAction(["chill", "calm"], 1);
    expect(neutral.showmanship).toBeUndefined();
    expect(neutral.composure).toBeUndefined();
  });

  it("tracks progress toward the next level", () => {
    const c = BALANCE.mastery.levelCurve;
    expect(masteryProgress(0)).toMatchObject({ level: 0, pct: 0 });
    expect(masteryProgress(c / 2).pct).toBeCloseTo(0.5, 5);
    expect(masteryProgress(c).level).toBe(1);
  });
});
