import { describe, expect, it } from "vitest";
import type { TaskPerformanceRow } from "@/modules/tasks/types";
import {
  aggregateRows,
  completionPercent,
  performanceHref,
  presetRange,
  resolvePeriod,
  resolveSort,
  sortRows,
  topPerformerId,
} from "./performance-model";

function row(id: string, patch: Partial<TaskPerformanceRow> = {}): TaskPerformanceRow & { displayName: string } {
  return {
    profile_id: id,
    full_name_ar: id,
    full_name_en: id,
    assigned: 0,
    completed: 0,
    completed_on_time: 0,
    overdue_open: 0,
    on_time_rate: null,
    avg_cycle_hours: null,
    logged_minutes: 0,
    estimate_minutes_done: 0,
    points_earned: 0,
    displayName: id,
    ...patch,
  };
}

describe("presetRange (Riyadh calendar)", () => {
  it("week starts on Saturday", () => {
    // 2026-10-31 is a Saturday; 2026-10-30 a Friday.
    expect(presetRange("this_week", "2026-10-31")).toEqual({ from: "2026-10-31", to: "2026-11-06" });
    expect(presetRange("this_week", "2026-10-30")).toEqual({ from: "2026-10-24", to: "2026-10-30" });
  });
  it("months and quarters", () => {
    expect(presetRange("this_month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("this_quarter", "2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });
});

describe("resolvePeriod", () => {
  // 2026-10-31 22:30 UTC is already 2026-11-01 in Riyadh.
  const lateUtc = new Date("2026-10-31T22:30:00Z");
  it("defaults to this month on the Riyadh day", () => {
    expect(resolvePeriod({}, lateUtc)).toEqual({ preset: "this_month", from: "2026-11-01", to: "2026-11-30" });
  });
  it("accepts and normalises custom ranges", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-03-10", to: "2026-03-01" })).toEqual({
      preset: "custom",
      from: "2026-03-01",
      to: "2026-03-10",
    });
    expect(resolvePeriod({ from: "2026-03-10" })).toEqual({ preset: "custom", from: "2026-03-10", to: "2026-03-10" });
  });
  it("rejects invalid or too long custom ranges", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-02-30", to: "x" }, lateUtc).preset).toBe("this_month");
    expect(resolvePeriod({ period: "custom", from: "2020-01-01", to: "2026-01-01" }, lateUtc).preset).toBe("this_month");
    expect(resolvePeriod({ period: "bogus" }, lateUtc).preset).toBe("this_month");
  });
});

describe("sorting", () => {
  it("resolves defaults and natural directions", () => {
    expect(resolveSort(undefined, undefined)).toEqual({ key: "points", dir: "desc" });
    expect(resolveSort("cycle", null)).toEqual({ key: "cycle", dir: "asc" });
    expect(resolveSort("nope", "asc")).toEqual({ key: "points", dir: "asc" });
  });
  it("puts nulls last in both directions", () => {
    const rows = [row("a", { on_time_rate: null }), row("b", { on_time_rate: 50 }), row("c", { on_time_rate: 90 })];
    expect(sortRows(rows, "on_time", "desc").map((r) => r.profile_id)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, "on_time", "asc").map((r) => r.profile_id)).toEqual(["b", "c", "a"]);
  });
  it("finds the top performer by points then completions", () => {
    expect(topPerformerId([row("a"), row("b")])).toBeNull();
    expect(
      topPerformerId([row("a", { points_earned: 5, completed: 2 }), row("b", { points_earned: 5, completed: 3 })]),
    ).toBe("b");
  });
});

describe("aggregateRows", () => {
  it("sums and weights averages by completions", () => {
    const t = aggregateRows([
      row("a", { assigned: 4, completed: 3, completed_on_time: 3, avg_cycle_hours: 10, points_earned: 6, logged_minutes: 90 }),
      row("b", { assigned: 2, completed: 1, completed_on_time: 0, avg_cycle_hours: 30, points_earned: 1.5, overdue_open: 1 }),
      row("c", { logged_minutes: 30 }),
    ]);
    expect(t).toMatchObject({
      people: 3,
      assigned: 6,
      completed: 4,
      completedOnTime: 3,
      completedLate: 1,
      overdueOpen: 1,
      onTimeRate: 75,
      avgCycleHours: 15,
      loggedMinutes: 120,
      points: 7.5,
    });
    expect(aggregateRows([]).onTimeRate).toBeNull();
  });
  it("completion percent is bounded", () => {
    expect(completionPercent({ assigned: 0, completed: 0 })).toBe(0);
    expect(completionPercent({ assigned: 3, completed: 2 })).toBe(67);
  });
  it("builds hrefs without empty params", () => {
    expect(performanceHref({ period: "this_week", space: "", sort: null })).toBe("/tasks/performance?period=this_week");
  });
});
