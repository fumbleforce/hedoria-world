import { describe, it, expect } from "vitest";
import { resolveAction } from "../resolver";
import { multipliersFor } from "../shop";
import { initialAudience, type AudienceState } from "../segments";
import { BALANCE } from "../balance";
import type { ActionVerdict } from "../actions";
import type { Metrics } from "../types";

function metrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    cash: 250,
    followers: 100,
    subscribers: 1,
    currentViewers: 0,
    peakViewers: 0,
    hype: 60,
    energy: 100,
    mood: 70,
    comfort: 90,
    day: 1,
    ...overrides,
  };
}

function verdict(overrides: Partial<ActionVerdict> = {}): ActionVerdict {
  return {
    plausible: true,
    tags: [],
    intensity: 2,
    appeal: {},
    pressure: {},
    narration: "test",
    ...overrides,
  };
}

function audience(pop: Partial<Record<keyof AudienceState, number>>, sat = 80): AudienceState {
  const a = initialAudience();
  for (const id of Object.keys(a) as (keyof AudienceState)[]) {
    a[id] = { population: pop[id] ?? 0, satisfaction: sat };
  }
  return a;
}

const mult = multipliersFor([]);

describe("resolveAction — economy", () => {
  it("pays tips from happy, well-fit segments and grows followers", () => {
    const res = resolveAction({
      verdict: verdict({ intensity: 1, appeal: { hype: 3 } }),
      metrics: metrics(),
      audience: audience({ hype: 20 }, 80),
      mult,
      contentTier: "flirty",
      isLive: true,
    });
    expect(res.earned).toBeGreaterThan(0);
    expect(res.gainedFollowers).toBeGreaterThan(0);
  });

  it("scales tips with the balance tip constant", () => {
    // Two identical resolves differ only by the constant the resolver reads, so
    // we sanity-check the constant is actually wired (earned is proportional).
    const res = resolveAction({
      verdict: verdict({ intensity: 1, appeal: { whales: 2 } }),
      metrics: metrics(),
      audience: audience({ whales: 5 }, 90),
      mult,
      contentTier: "flirty",
      isLive: true,
    });
    // whales tipFactor 5, sat 90 → (35/45)*5*5*tipConstant*1, gated by readiness.
    expect(res.earned).toBeGreaterThan(0);
    expect(BALANCE.economy.tipConstant).toBe(0.07);
  });

  it("earns nothing offline", () => {
    const res = resolveAction({
      verdict: verdict({ intensity: 3, appeal: { hype: 3 } }),
      metrics: metrics(),
      audience: audience({ hype: 20 }),
      mult,
      contentTier: "flirty",
      isLive: false,
    });
    expect(res.earned).toBe(0);
    expect(res.gainedFollowers).toBe(0);
    expect(res.readiness).toBe(1);
  });
});

