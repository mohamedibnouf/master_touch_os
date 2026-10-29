/**
 * Phase 3 commercial domain helpers — decimal-safe arithmetic via string/number
 * rounding to 2dp. Authoritative money lives in PostgreSQL NUMERIC; these
 * helpers mirror documented formulas for UI/unit tests.
 */

export function roundMoney(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function lineTotal(quantity: number, unitPrice: number): number {
  return roundMoney(quantity * unitPrice);
}

export function vatAmount(taxable: number, ratePercent: number): number {
  return roundMoney(taxable * (ratePercent / 100));
}

export function grossWithVat(taxable: number, ratePercent: number): number {
  return roundMoney(taxable + vatAmount(taxable, ratePercent));
}

export function remainingBalance(total: number, paid: number): number {
  return roundMoney(Math.max(0, total - paid));
}

export function canRecordPayment(invoiceTotal: number, alreadyPaid: number, newAmount: number): boolean {
  if (newAmount <= 0) return false;
  return roundMoney(alreadyPaid + newAmount) <= roundMoney(invoiceTotal) + 0.001;
}

export function budgetVariance(currentBudget: number, committed: number): number {
  return roundMoney(currentBudget - committed);
}

export function revisedContractValue(original: number, approvedVariations: number): number {
  return roundMoney(original + approvedVariations);
}

export function grossMargin(revisedRevenue: number, committedCost: number): number {
  return roundMoney(revisedRevenue - committedCost);
}

export type CommercialHealth = "green" | "amber" | "red";

export type CommercialHealthInput = {
  committed: number;
  revisedBudget: number;
  margin: number;
  overdueApCount: number;
  overdueArCount: number;
  unapprovedVoStaleCount: number;
};

/** Mirrors compute_project_commercial_health SQL rules. */
export function computeCommercialHealth(input: CommercialHealthInput): CommercialHealth {
  if (input.revisedBudget > 0 && input.committed > input.revisedBudget) return "red";
  if (input.margin < 0) return "red";
  if (input.overdueArCount >= 3 || input.overdueApCount >= 5) return "red";

  if (input.revisedBudget > 0 && input.committed > input.revisedBudget * 0.9) return "amber";
  if (input.overdueApCount > 0 || input.overdueArCount > 0 || input.unapprovedVoStaleCount > 0) {
    return "amber";
  }
  return "green";
}

export type CashflowLine = { direction: "inflow" | "outflow"; amount: number; periodDate: string };

export function aggregateCashflowByPeriod(lines: CashflowLine[]): Record<string, { inflow: number; outflow: number; net: number }> {
  const map: Record<string, { inflow: number; outflow: number; net: number }> = {};
  for (const line of lines) {
    const key = line.periodDate.slice(0, 7);
    if (!map[key]) map[key] = { inflow: 0, outflow: 0, net: 0 };
    if (line.direction === "inflow") map[key].inflow = roundMoney(map[key].inflow + line.amount);
    else map[key].outflow = roundMoney(map[key].outflow + line.amount);
    map[key].net = roundMoney(map[key].inflow - map[key].outflow);
  }
  return map;
}

export type ReceivableAgeBucket = "current" | "1_30" | "31_60" | "61_90" | "90_plus";

export function receivableAgeBucket(dueDate: string | null, today = new Date()): ReceivableAgeBucket {
  if (!dueDate) return "current";
  const due = new Date(`${dueDate}T00:00:00`);
  const ms = today.getTime() - due.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}

export const RECEIVABLE_AGE_LABELS: Record<ReceivableAgeBucket, string> = {
  current: "جاري",
  "1_30": "1–30 يوم",
  "31_60": "31–60 يوم",
  "61_90": "61–90 يوم",
  "90_plus": "90+ يوم",
};

export type MatchFlag = { code: string; severity: string };

export function evaluateInvoiceMatchFlags(input: {
  invoiceTotal: number;
  poTotal: number | null;
  hasReceipt: boolean;
}): MatchFlag[] {
  const flags: MatchFlag[] = [];
  if (input.poTotal == null) {
    flags.push({ code: "missing_po", severity: "medium" });
    return flags;
  }
  if (input.invoiceTotal > input.poTotal + 0.01) {
    flags.push({ code: "invoice_gt_po", severity: "high" });
  }
  if (!input.hasReceipt) {
    flags.push({ code: "invoice_without_receipt", severity: "medium" });
  }
  return flags;
}

/** VAT-relevant columns of a client valuation (see migrations 049/050). */
export type ValuationBillingAmounts = {
  /** Client-certified amount — VAT-inclusive (capped by `total_claim`). */
  certified_amount?: number | string | null;
  /** Submitted claim including VAT. */
  total_claim?: number | string | null;
  /** Submitted claim net of VAT (pre-VAT). */
  current_claim_amount?: number | string | null;
  vat_amount?: number | string | null;
};

function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * VAT rate (percent) implied by a valuation's submitted claim. Falls back to
 * `fallbackRate` (15%) when the claim has no VAT breakdown.
 */
export function valuationVatRate(val: ValuationBillingAmounts, fallbackRate = 15): number {
  const net = toNum(val.current_claim_amount);
  const vat = toNum(val.vat_amount);
  if (net !== null && net > 0 && vat !== null && vat >= 0) {
    return roundMoney((vat / net) * 100, 3);
  }
  const total = toNum(val.total_claim);
  if (net !== null && net > 0 && total !== null && total >= net) {
    return roundMoney(((total - net) / net) * 100, 3);
  }
  return fallbackRate;
}

/**
 * Pre-VAT (taxable) amount the client invoice for a valuation should start from.
 * `certified_amount` and `total_claim` both include VAT, so the taxable base is the
 * certified amount net of VAT (or the net current claim when nothing is certified yet).
 */
export function valuationTaxableBase(val: ValuationBillingAmounts, fallbackRate = 15): number {
  const certified = toNum(val.certified_amount);
  const total = toNum(val.total_claim);
  const net = toNum(val.current_claim_amount);
  const rate = valuationVatRate(val, fallbackRate);

  if (certified === null) {
    if (net !== null) return roundMoney(Math.max(0, net));
    if (total !== null) return roundMoney(Math.max(0, total / (1 + rate / 100)));
    return 0;
  }
  if (certified <= 0) return 0;
  if (net !== null && total !== null && total > 0) {
    if (certified >= total - 0.001) return roundMoney(net);
    return roundMoney((certified * net) / total);
  }
  return roundMoney(certified / (1 + rate / 100));
}

/** Remaining VAT-inclusive capacity on a valuation after invoices already issued against it. */
export function valuationInvoiceCapacity(certifiedAmount: number, alreadyInvoicedTotal: number): number {
  return roundMoney(Math.max(0, certifiedAmount - alreadyInvoicedTotal));
}

/** True when an invoice total (incl. VAT) fits the valuation's remaining certified capacity. */
export function invoiceFitsCertified(
  invoiceTotal: number,
  certifiedAmount: number,
  alreadyInvoicedTotal = 0,
): boolean {
  return invoiceTotal <= valuationInvoiceCapacity(certifiedAmount, alreadyInvoicedTotal) + 0.001;
}
