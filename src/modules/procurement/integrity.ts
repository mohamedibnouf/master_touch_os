/**
 * App-side integrity guards for procurement and commercial actions.
 * The database (migration 090) enforces the same rules; these checks give the
 * user a clear localized message before the RPC refuses with a generic error.
 */

const QTY_TOLERANCE = 0.0001;

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Variation statuses from which approve_variation may run (draft must be submitted first). */
export const VARIATION_APPROVABLE_STATUSES = ["under_review", "submitted", "negotiation"] as const;

export function isVariationApprovable(status: string | null | undefined): boolean {
  return Boolean(status && (VARIATION_APPROVABLE_STATUSES as readonly string[]).includes(status));
}

/** Only a draft variation may be submitted for approval (re-submitting would open a second request). */
export function isVariationSubmittable(status: string | null | undefined): boolean {
  return status === "draft";
}

/** Supplier invoice statuses that accept payments (mirrors record_supplier_payment in 090). */
export const SUPPLIER_INVOICE_PAYABLE_STATUSES = ["approved_for_payment", "partially_paid"] as const;

export function isSupplierInvoicePayable(status: string | null | undefined): boolean {
  return Boolean(status && (SUPPLIER_INVOICE_PAYABLE_STATUSES as readonly string[]).includes(status));
}

/** Supplier invoice statuses that may still be approved for payment. */
export const SUPPLIER_INVOICE_APPROVABLE_STATUSES = ["received", "under_review", "matched", "discrepancy"] as const;

export function isSupplierInvoiceApprovable(status: string | null | undefined): boolean {
  return Boolean(status && (SUPPLIER_INVOICE_APPROVABLE_STATUSES as readonly string[]).includes(status));
}

/** PO statuses a supplier invoice may be booked against (issued or later, not closed/cancelled). */
export const PO_INVOICEABLE_STATUSES = [
  "issued",
  "partially_delivered",
  "delivered",
  "partially_invoiced",
  "invoiced",
] as const;

export type SupplierInvoicePoCheck =
  | { ok: true }
  | { ok: false; code: "PO_SUPPLIER_MISMATCH" | "PO_PROJECT_MISMATCH" | "PO_NOT_ISSUED" };

export function checkSupplierInvoiceAgainstPo(input: {
  invoiceSupplierId: string;
  invoiceProjectId: string;
  po: { supplier_id: string; project_id: string; status: string };
}): SupplierInvoicePoCheck {
  if (input.po.supplier_id !== input.invoiceSupplierId) return { ok: false, code: "PO_SUPPLIER_MISMATCH" };
  if (input.po.project_id !== input.invoiceProjectId) return { ok: false, code: "PO_PROJECT_MISMATCH" };
  if (!(PO_INVOICEABLE_STATUSES as readonly string[]).includes(input.po.status)) {
    return { ok: false, code: "PO_NOT_ISSUED" };
  }
  return { ok: true };
}

/** A PO in any status except cancelled consumes its quotation (mirrors the 090 partial unique index). */
export function isQuotationAlreadyOrdered(poStatuses: ReadonlyArray<string | null | undefined>): boolean {
  return poStatuses.some((status) => status !== "cancelled");
}