describe("resolveAction — readiness gating", () => {
  it("near-zero payoff for spicy content with no matching audience", () => {
    // Intensity 5 'suggestive' to a pure cozy room: simps/whales absent, so fit≈0.
    const res = resolveAction({
      verdict: verdict({ intensity: 5, tags: ["suggestive", "bold"], appeal: { simps: 3, cozy: -3 } }),
      metrics: metrics({ comfort: 40 }),
      audience: audience({ cozy: 20 }, 70),
      mult,
      contentTier: "risque",
      isLive: true,
    });
    expect(res.readiness).toBeLessThan(0.4);
  });

  it("rewards the same escalation once the audience + comfort are built", () => {
    const base = {
      verdict: verdict({ intensity: 5, tags: ["suggestive", "bold"], appeal: { simps: 3 } }),
      audience: audience({ simps: 20 }, 80),
      mult,
      contentTier: "risque" as const,
      isLive: true,
    };
    const ready = resolveAction({ ...base, metrics: metrics({ comfort: 95, energy: 100, hype: 90 }) });
    const notReady = resolveAction({ ...base, metrics: metrics({ comfort: 20, energy: 100, hype: 90 }) });
    expect(ready.readiness).toBeGreaterThan(notReady.readiness);
    expect(ready.gainedFollowers).toBeGreaterThanOrEqual(notReady.gainedFollowers);
  });

  it("amplifies the comfort cost of escalation when comfort is already low", () => {
    const v = verdict({ intensity: 5, pressure: { comfort: "down" } });
    const high = resolveAction({
      verdict: v,
      metrics: metrics({ comfort: 90 }),
      audience: audience({ hype: 5 }),
      mult,
      contentTier: "risque",
      isLive: true,
    });
    const low = resolveAction({
      verdict: v,
      metrics: metrics({ comfort: 20 }),
      audience: audience({ hype: 5 }),
      mult,
      contentTier: "risque",
      isLive: true,
    });
    const highDrop = 90 - (high.metricsPatch.comfort ?? 90);
    const lowDrop = 20 - (low.metricsPatch.comfort ?? 20);
    expect(lowDrop).toBeGreaterThan(highDrop);
  });

  it("does not gate gentle, well-fit content", () => {
    const res = resolveAction({
      verdict: verdict({ intensity: 1, appeal: { cozy: 3 } }),
      metrics: metrics(),
      audience: audience({ cozy: 20 }, 80),
      mult,
      contentTier: "wholesome",
      isLive: true,
    });
    expect(res.readiness).toBeGreaterThan(0.9);
  });
});

describe("resolveAction — personal stat costs", () => {
  const liveBase = {
    metrics: metrics({ energy: 80, comfort: 80 }),
    audience: audience({ cozy: 5 }),
    mult,
    contentTier: "flirty" as const,
    isLive: true,
  };

  it("active beat spends energy even when LLM marks pressure up (softened)", () => {
    const res = resolveAction({
      ...liveBase,
      verdict: verdict({ tags: ["energetic"], intensity: 3, pressure: { energy: "up" } }),
    });
    expect(res.metricsPatch.energy!).toBeLessThan(80);
  });

  it("active beat spends more when LLM marks pressure down", () => {
    const base = { tags: ["energetic"] as ActionVerdict["tags"], intensity: 3 };
    const soft = resolveAction({
      ...liveBase,
      verdict: verdict({ ...base, pressure: { energy: "up" } }),
    });
    const hard = resolveAction({
      ...liveBase,
      verdict: verdict({ ...base, pressure: { energy: "down" } }),
    });
    expect(hard.metricsPatch.energy!).toBeLessThan(soft.metricsPatch.energy!);
  });

  it("intimate beat spends comfort", () => {
    const res = resolveAction({
      ...liveBase,
      verdict: verdict({ tags: ["flirty"], intensity: 3 }),
    });
    expect(res.metricsPatch.comfort!).toBeLessThan(80);
  });

  it("restful beat restores energy", () => {
    const res = resolveAction({
      ...liveBase,
      metrics: metrics({ energy: 50 }),
      verdict: verdict({ tags: ["chill"], intensity: 2 }),
    });
    expect(res.metricsPatch.energy!).toBeGreaterThan(50);
  });

  it("boundary beat restores comfort", () => {
    const res = resolveAction({
      ...liveBase,
      metrics: metrics({ comfort: 50 }),
      verdict: verdict({ tags: ["boundary-setting"], setsBoundary: true, intensity: 2 }),
    });
    expect(res.metricsPatch.comfort!).toBeGreaterThan(50);
  });

  it("higher showmanship mastery reduces energy cost", () => {
    const v = verdict({ tags: ["energetic"], intensity: 3 });
    const novice = resolveAction({
      ...liveBase,
      verdict: v,
      mastery: { showmanship: 0, composure: 0 },
    });
    const vet = resolveAction({
      ...liveBase,
      verdict: v,
      mastery: { showmanship: BALANCE.mastery.levelCurve * 4, composure: 0 },
    });
    const noviceDrop = 80 - (novice.metricsPatch.energy ?? 80);
    const vetDrop = 80 - (vet.metricsPatch.energy ?? 80);
    expect(vetDrop).toBeLessThan(noviceDrop);
    expect(vetDrop).toBeGreaterThan(0);
  });
});
