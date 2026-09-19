/** Pure attendance classification helpers (mirrors DB reconciliation rules). */

import type { AttendanceStatus } from "@/types/enums";

export type TimeOfDay = { hours: number; minutes: number; seconds: number };

/** Parse "HH:MM" or "HH:MM:SS" into parts. */
export function parseTimeOfDay(value: string): TimeOfDay {
  const [h, m, s] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error("INVALID_TIME");
  }
  return { hours: h, minutes: m, seconds: Number.isFinite(s) ? s : 0 };
}

export function toDateOnly(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function combineUtc(dateOnly: string, time: TimeOfDay): Date {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, time.hours, time.minutes, time.seconds));
}

function timeOfDayMinutes(t: TimeOfDay): number {
  return t.hours * 60 + t.minutes + t.seconds / 60;
}

/**
 * Resolve which attendance_date an instant belongs to for a shift.
 * Cross-midnight: times before end_time (early morning) map to the previous calendar day.
 */
export function resolveAttendanceDate(input: {
  instant: Date | string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}): string {
  const instant = typeof input.instant === "string" ? new Date(input.instant) : input.instant;
  if (Number.isNaN(instant.getTime())) throw new Error("INVALID_INSTANT");

  const calendarDate = instant.toISOString().slice(0, 10);
  if (!input.crossesMidnight) return calendarDate;

  const end = parseTimeOfDay(input.endTime);
  const tod: TimeOfDay = {
    hours: instant.getUTCHours(),
    minutes: instant.getUTCMinutes(),
    seconds: instant.getUTCSeconds(),
  };

  // Morning portion of overnight shift → previous day.
  if (timeOfDayMinutes(tod) < timeOfDayMinutes(end)) {
    return addDays(calendarDate, -1);
  }
  return calendarDate;
}

/** Build scheduled start/end timestamptz for an attendance_date + shift times. */
export function buildScheduledWindow(input: {
  attendanceDate: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}): { scheduledStart: Date; scheduledEnd: Date } {
  const start = parseTimeOfDay(input.startTime);
  const end = parseTimeOfDay(input.endTime);
  const scheduledStart = combineUtc(input.attendanceDate, start);
  const endDate = input.crossesMidnight ? addDays(input.attendanceDate, 1) : input.attendanceDate;
  const scheduledEnd = combineUtc(endDate, end);
  if (scheduledEnd <= scheduledStart && !input.crossesMidnight) {
    throw new Error("INVALID_SHIFT_WINDOW");
  }
  return { scheduledStart, scheduledEnd };
}

/** Late minutes after grace (0 if within grace or early/on-time). */
export function computeLateMinutes(
  checkInAt: Date | string,
  scheduledStart: Date | string,
  graceMinutes: number,
): number {
  const checkIn = typeof checkInAt === "string" ? new Date(checkInAt) : checkInAt;
  const start = typeof scheduledStart === "string" ? new Date(scheduledStart) : scheduledStart;
  const deltaMs = checkIn.getTime() - start.getTime();
  if (deltaMs <= 0) return 0;
  const late = Math.floor(deltaMs / 60_000) - Math.max(0, graceMinutes);
  return Math.max(0, late);
}

/** Early-leave minutes after grace (0 if within grace or stayed late). */
export function computeEarlyLeaveMinutes(
  checkOutAt: Date | string,
  scheduledEnd: Date | string,
  graceMinutes: number,
): number {
  const checkOut = typeof checkOutAt === "string" ? new Date(checkOutAt) : checkOutAt;
  const end = typeof scheduledEnd === "string" ? new Date(scheduledEnd) : scheduledEnd;
  const deltaMs = end.getTime() - checkOut.getTime();
  if (deltaMs <= 0) return 0;
  const early = Math.floor(deltaMs / 60_000) - Math.max(0, graceMinutes);
  return Math.max(0, early);
}

/** Gross worked minutes between punches (break deducted, floored at 0). */
export function computeWorkedMinutes(
  checkInAt: Date | string,
  checkOutAt: Date | string,
  breakMinutes = 0,
): number {
  const checkIn = typeof checkInAt === "string" ? new Date(checkInAt) : checkInAt;
  const checkOut = typeof checkOutAt === "string" ? new Date(checkOutAt) : checkOutAt;
  if (checkOut < checkIn) throw new Error("INVALID_PUNCH_ORDER");
  const gross = Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000);
  return Math.max(0, gross - Math.max(0, breakMinutes));
}

/** JS/Postgres DOW: 0=Sun … 6=Sat. Saudi default working days Sun–Thu = [0,1,2,3,4]. */
export function isWorkingDay(attendanceDate: string, workingDays: number[]): boolean {
  const [y, m, d] = attendanceDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return workingDays.includes(dow);
}

export type ClassifyAttendanceInput = {
  /** Approved leave covering the date — wins over punches. */
  isOnLeave: boolean;
  isHoliday?: boolean;
  isWorkingDay: boolean;
  checkInAt: Date | string | null;
  checkOutAt: Date | string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
  minimumWorkMinutes: number;
  scheduledEnd?: Date | string | null;
  /** Used to decide missing_checkout vs still-open shift. Defaults to now. */
  asOf?: Date | string;
};

/**
 * Classify daily attendance status.
 * Precedence: on_leave → holiday → off_day → absent → missing_checkout → partial → late → present.
 */
export function classifyAttendanceStatus(input: ClassifyAttendanceInput): AttendanceStatus {
  if (input.isOnLeave) return "on_leave";
  if (input.isHoliday) return "holiday";
  if (!input.isWorkingDay) return "off_day";

  const checkIn = input.checkInAt
    ? typeof input.checkInAt === "string"
      ? new Date(input.checkInAt)
      : input.checkInAt
    : null;
  const checkOut = input.checkOutAt
    ? typeof input.checkOutAt === "string"
      ? new Date(input.checkOutAt)
      : input.checkOutAt
    : null;

  if (!checkIn) return "absent";

  if (!checkOut) {
    const asOf = input.asOf
      ? typeof input.asOf === "string"
        ? new Date(input.asOf)
        : input.asOf
      : new Date();
    const scheduledEnd = input.scheduledEnd
      ? typeof input.scheduledEnd === "string"
        ? new Date(input.scheduledEnd)
        : input.scheduledEnd
      : null;
    if (scheduledEnd && asOf >= scheduledEnd) return "missing_checkout";
    // Still inside shift window — provisional late/present.
    return input.lateMinutes > 0 ? "late" : "present";
  }

  if (input.workedMinutes < input.minimumWorkMinutes || input.earlyLeaveMinutes > 0) {
    return "partial";
  }
  if (input.lateMinutes > 0) return "late";
  return "present";
}
