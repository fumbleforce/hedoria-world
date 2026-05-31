import { describe, it, expect } from "vitest";
import { applyAffinity, decayAffinities } from "../relationships";
import { seedCharacter } from "../characters";
import { ARCHETYPE_BY_ID, ARCHETYPES } from "../archetypes";
import { BALANCE } from "../balance";
import type { CharacterSheet } from "../characters";

function makeChar(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const arch = ARCHETYPE_BY_ID["cozy-regular"] ?? ARCHETYPES[0];
  return { ...seedCharacter(arch, 1200), affinity: 20, ...overrides };
}

describe("applyAffinity", () => {
  it("passive chat barely moves the needle", () => {
    const c = makeChar({ affinity: 20 });
    const { applied } = applyAffinity(c, BALANCE.affinity.sources.chat, "chat", 1);
    expect(applied).toBeGreaterThan(0);
    expect(applied).toBeLessThan(0.1);
  });

  it("applies diminishing returns at high affinity", () => {
    const low = makeChar({ affinity: 10 });
    const high = makeChar({ affinity: 90 });
    const lowGain = applyAffinity(low, 4, "dm", 1).applied;
    const highGain = applyAffinity(high, 4, "dm", 1).applied;
    expect(highGain).toBeLessThan(lowGain);
  });

  it("caps soft-source gains at the daily soft cap", () => {
    let c = makeChar({ affinity: 5 });
    let total = 0;
    // Hammer mentions all on the same day; total soft gain must not exceed the cap.
    for (let i = 0; i < 50; i += 1) {
      const r = applyAffinity(c, BALANCE.affinity.sources.mention, "mention", 1);
      total += r.applied;
      c = { ...c, ...r.patch };
    }
    expect(total).toBeLessThanOrEqual(BALANCE.affinity.dailySoftCap + 1e-6);
  });

  it("lets reciprocal sources (tips) bypass the soft cap", () => {
    let c = makeChar({ affinity: 5 });
    // Exhaust the soft budget with chat first.
    for (let i = 0; i < 200; i += 1) {
      const r = applyAffinity(c, BALANCE.affinity.sources.chat, "chat", 1);
      c = { ...c, ...r.patch };
    }
    const before = c.affinity;
    const tip = applyAffinity(c, 5, "tip", 1);
    expect(tip.applied).toBeGreaterThan(0); // tip still lands despite cap being used up
    expect(before + tip.applied).toBeCloseTo(tip.patch.affinity!, 5);
  });

  it("resets the daily budget when the day rolls over", () => {
    let c = makeChar({ affinity: 5 });
    for (let i = 0; i < 200; i += 1) {
      const r = applyAffinity(c, BALANCE.affinity.sources.chat, "chat", 1);
      c = { ...c, ...r.patch };
    }
    // Next day: soft gains work again.
    const next = applyAffinity(c, BALANCE.affinity.sources.mention, "mention", 2);
    expect(next.applied).toBeGreaterThan(0);
    expect(next.patch.affinityGainedToday).toBeLessThanOrEqual(BALANCE.affinity.dailySoftCap);
  });

  it("applies losses in full (no diminishing, no cap) and clamps at 0", () => {
    const c = makeChar({ affinity: 5 });
    const r = applyAffinity(c, -20, "tip", 1);
    expect(r.patch.affinity).toBe(0);
    expect(r.applied).toBe(-5);
  });

  it("stamps lastInteractionDay", () => {
    const c = makeChar({ affinity: 20, lastInteractionDay: -1 });
    const r = applyAffinity(c, 1, "dm", 7);
    expect(r.patch.lastInteractionDay).toBe(7);
  });
});

describe("decayAffinities", () => {
  it("cools bonds idle beyond the grace window, scaled by level", () => {
    const friend = makeChar({ id: "a", affinity: 70, lastInteractionDay: 1 });
    const roster = { a: friend };
    const out = decayAffinities(roster, 5); // 4 idle days > grace
    expect(out).toHaveLength(1);
    expect(out[0].delta).toBe(-BALANCE.affinity.decayPerIdleDay.friend);
  });

  it("respects the grace window", () => {
    const c = makeChar({ id: "a", affinity: 70, lastInteractionDay: 4 });
    const out = decayAffinities({ a: c }, 5); // 1 idle day == grace
    expect(out).toHaveLength(0);
  });

  it("ignores characters never interacted with", () => {
    const c = makeChar({ id: "a", affinity: 8, lastInteractionDay: -1 });
    const out = decayAffinities({ a: c }, 50);
    expect(out).toHaveLength(0);
  });
});
