import { describe, expect, it } from "vitest";
import { availableLeaveDays, calculateLeaveDays, rangesOverlap } from "./days";

describe("calculateLeaveDays", () => {
  it("counts inclusive calendar days", () => {
    expect(calculateLeaveDays("2026-09-01", "2026-09-03", "calendar")).toBe(3);
  });

  it("excludes Fri/Sat for working basis", () => {
    // 2026-09-10 Thu, 11 Fri, 12 Sat, 13 Sun → working = Thu+Sun = 2
    expect(calculateLeaveDays("2026-09-10", "2026-09-13", "working")).toBe(2);
  });

  it("rejects inverted range", () => {
    expect(() => calculateLeaveDays("2026-09-05", "2026-09-01")).toThrow("INVALID_DATE_RANGE");
  });
});

describe("availableLeaveDays", () => {
  it("derives available from components", () => {
    expect(
      availableLeaveDays({
        opening_balance: 2,
        entitled_days: 21,
        carried_forward_days: 3,
        used_days: 5,
        pending_days: 2,
        adjustment_days: 1,
      }),
    ).toBe(20);
  });
});

describe("rangesOverlap", () => {
  it("detects overlap and non-overlap", () => {
    expect(rangesOverlap("2026-09-01", "2026-09-05", "2026-09-05", "2026-09-10")).toBe(true);
    expect(rangesOverlap("2026-09-01", "2026-09-05", "2026-09-06", "2026-09-10")).toBe(false);
  });
});
