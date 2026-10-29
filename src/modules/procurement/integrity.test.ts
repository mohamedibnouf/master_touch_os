import { describe, expect, it } from "vitest";
import {
  checkSupplierInvoiceAgainstPo,
  isQuotationAlreadyOrdered,
  isSupplierInvoiceApprovable,
  isSupplierInvoicePayable,
  isVariationApprovable,
  isVariationSubmittable,
  parseOptionalNumber,
  parseVatRate,
  resolveGoodsReceiptLine,
  sumByCurrency,
} from "./integrity";

describe("variation status guards", () => {
  it("approves only submitted / under_review / negotiation", () => {
    for (const s of ["under_review", "submitted", "negotiation"]) expect(isVariationApprovable(s)).toBe(true);
    for (const s of ["draft", "approved", "partially_approved", "rejected", "cancelled", null]) {
      expect(isVariationApprovable(s)).toBe(false);
    }
  });

  it("submits only drafts (no double request on resubmit)", () => {
    expect(isVariationSubmittable("draft")).toBe(true);
    expect(isVariationSubmittable("under_review")).toBe(false);
    expect(isVariationSubmittable("approved")).toBe(false);
  });
});

describe("supplier invoice guards", () => {
  it("pays only approved_for_payment / partially_paid", () => {
    expect(isSupplierInvoicePayable("approved_for_payment")).toBe(true);
    expect(isSupplierInvoicePayable("partially_paid")).toBe(true);
    for (const s of ["received", "discrepancy", "rejected", "cancelled", "paid", "matched"]) {
      expect(isSupplierInvoicePayable(s)).toBe(false);
    }
  });

  it("does not approve rejected / cancelled / paid invoices", () => {
    expect(isSupplierInvoiceApprovable("discrepancy")).toBe(true);
    for (const s of ["rejected", "cancelled", "paid", "approved_for_payment"]) {
      expect(isSupplierInvoiceApprovable(s)).toBe(false);
    }
  });

  const po = { supplier_id: "s1", project_id: "p1", status: "issued" };
  it("requires the same supplier, project and an issued-or-later PO", () => {
    expect(checkSupplierInvoiceAgainstPo({ invoiceSupplierId: "s1", invoiceProjectId: "p1", po })).toEqual({ ok: true });
    expect(checkSupplierInvoiceAgainstPo({ invoiceSupplierId: "s2", invoiceProjectId: "p1", po })).toEqual({
      ok: false,
      code: "PO_SUPPLIER_MISMATCH",
    });
    expect(checkSupplierInvoiceAgainstPo({ invoiceSupplierId: "s1", invoiceProjectId: "p2", po })).toEqual({
      ok: false,
      code: "PO_PROJECT_MISMATCH",
    });
    for (const status of ["draft", "pending_approval", "approved", "cancelled", "closed"]) {
      expect(
        checkSupplierInvoiceAgainstPo({ invoiceSupplierId: "s1", invoiceProjectId: "p1", po: { ...po, status } }),
      ).toEqual({ ok: false, code: "PO_NOT_ISSUED" });
    }
  });
});

describe("quotation → PO uniqueness", () => {
  it("cancelled POs release the quotation", () => {
    expect(isQuotationAlreadyOrdered([])).toBe(false);
    expect(isQuotationAlreadyOrdered(["cancelled"])).toBe(false);
    expect(isQuotationAlreadyOrdered(["cancelled", "draft"])).toBe(true);
    expect(isQuotationAlreadyOrdered(["issued"])).toBe(true);
  });
});

describe("form number parsing", () => {
  it("empty VAT keeps the default instead of becoming 0", () => {
    expect(parseVatRate("")).toBe(15);
    expect(parseVatRate(null)).toBe(15);
    expect(parseVatRate("  ")).toBe(15);
    expect(parseVatRate("0")).toBe(0);
    expect(parseVatRate("5")).toBe(5);
    expect(parseVatRate("-1")).toBeNull();
    expect(parseVatRate("abc")).toBeNull();
    expect(parseVatRate("150")).toBeNull();
  });

  it("parseOptionalNumber distinguishes empty from 0", () => {
    expect(parseOptionalNumber("")).toBeNull();
    expect(parseOptionalNumber(null)).toBeNull();
    expect(parseOptionalNumber("0")).toBe(0);
    expect(parseOptionalNumber("2.5")).toBe(2.5);
    expect(parseOptionalNumber("x")).toBeNull();
  });
});

describe("resolveGoodsReceiptLine", () => {
  it("skips untouched lines", () => {
    expect(resolveGoodsReceiptLine({ remaining: 5, received: 0, accepted: 0, rejected: 0 })).toEqual({ ok: true, skip: true });
    expect(resolveGoodsReceiptLine({ remaining: 5, received: null, accepted: null, rejected: null })).toEqual({
      ok: true,
      skip: true,
    });
  });

  it("received 10 / accepted empty → accepts 10", () => {
    expect(resolveGoodsReceiptLine({ remaining: 10, received: 10, accepted: null, rejected: null })).toEqual({
      ok: true,
      skip: false,
      received: 10,
      accepted: 10,
      rejected: 0,
    });
  });

  it("received 10 / accepted 0 / rejected 0 (old form default) → accepts 10", () => {
    expect(resolveGoodsReceiptLine({ remaining: 10, received: 10, accepted: 0, rejected: 0 })).toMatchObject({
      ok: true,
      accepted: 10,
    });
  });

  it("received 10 / rejected 3 → accepts 7", () => {
    expect(resolveGoodsReceiptLine({ remaining: 10, received: 10, accepted: null, rejected: 3 })).toMatchObject({
      ok: true,
      accepted: 7,
      rejected: 3,
    });
  });

  it("all rejected is valid with accepted 0", () => {
    expect(resolveGoodsReceiptLine({ remaining: 10, received: 4, accepted: 0, rejected: 4 })).toMatchObject({
      ok: true,
      accepted: 0,
      rejected: 4,
    });
  });

  it("rejects inconsistent splits", () => {
    expect(resolveGoodsReceiptLine({ remaining: 10, received: 10, accepted: 8, rejected: 3 })).toEqual({
      ok: false,
      code: "SPLIT_MISMATCH",
    });
    expect(resolveGoodsReceiptLine({ remaining: 10, received: 0, accepted: 5, rejected: 0 })).toEqual({
      ok: false,
      code: "SPLIT_MISMATCH",
    });
    expect(resolveGoodsReceiptLine({ remaining: 10, received: 2, accepted: null, rejected: 5 })).toEqual({
      ok: false,
      code: "SPLIT_MISMATCH",
    });
  });

  it("blocks over-receipt and negatives", () => {
    expect(resolveGoodsReceiptLine({ remaining: 5, received: 6, accepted: null, rejected: null })).toEqual({
      ok: false,
      code: "EXCEEDS_REMAINING",
    });
    expect(resolveGoodsReceiptLine({ remaining: 5, received: -1, accepted: null, rejected: null })).toEqual({
      ok: false,
      code: "NEGATIVE_QTY",
    });
  });
});

describe("sumByCurrency", () => {
  it("never adds different currencies together", () => {
    expect(
      sumByCurrency([
        { currency: "SAR", amount: 100.1 },
        { currency: "USD", amount: 50 },
        { currency: "SAR", amount: 0.2 },
        { currency: null, amount: 1 },
      ]),
    ).toEqual([
      { currency: "SAR", amount: 101.3 },
      { currency: "USD", amount: 50 },
    ]);
  });

  it("returns an empty list when there is nothing", () => {
    expect(sumByCurrency([])).toEqual([]);
  });
});
