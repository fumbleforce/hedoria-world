import { describe, it, expect } from "vitest";
import {
  isInMinuteWindow,
  dayPhase,
  streamTooLate,
  clockAfterSleep,
  timeOfDay,
} from "../time";
import { seedCharacter, isWatchingNow, extendedWatchWindow } from "../characters";
import { ARCHETYPE_BY_ID } from "../archetypes";

describe("time helpers", () => {
  it("detects day phase", () => {
    expect(dayPhase(10 * 60)).toBe("morning");
    expect(dayPhase(14 * 60)).toBe("afternoon");
    expect(dayPhase(20 * 60)).toBe("evening");
    expect(dayPhase(1 * 60)).toBe("late");
  });

  it("handles windows that wrap midnight", () => {
    expect(isInMinuteWindow(23 * 60, 22 * 60, 2 * 60)).toBe(true);
    expect(isInMinuteWindow(12 * 60, 22 * 60, 2 * 60)).toBe(false);
  });

  it("ends stream after late night threshold", () => {
    expect(streamTooLate(26 * 60)).toBe(true);
    expect(streamTooLate(14 * 60)).toBe(false);
  });

  it("sleep resets to morning", () => {
    expect(clockAfterSleep(26 * 60)).toBe(9 * 60);
  });
});

describe("watch windows", () => {
  it("cozy viewers watch during the day", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 12 * 60);
    expect(isWatchingNow(c, 12 * 60)).toBe(true);
    expect(isWatchingNow(c, 22 * 60)).toBe(false);
  });

  it("affinity extends the window", () => {
    const arch = ARCHETYPE_BY_ID["cozy-regular"]!;
    const c = seedCharacter(arch, 12 * 60);
    const base = extendedWatchWindow(c);
    c.affinity = 100;
    const wide = extendedWatchWindow(c);
    expect(wide.start).toBeLessThan(base.start);
    expect(wide.end).toBeGreaterThan(base.end);
  });
});
