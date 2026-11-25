import { describe, expect, it } from "vitest";
import {
  buildTodayShiftRows,
  shiftAssignmentErrorMessage,
  shiftAssignmentState,
  shiftsForWeekday,
  todayPunchState,
  type SplitRecordLike,
  type SplitShiftLike,
} from "./split-shifts";

const morning: SplitShiftLike = {
  id: "s-am",
  start_time: "08:00:00",
  end_time: "12:00:00",
  crosses_midnight: false,
  working_days: [0, 1, 2, 3, 4],
};
const evening: SplitShiftLike = {
  id: "s-pm",
  start_time: "16:00:00",
  end_time: "20:00:00",
  crosses_midnight: false,
  working_days: [0, 1, 2, 3, 4],
};
const friday: SplitShiftLike = { ...evening, id: "s-fri", working_days: [5] };

function rec(partial: Partial<SplitRecordLike> & { id: string }): SplitRecordLike {
  return {
    shift_id: null,
    attendance_date: "2026-11-25",
    check_in_at: null,
    check_out_at: null,
    scheduled_end: null,
    attendance_status: "absent",
    worked_minutes: 0,
    late_minutes: 0,
    early_leave_minutes: 0,
    ...partial,
  };
}

const at = (hhmm: string) => new Date(`2026-11-25T${hhmm}:00+03:00`);

describe("shiftsForWeekday", () => {
  it("keeps the shifts of that weekday, earliest first", () => {
    expect(shiftsForWeekday([evening, friday, morning], 3).map((s) => s.id)).toEqual(["s-am", "s-pm"]);
  });
  it("falls back to every shift on an off day", () => {
    expect(shiftsForWeekday([evening, morning], 6).map((s) => s.id)).toEqual(["s-am", "s-pm"]);
  });
});

describe("todayPunchState — split day", () => {
  const shiftsToday = [morning, evening];

  it("nothing recorded: check-in only", () => {
    const s = todayPunchState({ shiftsToday, todayRecords: [], now: at("07:50") });
    expect(s).toMatchObject({ canCheckIn: true, canCheckOut: false, betweenShifts: false, headlineRecord: null });
  });

  it("morning open: check-out only", () => {
    const am = rec({
      id: "r1",
      shift_id: "s-am",
      check_in_at: at("08:01").toISOString(),
      scheduled_end: at("12:00").toISOString(),
      attendance_status: "present",
    });
    const s = todayPunchState({ shiftsToday, todayRecords: [am], now: at("10:00") });
    expect(s).toMatchObject({ canCheckIn: false, canCheckOut: true });
    expect(s.openRecord?.id).toBe("r1");
  });

  it("morning done: check-in again for the evening", () => {
    const am = rec({
      id: "r1",
      shift_id: "s-am",
      check_in_at: at("08:00").toISOString(),
      check_out_at: at("12:00").toISOString(),
      attendance_status: "present",
      worked_minutes: 240,
    });
    const s = todayPunchState({ shiftsToday, todayRecords: [am], now: at("13:00") });
    expect(s).toMatchObject({ canCheckIn: true, canCheckOut: false, betweenShifts: true });
    expect(s.totals.worked).toBe(240);
  });

  it("forgot to check out of the morning: evening check-in is still offered", () => {
    const am = rec({
      id: "r1",
      shift_id: "s-am",
      check_in_at: at("08:00").toISOString(),
      scheduled_end: at("12:00").toISOString(),
      attendance_status: "present",
    });
    const s = todayPunchState({ shiftsToday, todayRecords: [am], now: at("16:05") });
    expect(s).toMatchObject({ canCheckIn: true, canCheckOut: true });
  });

  it("both done: no action", () => {
    const records = [
      rec({ id: "r1", shift_id: "s-am", check_in_at: at("08:00").toISOString(), check_out_at: at("12:00").toISOString(), attendance_status: "present", worked_minutes: 240 }),
      rec({ id: "r2", shift_id: "s-pm", check_in_at: at("16:10").toISOString(), check_out_at: at("20:00").toISOString(), attendance_status: "late", worked_minutes: 230, late_minutes: 10 }),
    ];
    const s = todayPunchState({ shiftsToday, todayRecords: records, now: at("20:30") });
    expect(s).toMatchObject({ canCheckIn: false, canCheckOut: false, betweenShifts: false });
    expect(s.headlineRecord?.id).toBe("r2");
    expect(s.totals).toEqual({ worked: 470, late: 10, early: 0 });
  });
});

