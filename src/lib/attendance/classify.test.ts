import { describe, expect, it } from "vitest";
import {
  buildScheduledWindow,
  classifyAttendanceStatus,
  computeEarlyLeaveMinutes,
  computeLateMinutes,
  computeWorkedMinutes,
  isWorkingDay,
  resolveAttendanceDate,
} from "./classify";

describe("resolveAttendanceDate", () => {
  it("uses calendar date for same-day shifts", () => {
    expect(
      resolveAttendanceDate({
        instant: "2026-09-15T10:30:00.000Z",
        startTime: "08:00",
        endTime: "17:00",
        crossesMidnight: false,
      }),
    ).toBe("2026-09-15");
  });

  it("maps early-morning punches of overnight shifts to previous day", () => {
    expect(
      resolveAttendanceDate({
        instant: "2026-09-16T03:15:00.000Z",
        startTime: "22:00",
        endTime: "06:00",
        crossesMidnight: true,
      }),
    ).toBe("2026-09-15");
  });

  it("keeps evening punches on the start calendar day", () => {
    expect(
      resolveAttendanceDate({
        instant: "2026-09-15T22:30:00.000Z",
        startTime: "22:00",
        endTime: "06:00",
        crossesMidnight: true,
      }),
    ).toBe("2026-09-15");
  });
});

describe("buildScheduledWindow", () => {
  it("spans next day when crossesMidnight", () => {
    const { scheduledStart, scheduledEnd } = buildScheduledWindow({
      attendanceDate: "2026-09-15",
      startTime: "22:00",
      endTime: "06:00",
      crossesMidnight: true,
    });
    expect(scheduledStart.toISOString()).toBe("2026-09-15T22:00:00.000Z");
    expect(scheduledEnd.toISOString()).toBe("2026-09-16T06:00:00.000Z");
  });
});

describe("late / early / worked", () => {
  it("applies late grace", () => {
    expect(
      computeLateMinutes("2026-09-15T08:10:00.000Z", "2026-09-15T08:00:00.000Z", 15),
    ).toBe(0);
    expect(
      computeLateMinutes("2026-09-15T08:20:00.000Z", "2026-09-15T08:00:00.000Z", 15),
    ).toBe(5);
  });

  it("applies early-leave grace", () => {
    expect(
      computeEarlyLeaveMinutes("2026-09-15T16:50:00.000Z", "2026-09-15T17:00:00.000Z", 15),
    ).toBe(0);
    expect(
      computeEarlyLeaveMinutes("2026-09-15T16:30:00.000Z", "2026-09-15T17:00:00.000Z", 15),
    ).toBe(15);
  });

  it("computes worked minutes minus break", () => {
    expect(
      computeWorkedMinutes("2026-09-15T08:00:00.000Z", "2026-09-15T17:00:00.000Z", 60),
    ).toBe(480);
  });
});

describe("isWorkingDay", () => {
  it("treats Fri/Sat as off for Sun–Thu schedule", () => {
    // 2026-09-11 Friday, 2026-09-13 Sunday
    expect(isWorkingDay("2026-09-11", [0, 1, 2, 3, 4])).toBe(false);
    expect(isWorkingDay("2026-09-13", [0, 1, 2, 3, 4])).toBe(true);
  });
});

describe("classifyAttendanceStatus", () => {
  it("gives leave precedence over punches", () => {
    expect(
      classifyAttendanceStatus({
        isOnLeave: true,
        isWorkingDay: true,
        checkInAt: "2026-09-15T08:00:00.000Z",
        checkOutAt: "2026-09-15T17:00:00.000Z",
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 480,
        minimumWorkMinutes: 240,
      }),
    ).toBe("on_leave");
  });

  it("classifies off_day and holiday", () => {
    expect(
      classifyAttendanceStatus({
        isOnLeave: false,
        isHoliday: true,
        isWorkingDay: true,
        checkInAt: null,
        checkOutAt: null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 0,
        minimumWorkMinutes: 240,
      }),
    ).toBe("holiday");
    expect(
      classifyAttendanceStatus({
        isOnLeave: false,
        isWorkingDay: false,
        checkInAt: null,
        checkOutAt: null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 0,
        minimumWorkMinutes: 240,
      }),
    ).toBe("off_day");
  });

  it("classifies absent, missing_checkout, late, partial, present", () => {
    expect(
      classifyAttendanceStatus({
        isOnLeave: false,
        isWorkingDay: true,
        checkInAt: null,
        checkOutAt: null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 0,
        minimumWorkMinutes: 240,
      }),
    ).toBe("absent");

    expect(
      classifyAttendanceStatus({
        isOnLeave: false,
        isWorkingDay: true,
        checkInAt: "2026-09-15T08:00:00.000Z",
        checkOutAt: null,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 0,
        minimumWorkMinutes: 240,
        scheduledEnd: "2026-09-15T17:00:00.000Z",
        asOf: "2026-09-15T18:00:00.000Z",
      }),
    ).toBe("missing_checkout");

    expect(
      classifyAttendanceStatus({
        isOnLeave: false,
        isWorkingDay: true,
        checkInAt: "2026-09-15T08:20:00.000Z",
        checkOutAt: "2026-09-15T17:00:00.000Z",
        lateMinutes: 5,
        earlyLeaveMinutes: 0,
        workedMinutes: 460,
        minimumWorkMinutes: 240,
      }),
    ).toBe("late");

    expect(
      classifyAttendanceStatus({
        isOnLeave: false,
        isWorkingDay: true,
        checkInAt: "2026-09-15T08:00:00.000Z",
        checkOutAt: "2026-09-15T12:00:00.000Z",
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 180,
        minimumWorkMinutes: 240,
      }),
    ).toBe("partial");

    expect(
      classifyAttendanceStatus({
        isOnLeave: false,
        isWorkingDay: true,
        checkInAt: "2026-09-15T08:00:00.000Z",
        checkOutAt: "2026-09-15T17:00:00.000Z",
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workedMinutes: 480,
        minimumWorkMinutes: 240,
      }),
    ).toBe("present");
  });
});