/** Parses an optional numeric form field; empty / missing / non-numeric → null. */
export function parseOptionalNumber(raw: FormDataEntryValue | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** VAT rate from a form: empty keeps the default (never silently 0); negative / non-numeric → null (invalid). */
export function parseVatRate(raw: FormDataEntryValue | null | undefined, fallback = 15): number | null {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export type GoodsReceiptLineInput = {
  remaining: number;
  received: number | null;
  accepted: number | null;
  rejected: number | null;
};

export type GoodsReceiptLineResult =
  | { ok: true; skip: true }
  | { ok: true; skip: false; received: number; accepted: number; rejected: number }
  | { ok: false; code: "NEGATIVE_QTY" | "EXCEEDS_REMAINING" | "SPLIT_MISMATCH" };

/**
 * Resolves one GRN line. Accepted left empty (or at 0 with nothing explaining the
 * difference) defaults to received − rejected; otherwise accepted + rejected must
 * equal received. Only accepted quantities update the purchase order.
 */
export function resolveGoodsReceiptLine(input: GoodsReceiptLineInput): GoodsReceiptLineResult {
  const received = input.received ?? 0;
  const rejected = input.rejected ?? 0;
  let accepted = input.accepted;

  if (received < 0 || rejected < 0 || (accepted != null && accepted < 0)) {
    return { ok: false, code: "NEGATIVE_QTY" };
  }
  if (received <= 0 && (accepted ?? 0) <= 0 && rejected <= 0) return { ok: true, skip: true };

  if (accepted == null || (accepted === 0 && rejected < received - QTY_TOLERANCE)) {
    accepted = round4(received - rejected);
  }
  if (Math.abs(accepted + rejected - received) > QTY_TOLERANCE || accepted < 0) {
    return { ok: false, code: "SPLIT_MISMATCH" };
  }
  if (received > input.remaining + QTY_TOLERANCE) {
    return { ok: false, code: "EXCEEDS_REMAINING" };
  }
  return { ok: true, skip: false, received, accepted, rejected };
}

/** Sums amounts per currency (never mixes currencies); sorted by currency code. */
export function sumByCurrency(
  rows: ReadonlyArray<{ currency: string | null | undefined; amount: number }>,
  fallbackCurrency = "SAR",
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = (row.currency ?? "").trim() || fallbackCurrency;
    totals.set(currency, round2((totals.get(currency) ?? 0) + row.amount));
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export const COMMERCIAL_INTEGRITY_ERROR = {
  VARIATION_NOT_APPROVABLE: {
    ar: "لا يمكن اعتماد أمر التغيير من حالته الحالية (معتمد أو مرفوض مسبقاً أو لم يُقدَّم بعد).",
    en: "This variation cannot be approved from its current status (already decided or not yet submitted).",
  },
  VARIATION_NOT_SUBMITTABLE: {
    ar: "يمكن تقديم أمر التغيير للاعتماد من حالة المسودة فقط.",
    en: "Only a draft variation can be submitted for approval.",
  },
  VALUATION_NOT_DRAFT: {
    ar: "يمكن تقديم المستخلص للمراجعة من حالة المسودة فقط.",
    en: "Only a draft valuation can be submitted for review.",
  },
  VALUATION_NOT_IN_REVIEW: {
    ar: "المستخلص ليس قيد المراجعة الداخلية.",
    en: "The valuation is not in internal review.",
  },
  INVOICE_NOT_PAYABLE: {
    ar: "لا يمكن تسجيل دفعة إلا لفاتورة معتمدة للدفع أو مدفوعة جزئياً.",
    en: "Payments can only be recorded against invoices approved for payment or partially paid.",
  },
  INVOICE_NOT_APPROVABLE: {
    ar: "لا يمكن اعتماد فاتورة مرفوضة أو ملغاة.",
    en: "A rejected or cancelled invoice cannot be approved.",
  },
  PO_NOT_APPROVED: {
    ar: "لا يمكن إصدار أمر الشراء قبل اعتماده.",
    en: "The purchase order must be approved before it can be issued.",
  },
  PO_SUPPLIER_MISMATCH: {
    ar: "مورد الفاتورة لا يطابق مورد أمر الشراء.",
    en: "The invoice supplier does not match the purchase order supplier.",
  },
  PO_PROJECT_MISMATCH: {
    ar: "مشروع الفاتورة لا يطابق مشروع أمر الشراء.",
    en: "The invoice project does not match the purchase order project.",
  },
  PO_NOT_ISSUED: {
    ar: "لا يمكن ربط الفاتورة إلا بأمر شراء صادر.",
    en: "An invoice can only be linked to an issued purchase order.",
  },
  QUOTATION_ALREADY_ORDERED: {
    ar: "تم إنشاء أمر شراء لهذا العرض مسبقاً.",
    en: "A purchase order already exists for this quotation.",
  },
  QUOTATION_SUPPLIER_NOT_INVITED: {
    ar: "المورد غير مدعو إلى طلب العروض هذا.",
    en: "This supplier was not invited to the RFQ.",
  },
  INVALID_VAT_RATE: { ar: "نسبة الضريبة غير صالحة.", en: "Invalid VAT rate." },
  GRN_NEGATIVE_QTY: { ar: "الكميات لا يمكن أن تكون سالبة.", en: "Quantities cannot be negative." },
  GRN_EXCEEDS_REMAINING: {
    ar: "الكمية المستلمة تتجاوز المتبقي.",
    en: "Received quantity exceeds remaining.",
  },
  GRN_SPLIT_MISMATCH: {
    ar: "يجب أن يساوي المقبول + المرفوض الكمية المستلمة لكل بند.",
    en: "Accepted + rejected must equal the received quantity on every line.",
  },
  GRN_EMPTY: { ar: "أدخل كمية مستلمة لبند واحد على الأقل.", en: "Enter a received quantity for at least one line." },
} as const;
