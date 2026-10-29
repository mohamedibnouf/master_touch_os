/**
 * Unit tests for payroll proration / engine v1 helpers.
 */
import { describe, expect, it } from "vitest";
import {
  absenceDeduction,
  capDeductions,
  computeNetPay,
  dailyRate,
  inclusiveCalendarDays,
  monthlyGross,
  normalizedUnpaidLeaveDays,
  prorateAmount,
  proportionalUnpaidLeaveDeduction,
  resolveCompensationSegments,
  resolveEligibleWindow,
  roundMoney,
  unpaidLeaveDeduction,
  weightedDailyRate,
} from "./proration";

describe("payroll roundMoney", () => {
  it("rounds half-up to 2 decimals", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(10 / 3)).toBe(3.33);
  });
});

describe("payroll proration", () => {
  it("computes monthly gross and daily rate", () => {
    expect(monthlyGross({ basic_salary: 10000, housing_allowance: 2500, transport_allowance: 500, other_allowances: 0 })).toBe(
      13000,
    );
    expect(dailyRate(13000, 30)).toBe(roundMoney(13000 / 30));
  });

  it("prorates join mid-month", () => {
    // 16 days of 30
    expect(prorateAmount(12000, 16, 30)).toBe(roundMoney((12000 * 16) / 30));
  });

  it("prorates contract end mid-month", () => {
    expect(prorateAmount(9000, 10, 30)).toBe(3000);
  });

  it("splits mid-period compensation change into segments", () => {
    const segs = resolveCompensationSegments({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      eligibleStart: "2026-03-01",
      eligibleEnd: "2026-03-31",
      standardPayableDays: 30,
      versions: [
        {
          compensation_version_id: "v1",
          effective_from: "2026-01-01",
          effective_to: "2026-03-15",
          basic_salary: 10000,
          housing_allowance: 0,
          transport_allowance: 0,
          other_allowances: 0,
        },
        {
          compensation_version_id: "v2",
          effective_from: "2026-03-16",
          effective_to: null,
          basic_salary: 12000,
          housing_allowance: 0,
          transport_allowance: 0,
          other_allowances: 0,
        },
      ],
    });
    expect(segs).toHaveLength(2);
    // Full March (31 days): payable normalized onto 30-day basis
    expect(segs[0].payable_days).toBeCloseTo((30 * 15) / 31, 10);
    expect(segs[1].payable_days).toBeCloseTo((30 * 16) / 31, 10);
    expect(segs[0].segment_gross).toBe(prorateAmount(10000, (30 * 15) / 31, 30));
    expect(segs[1].segment_gross).toBe(prorateAmount(12000, (30 * 16) / 31, 30));
  });

  it("full-month employee receives exact monthly gross for Feb/30/31-day months", () => {
    for (const [start, end] of [
      ["2026-02-01", "2026-02-28"],
      ["2026-09-01", "2026-09-30"],
      ["2026-01-01", "2026-01-31"],
    ] as const) {
      const segs = resolveCompensationSegments({
        periodStart: start,
        periodEnd: end,
        eligibleStart: start,
        eligibleEnd: end,
        standardPayableDays: 30,
        versions: [
          {
            compensation_version_id: "x",
            effective_from: "2020-01-01",
            effective_to: null,
            basic_salary: 6000,
            housing_allowance: 0,
            transport_allowance: 0,
            other_allowances: 0,
          },
        ],
      });
      expect(segs).toHaveLength(1);
      expect(segs[0].payable_days).toBe(30);
      expect(segs[0].segment_gross).toBe(6000);
    }
  });

  it("September mid-period 15+15 yields 3000+4500", () => {
    const segs = resolveCompensationSegments({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      eligibleStart: "2026-09-01",
      eligibleEnd: "2026-09-30",
      standardPayableDays: 30,
      versions: [
        {
          compensation_version_id: "A",
          effective_from: "2026-01-01",
          effective_to: "2026-09-15",
          basic_salary: 6000,
          housing_allowance: 0,
          transport_allowance: 0,
          other_allowances: 0,
        },
        {
          compensation_version_id: "B",
          effective_from: "2026-09-16",
          effective_to: null,
          basic_salary: 9000,
          housing_allowance: 0,
          transport_allowance: 0,
          other_allowances: 0,
        },
      ],
    });
    expect(segs[0].payable_days).toBe(15);
    expect(segs[1].payable_days).toBe(15);
    expect(segs[0].segment_gross).toBe(3000);
    expect(segs[1].segment_gross).toBe(4500);
    expect(segs[0].segment_gross + segs[1].segment_gross).toBe(7500);
  });
  it("handles join mid-month eligibility window", () => {
    const w = resolveEligibleWindow({
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      joiningDate: "2026-04-16",
      contractStart: "2026-04-16",
      contractEnd: null,
      terminatedAt: null,
      employmentStatus: "active",
    });
    expect(w.eligible).toBe(true);
    expect(w.start).toBe("2026-04-16");
    expect(inclusiveCalendarDays(w.start, w.end)).toBe(15);
  });

  it("handles contract end mid-month", () => {
    const w = resolveEligibleWindow({
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      joiningDate: "2025-01-01",
      contractStart: "2025-01-01",
      contractEnd: "2026-04-10",
      terminatedAt: null,
      employmentStatus: "active",
    });
    expect(w.eligible).toBe(true);
    expect(w.end).toBe("2026-04-10");
  });
});

