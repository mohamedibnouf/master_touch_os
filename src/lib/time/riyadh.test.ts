import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  isoToRiyadhLocalInput,
  riyadhDateOf,
  riyadhLocalInputToIso,
  todayInRiyadh,
} from "./riyadh";

describe("todayInRiyadh", () => {
  it("returns the same day during Riyadh daytime", () => {
    expect(todayInRiyadh(new Date("2026-10-29T09:00:00Z"))).toBe("2026-10-29");
  });

  it("22:00 UTC is already the next day in Riyadh", () => {
    expect(todayInRiyadh(new Date("2026-10-29T22:00:00Z"))).toBe("2026-10-30");
  });

  it("21:00 UTC is exactly Riyadh midnight (next day)", () => {
    expect(todayInRiyadh(new Date("2026-10-29T21:00:00Z"))).toBe("2026-10-30");
    expect(todayInRiyadh(new Date("2026-10-29T20:59:59Z"))).toBe("2026-10-29");
  });

  it("rolls over month and year boundaries", () => {
    expect(todayInRiyadh(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
    expect(todayInRiyadh(new Date("2028-02-28T23:00:00Z"))).toBe("2028-02-29");
  });

  it("riyadhDateOf accepts ISO strings", () => {
    expect(riyadhDateOf("2026-03-01T21:30:00.000Z")).toBe("2026-03-02");
  });
});

describe("addDaysYmd", () => {
  it("adds and subtracts calendar days", () => {
    expect(addDaysYmd("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysYmd("2026-10-29", 30)).toBe("2026-11-28");
  });

  it("rejects malformed dates", () => {
    expect(() => addDaysYmd("2026-1-1", 1)).toThrow("INVALID_DATE");
  });
});

describe("riyadhLocalInputToIso", () => {
  it("interprets datetime-local input as Riyadh time (+03:00)", () => {
    expect(riyadhLocalInputToIso("2026-10-29T08:00")).toBe("2026-10-29T05:00:00.000Z");
  });

  it("handles early-morning input that is the previous UTC day", () => {
    expect(riyadhLocalInputToIso("2026-10-29T01:30")).toBe("2026-10-28T22:30:00.000Z");
  });

  it("accepts seconds", () => {
    expect(riyadhLocalInputToIso("2026-10-29T17:45:30")).toBe("2026-10-29T14:45:30.000Z");
  });

  it("returns null for empty input", () => {
    expect(riyadhLocalInputToIso("")).toBeNull();
    expect(riyadhLocalInputToIso("   ")).toBeNull();
    expect(riyadhLocalInputToIso(null)).toBeNull();
  });

  it("rejects malformed or rolled-over input", () => {
    expect(() => riyadhLocalInputToIso("2026-10-29 08:00")).toThrow("INVALID_DATETIME");
    expect(() => riyadhLocalInputToIso("2026-10-29T08:00Z")).toThrow("INVALID_DATETIME");
    expect(() => riyadhLocalInputToIso("2026-02-31T10:00")).toThrow("INVALID_DATETIME");
  });
});

describe("isoToRiyadhLocalInput", () => {
  it("renders stored UTC timestamps in Riyadh wall-clock time", () => {
    expect(isoToRiyadhLocalInput("2026-10-29T05:00:00Z")).toBe("2026-10-29T08:00");
    expect(isoToRiyadhLocalInput("2026-10-29T22:15:00+00:00")).toBe("2026-10-30T01:15");
  });

  it("round-trips with riyadhLocalInputToIso", () => {
    const local = "2026-06-15T23:59";
    expect(isoToRiyadhLocalInput(riyadhLocalInputToIso(local))).toBe(local);
  });

  it("returns empty string for empty or invalid values", () => {
    expect(isoToRiyadhLocalInput(null)).toBe("");
    expect(isoToRiyadhLocalInput("not-a-date")).toBe("");
  });
});
