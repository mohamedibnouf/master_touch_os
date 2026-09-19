/**
 * Payroll proration & money helpers (mirrors SQL engine v1).
 *
 * Formula (payroll_engine_version = 1):
 *   monthly_gross = basic + housing + transport + other
 *   daily_rate    = round_money(monthly_gross / standard_payable_days)
 *   segment_pay   = round_money(monthly_gross * segment_payable_days / standard_payable_days)
 *   unpaid_deduction = round_money(daily_rate * unpaid_leave_days)
 *   absence_deduction (if enabled) = round_money(daily_rate * absent_days_not_already_unpaid)
 *
 * Uses integer minor-units (halalas) to avoid IEEE float drift in app-layer tests.
 * SQL uses NUMERIC; both round half-up to `precision` decimal places (default 2).
 */

export const PAYROLL_ENGINE_VERSION = 1;

export type Money = number;

export function roundMoney(amount: number, precision = 2): Money {
  if (!Number.isFinite(amount)) throw new Error("INVALID_AMOUNT");
  // Avoid binary float artifacts (e.g. 1.005 * 100) before half-up rounding.
  const factor = 10 ** precision;
  const shifted = Number(`${amount}e${precision}`);
  const rounded = Math.round(shifted);
  return Number(`${rounded}e-${precision}`);
}

export function monthlyGross(input: {
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
}): Money {
  return roundMoney(
    input.basic_salary +
      input.housing_allowance +
      input.transport_allowance +
      input.other_allowances,
  );
}

export function dailyRate(monthlyGrossAmount: number, standardPayableDays: number, precision = 2): Money {
  if (standardPayableDays <= 0) throw new Error("INVALID_STANDARD_DAYS");
  return roundMoney(monthlyGrossAmount / standardPayableDays, precision);
}

export function prorateAmount(
  monthlyAmount: number,
  payableDays: number,
  standardPayableDays: number,
  precision = 2,
): Money {
  if (standardPayableDays <= 0) throw new Error("INVALID_STANDARD_DAYS");
  if (payableDays < 0) throw new Error("INVALID_PAYABLE_DAYS");
  if (payableDays === 0) return 0;
  return roundMoney((monthlyAmount * payableDays) / standardPayableDays, precision);
}

/** Inclusive calendar-day count between YYYY-MM-DD dates. */
export function inclusiveCalendarDays(startDate: string, endDate: string): number {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (start > end) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export type CompSegmentInput = {
  compensation_version_id: string;
  effective_from: string;
  effective_to: string | null;
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
};

export type ResolvedSegment = CompSegmentInput & {
  segment_start: string;
  segment_end: string;
  payable_days: number;
  monthly_gross: number;
  segment_gross: number;
  daily_rate: number;
};

/**
 * Resolve compensation versions overlapping [periodStart, periodEnd] ∩ [eligibleStart, eligibleEnd].
 * Versions must be ordered by effective_from ascending.
 *
 * Full-period eligibility (eligible covers the entire payroll period):
 *   payable_days = standardPayableDays * segmentCalendar / periodCalendar
 *   → full-month employee receives exactly monthly_gross (not ×31/30 or ×28/30).
 *
 * Partial employment:
 *   payable_days = inclusive calendar days in the segment.
 */
export function resolveCompensationSegments(input: {
  periodStart: string;
  periodEnd: string;
  eligibleStart: string;
  eligibleEnd: string;
  versions: CompSegmentInput[];
  standardPayableDays: number;
  precision?: number;
}): ResolvedSegment[] {
  const precision = input.precision ?? 2;
  const windowStart = maxDate(input.periodStart, input.eligibleStart);
  const windowEnd = minDate(input.periodEnd, input.eligibleEnd);
  if (windowStart > windowEnd) return [];

  const periodCalendar = inclusiveCalendarDays(input.periodStart, input.periodEnd);
  const fullPeriod =
    input.eligibleStart === input.periodStart && input.eligibleEnd === input.periodEnd;

  const out: ResolvedSegment[] = [];
  for (const v of input.versions) {
    const segStart = maxDate(windowStart, v.effective_from);
    const segEnd = minDate(windowEnd, v.effective_to ?? input.periodEnd);
    if (segStart > segEnd) continue;
    const segmentCalendar = inclusiveCalendarDays(segStart, segEnd);
    const days =
      fullPeriod && periodCalendar > 0
        ? (input.standardPayableDays * segmentCalendar) / periodCalendar
        : segmentCalendar;
    const gross = monthlyGross(v);
    out.push({
      ...v,
      segment_start: segStart,
      segment_end: segEnd,
      payable_days: days,
      monthly_gross: gross,
      segment_gross: prorateAmount(gross, days, input.standardPayableDays, precision),
      daily_rate: dailyRate(gross, input.standardPayableDays, precision),
    });
  }
  return out;
}

export function weightedDailyRate(segments: ResolvedSegment[], precision = 2): Money {
  const totalDays = segments.reduce((s, x) => s + x.payable_days, 0);
  if (totalDays <= 0) return 0;
  const totalGross = segments.reduce((s, x) => s + x.segment_gross, 0);
  return roundMoney(totalGross / totalDays, precision);
}

export function unpaidLeaveDeduction(
  unpaidDays: number,
  rate: number,
  precision = 2,
): Money {
  if (unpaidDays <= 0) return 0;
  return roundMoney(rate * unpaidDays, precision);
}

export function absenceDeduction(input: {
  absentDays: number;
  unpaidLeaveDays: number;
  dailyRate: number;
  enabled: boolean;
  precision?: number;
}): Money {
  if (!input.enabled) return 0;
  const precision = input.precision ?? 2;
  const billable = Math.max(0, input.absentDays - input.unpaidLeaveDays);
  if (billable <= 0) return 0;
  return roundMoney(input.dailyRate * billable, precision);
}

export function computeNetPay(input: {
  grossPay: number;
  totalDeductions: number;
  precision?: number;
}): Money {
  const precision = input.precision ?? 2;
  return roundMoney(input.grossPay - input.totalDeductions, precision);
}

/** Eligible employment window from employee + contract dates. */
export function resolveEligibleWindow(input: {
  periodStart: string;
  periodEnd: string;
  joiningDate: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  terminatedAt: string | null; // date or timestamptz ISO
  employmentStatus: string;
}): { eligible: boolean; start: string; end: string; reason?: string } {
  if (input.employmentStatus === "terminated" || input.employmentStatus === "resigned") {
    // Still eligible for days before termination within period
  }
  const startCandidates = [input.periodStart];
  if (input.joiningDate) startCandidates.push(input.joiningDate.slice(0, 10));
  if (input.contractStart) startCandidates.push(input.contractStart.slice(0, 10));
  const start = startCandidates.reduce((a, b) => maxDate(a, b));

  const endCandidates = [input.periodEnd];
  if (input.contractEnd) endCandidates.push(input.contractEnd.slice(0, 10));
  if (input.terminatedAt) endCandidates.push(input.terminatedAt.slice(0, 10));
  const end = endCandidates.reduce((a, b) => minDate(a, b));

  if (start > end) {
    return { eligible: false, start, end, reason: "NO_OVERLAP" };
  }
  return { eligible: true, start, end };
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