describe("payroll leave and attendance deductions", () => {
  it("does not deduct for paid leave conceptually (caller passes unpaid days only)", () => {
    expect(unpaidLeaveDeduction(0, 400)).toBe(0);
  });

  it("deducts unpaid leave days", () => {
    expect(unpaidLeaveDeduction(3, 400)).toBe(1200);
  });

  it("attendance deduction disabled → zero", () => {
    expect(
      absenceDeduction({
        absentDays: 2,
        unpaidLeaveDays: 0,
        dailyRate: 400,
        enabled: false,
      }),
    ).toBe(0);
  });

  // Business rule changed in 089: reconciliation (057) already marks approved
  // leave days as on_leave, so absent days never overlap unpaid leave. The old
  // "absent - unpaid_leave" subtraction let 5 absences + 5 unpaid days deduct 0.
  it("absence deduction bills every absent day, independent of unpaid leave", () => {
    expect(
      absenceDeduction({
        absentDays: 5,
        unpaidLeaveDays: 5,
        dailyRate: 400,
        enabled: true,
      }),
    ).toBe(2000); // 5 * 400 (was 0 before 089)
  });
});

describe("payroll unpaid leave normalisation (089)", () => {
  const base = { standardPayableDays: 30, payableDays: 30, fullPeriod: true };

  it("a full unpaid 31-day month maps to exactly the 30 payable days", () => {
    expect(normalizedUnpaidLeaveDays({ ...base, unpaidCalendarDays: 31, periodCalendarDays: 31 })).toBe(30);
  });

  it("a full unpaid February maps to 30 payable days (no 2 paid days left)", () => {
    expect(normalizedUnpaidLeaveDays({ ...base, unpaidCalendarDays: 28, periodCalendarDays: 28 })).toBe(30);
    expect(normalizedUnpaidLeaveDays({ ...base, unpaidCalendarDays: 29, periodCalendarDays: 29 })).toBe(30);
  });

  it("partial unpaid leave in a full period is scaled to the 30-day basis", () => {
    expect(normalizedUnpaidLeaveDays({ ...base, unpaidCalendarDays: 15, periodCalendarDays: 30 })).toBe(15);
    expect(normalizedUnpaidLeaveDays({ ...base, unpaidCalendarDays: 14, periodCalendarDays: 28 })).toBe(15);
  });

  it("partial-period employees keep calendar days, capped at payable days", () => {
    expect(
      normalizedUnpaidLeaveDays({
        unpaidCalendarDays: 10,
        fullPeriod: false,
        periodCalendarDays: 31,
        standardPayableDays: 30,
        payableDays: 16,
      }),
    ).toBe(10);
    expect(
      normalizedUnpaidLeaveDays({
        unpaidCalendarDays: 20,
        fullPeriod: false,
        periodCalendarDays: 31,
        standardPayableDays: 30,
        payableDays: 16,
      }),
    ).toBe(16);
  });

  it("full unpaid month deducts exactly the gross, so net is 0 (not negative)", () => {
    const gross = 9300;
    const unpaid = normalizedUnpaidLeaveDays({ ...base, unpaidCalendarDays: 31, periodCalendarDays: 31 });
    const deduction = proportionalUnpaidLeaveDeduction({ grossRecurring: gross, unpaidPayableDays: unpaid, payableDays: 30 });
    expect(deduction).toBe(gross);
    expect(computeNetPay({ grossPay: gross, totalDeductions: deduction })).toBe(0);
  });

  it("proportional deduction for part of the month", () => {
    expect(proportionalUnpaidLeaveDeduction({ grossRecurring: 9000, unpaidPayableDays: 10, payableDays: 30 })).toBe(3000);
    expect(proportionalUnpaidLeaveDeduction({ grossRecurring: 9000, unpaidPayableDays: 0, payableDays: 30 })).toBe(0);
  });
});

describe("payroll deduction caps (089)", () => {
  it("caps calculated deductions at the remaining amount, in order", () => {
    expect(capDeductions(1000, [600, 600, 100])).toEqual([600, 400, 0]);
  });

  it("never returns negative amounts when nothing is available", () => {
    expect(capDeductions(-50, [10, 20])).toEqual([0, 0]);
  });
});

describe("payroll net pay", () => {
  it("computes net from gross and deductions", () => {
    expect(computeNetPay({ grossPay: 10000, totalDeductions: 1500 })).toBe(8500);
  });

  it("clamps net pay at zero", () => {
    expect(computeNetPay({ grossPay: 1000, totalDeductions: 1200 })).toBe(0);
  });

  it("weighted daily rate across segments", () => {
    const segs = resolveCompensationSegments({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      eligibleStart: "2026-03-01",
      eligibleEnd: "2026-03-31",
      standardPayableDays: 30,
      versions: [
        {
          compensation_version_id: "v1",
          effective_from: "2026-01-01",
          effective_to: "2026-03-15",
          basic_salary: 9000,
          housing_allowance: 0,
          transport_allowance: 0,
          other_allowances: 0,
        },
        {
          compensation_version_id: "v2",
          effective_from: "2026-03-16",
          effective_to: null,
          basic_salary: 12000,
          housing_allowance: 0,
          transport_allowance: 0,
          other_allowances: 0,
        },
      ],
    });
    const rate = weightedDailyRate(segs);
    const totalGross = segs.reduce((s, x) => s + x.segment_gross, 0);
    const totalDays = segs.reduce((s, x) => s + x.payable_days, 0);
    expect(rate).toBe(roundMoney(totalGross / totalDays));
  });
});
