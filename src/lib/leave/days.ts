/** Leave day calculation (mirrors public.calculate_leave_days). */

export type LeaveDayBasis = "calendar" | "working";

/**
 * Count leave days between inclusive dates.
 * Working basis excludes Saudi weekend: Friday (5) and Saturday (6).
 */
export function calculateLeaveDays(
  startDate: string | Date,
  endDate: string | Date,
  basis: LeaveDayBasis = "calendar",
): number {
  const start = toUtcDateOnly(startDate);
  const end = toUtcDateOnly(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error("INVALID_DATE_RANGE");
  }

  let days = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (basis === "working") {
      const dow = cursor.getUTCDay(); // 0=Sun … 5=Fri, 6=Sat
      if (dow !== 5 && dow !== 6) days += 1;
    } else {
      days += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (days <= 0) throw new Error("ZERO_DAYS");
  return days;
}

export function availableLeaveDays(input: {
  opening_balance: number;
  entitled_days: number;
  carried_forward_days: number;
  used_days: number;
  pending_days: number;
  adjustment_days: number;
}): number {
  return (
    input.opening_balance +
    input.entitled_days +
    input.carried_forward_days +
    input.adjustment_days -
    input.used_days -
    input.pending_days
  );
}

export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function toUtcDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
