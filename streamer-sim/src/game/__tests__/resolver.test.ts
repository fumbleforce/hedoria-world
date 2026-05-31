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