describe("todayPunchState — single shift keeps pre-092 behaviour", () => {
  it("after check-out nothing is offered", () => {
    const r = rec({ id: "r1", shift_id: "s-am", check_in_at: at("08:00").toISOString(), check_out_at: at("12:00").toISOString(), attendance_status: "present" });
    const s = todayPunchState({ shiftsToday: [morning], todayRecords: [r], now: at("13:00") });
    expect(s).toMatchObject({ canCheckIn: false, canCheckOut: false });
  });
  it("no shift assigned: check-in button stays (server explains)", () => {
    const s = todayPunchState({ shiftsToday: [], todayRecords: [], now: at("09:00") });
    expect(s.canCheckIn).toBe(true);
  });
  it("yesterday's open night shift can be checked out", () => {
    const night = rec({ id: "n1", attendance_date: "2026-11-24", shift_id: "s-night", check_in_at: "2026-11-24T19:00:00Z", scheduled_end: "2026-11-25T03:00:00Z", attendance_status: "present" });
    const s = todayPunchState({ shiftsToday: [morning], todayRecords: [], carriedOpenRecords: [night], now: at("05:00") });
    expect(s).toMatchObject({ canCheckOut: true, canCheckIn: false });
  });
});

describe("buildTodayShiftRows", () => {
  it("one row per shift with its record and state", () => {
    const am = rec({ id: "r1", shift_id: "s-am", check_in_at: at("08:00").toISOString() });
    const rows = buildTodayShiftRows([morning, evening], [am]);
    expect(rows.map((r) => [r.shift?.id, r.record?.id ?? null, r.state])).toEqual([
      ["s-am", "r1", "open"],
      ["s-pm", null, "not_started"],
    ]);
  });
  it("keeps rows of shifts no longer assigned", () => {
    const old = rec({ id: "r9", shift_id: "s-old", check_in_at: at("08:00").toISOString(), check_out_at: at("09:00").toISOString() });
    const rows = buildTodayShiftRows([morning], [old]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ shift: null, state: "done" });
  });
});

describe("shiftAssignmentState", () => {
  it("classifies by today", () => {
    expect(shiftAssignmentState({ effective_from: "2026-11-01", effective_to: null }, "2026-11-25")).toBe("current");
    expect(shiftAssignmentState({ effective_from: "2026-11-01", effective_to: "2026-11-25" }, "2026-11-25")).toBe("current");
    expect(shiftAssignmentState({ effective_from: "2026-11-01", effective_to: "2026-11-24" }, "2026-11-25")).toBe("ended");
    expect(shiftAssignmentState({ effective_from: "2026-12-01", effective_to: null }, "2026-11-25")).toBe("upcoming");
  });
});

describe("shiftAssignmentErrorMessage", () => {
  it("maps 092 RPC errors", () => {
    expect(shiftAssignmentErrorMessage({ message: "SHIFT_TIME_OVERLAP" })?.en).toMatch(/overlap/);
    expect(shiftAssignmentErrorMessage({ message: "SHIFT_ASSIGNMENT_HAS_ATTENDANCE" })?.en).toMatch(/End instead/);
    expect(shiftAssignmentErrorMessage({ code: "23P01", message: "conflicting key value" })?.en).toMatch(/already has this shift/);
    expect(shiftAssignmentErrorMessage({ message: "something else" })).toBeNull();
  });
});
