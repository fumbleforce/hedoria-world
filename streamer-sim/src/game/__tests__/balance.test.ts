import { describe, it, expect } from "vitest";
import { BALANCE, getBalance, startingMetrics } from "../balance";

describe("getBalance", () => {
  it("normal matches baseline BALANCE", () => {
    expect(getBalance("normal")).toBe(BALANCE);
  });

  it("easy raises income and lowers bills vs normal", () => {
    const easy = getBalance("easy");
    expect(easy.economy.tipConstant).toBeGreaterThan(BALANCE.economy.tipConstant);
    expect(easy.economy.rentBase).toBeLessThan(BALANCE.economy.rentBase);
    expect(easy.recovery.sleepEnergy).toBeGreaterThan(BALANCE.recovery.sleepEnergy);
  });

  it("hard lowers income and raises bills vs normal", () => {
    const hard = getBalance("hard");
    expect(hard.economy.tipConstant).toBeLessThan(BALANCE.economy.tipConstant);
    expect(hard.economy.rentBase).toBeGreaterThan(BALANCE.economy.rentBase);
    expect(hard.recovery.sleepEnergy).toBeLessThan(BALANCE.recovery.sleepEnergy);
  });

  it("leaves non-patched sections identical", () => {
    const hard = getBalance("hard");
    expect(hard.readiness).toEqual(BALANCE.readiness);
    expect(hard.mastery).toEqual(BALANCE.mastery);
  });
});

describe("startingMetrics", () => {
  it("normal uses default starting bundle", () => {
    expect(startingMetrics("normal")).toEqual({ cash: 250, followers: 35 });
  });

  it("easy starts with more resources than hard", () => {
    const easy = startingMetrics("easy");
    const hard = startingMetrics("hard");
    expect(easy.cash).toBeGreaterThan(hard.cash);
    expect(easy.followers).toBeGreaterThan(hard.followers);
  });
});
