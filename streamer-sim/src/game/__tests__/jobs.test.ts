import { describe, expect, it } from "vitest";
import {
  EARLY_WINDOW,
  ON_TIME_GRACE,
  jobFromPreset,
  shiftStatus,
  workedToday,
  JOB_PRESETS,
} from "../jobs";

describe("shiftStatus", () => {
  const barista = jobFromPreset(JOB_PRESETS[0]);

  it("returns early before the early window opens", () => {
    expect(shiftStatus(barista, barista.shiftStart - EARLY_WINDOW - 1)).toBe("early");
  });

  it("returns ontime at shift start", () => {
    expect(shiftStatus(barista, barista.shiftStart)).toBe("ontime");
  });

  it("returns ontime within grace", () => {
    expect(shiftStatus(barista, barista.shiftStart + ON_TIME_GRACE)).toBe("ontime");
  });

  it("returns late after grace", () => {
    expect(shiftStatus(barista, barista.shiftStart + ON_TIME_GRACE + 15)).toBe("late");
  });

  it("returns over after shift end", () => {
    expect(shiftStatus(barista, barista.shiftEnd + 1)).toBe("over");
  });
});

describe("workedToday", () => {
  it("is true when lastClockInDay matches", () => {
    const job = { ...jobFromPreset(JOB_PRESETS[0]), lastClockInDay: 3, lastClockInOnTime: true };
    expect(workedToday(job, 3)).toBe(true);
    expect(workedToday(job, 4)).toBe(false);
  });
});
