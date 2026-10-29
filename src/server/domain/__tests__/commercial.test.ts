import { describe, expect, it } from "vitest";
import {
  aggregateCashflowByPeriod,
  budgetVariance,
  canRecordPayment,
  computeCommercialHealth,
  evaluateInvoiceMatchFlags,
  grossMargin,
  grossWithVat,
  lineTotal,
  remainingBalance,
  receivableAgeBucket,
  RECEIVABLE_AGE_LABELS,
  revisedContractValue,
  invoiceFitsCertified,
  valuationInvoiceCapacity,
  valuationTaxableBase,
  valuationVatRate,
  vatAmount,
} from "../commercial";

describe("commercial domain", () => {
  it("computes line totals and VAT with 2dp rounding", () => {
    expect(lineTotal(3, 10.333)).toBe(31);
    expect(vatAmount(1000, 15)).toBe(150);
    expect(grossWithVat(1000, 15)).toBe(1150);
  });

  it("payment remaining and overpayment guard", () => {
    expect(remainingBalance(1000, 250)).toBe(750);
    expect(canRecordPayment(1000, 900, 100)).toBe(true);
    expect(canRecordPayment(1000, 900, 100.01)).toBe(false);
    expect(canRecordPayment(1000, 0, 0)).toBe(false);
  });

  it("budget variance and revised contract / margin", () => {
    expect(budgetVariance(100000, 85000)).toBe(15000);
    expect(revisedContractValue(500000, 25000)).toBe(525000);
    expect(grossMargin(525000, 480000)).toBe(45000);
  });

  it("commercial health rules", () => {
    expect(
      computeCommercialHealth({
        committed: 120,
        revisedBudget: 100,
        margin: 10,
        overdueApCount: 0,
        overdueArCount: 0,
        unapprovedVoStaleCount: 0,
      }),
    ).toBe("red");

    expect(
      computeCommercialHealth({
        committed: 95,
        revisedBudget: 100,
        margin: 5,
        overdueApCount: 1,
        overdueArCount: 0,
        unapprovedVoStaleCount: 0,
      }),
    ).toBe("amber");

    expect(
      computeCommercialHealth({
        committed: 50,
        revisedBudget: 100,
        margin: 20,
        overdueApCount: 0,
        overdueArCount: 0,
        unapprovedVoStaleCount: 0,
      }),
    ).toBe("green");
  });

  it("invoice match flags", () => {
    expect(evaluateInvoiceMatchFlags({ invoiceTotal: 100, poTotal: null, hasReceipt: false })).toEqual([
      { code: "missing_po", severity: "medium" },
    ]);
    const flags = evaluateInvoiceMatchFlags({ invoiceTotal: 200, poTotal: 100, hasReceipt: false });
    expect(flags.some((f) => f.code === "invoice_gt_po")).toBe(true);
  });

  it("aggregates cashflow by month", () => {
    const agg = aggregateCashflowByPeriod([
      { direction: "inflow", amount: 1000, periodDate: "2026-08-10" },
      { direction: "outflow", amount: 400, periodDate: "2026-08-15" },
      { direction: "inflow", amount: 200, periodDate: "2026-09-01" },
    ]);
    expect(agg["2026-08"]).toEqual({ inflow: 1000, outflow: 400, net: 600 });
    expect(agg["2026-09"].net).toBe(200);
  });

  it("computes receivable ageing buckets from due date", () => {
    const today = new Date("2026-03-15T12:00:00Z");
    expect(receivableAgeBucket("2026-03-20", today)).toBe("current");
    expect(receivableAgeBucket("2026-03-01", today)).toBe("1_30");
    expect(receivableAgeBucket("2026-01-20", today)).toBe("31_60");
    expect(receivableAgeBucket("2025-12-20", today)).toBe("61_90");
    expect(receivableAgeBucket("2025-10-01", today)).toBe("90_plus");
    expect(RECEIVABLE_AGE_LABELS["90_plus"]).toContain("90");
  });
});

describe("client invoice from valuation", () => {
  const val = { certified_amount: 92000, total_claim: 92000, current_claim_amount: 80000, vat_amount: 12000 };

  it("pre-fills the pre-VAT amount, not the VAT-inclusive certified amount", () => {
    expect(valuationVatRate(val)).toBe(15);
    expect(valuationTaxableBase(val)).toBe(80000);
    expect(grossWithVat(valuationTaxableBase(val), valuationVatRate(val))).toBe(92000);
  });

  it("scales partial certification to its net-of-VAT share", () => {
    expect(valuationTaxableBase({ ...val, certified_amount: 46000 })).toBe(40000);
    expect(valuationTaxableBase({ ...val, certified_amount: 0 })).toBe(0);
  });

  it("falls back to net claim or 15% when columns are missing", () => {
    expect(valuationTaxableBase({ certified_amount: null, current_claim_amount: "80000", total_claim: 92000 })).toBe(80000);
    expect(valuationTaxableBase({ certified_amount: 1150 })).toBe(1000);
    expect(valuationVatRate({})).toBe(15);
  });

  it("rejects an invoice whose total exceeds the remaining certified amount", () => {
    expect(invoiceFitsCertified(92000, 92000)).toBe(true);
    expect(invoiceFitsCertified(105800, 92000)).toBe(false);
    expect(invoiceFitsCertified(50000, 92000, 46000)).toBe(false);
    expect(invoiceFitsCertified(46000, 92000, 46000)).toBe(true);
    expect(valuationInvoiceCapacity(92000, 100000)).toBe(0);
  });
});
