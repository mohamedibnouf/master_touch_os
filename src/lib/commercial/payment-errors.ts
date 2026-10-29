/**
 * Maps the stable domain error codes raised by the payment RPCs
 * (record_supplier_payment / record_client_payment, migrations 050/051) to
 * localized user messages. Returns null for anything else.
 */
export type PaymentErrorCopy = { kind: "validation" | "conflict"; ar: string; en: string };

type PgLikeError = { message?: string | null; details?: string | null } | null | undefined;

const PAYMENT_ERRORS: Array<{ code: string; copy: PaymentErrorCopy }> = [
  {
    code: "SUPPLIER_PAYMENT_EXCEEDS_INVOICE",
    copy: {
      kind: "validation",
      ar: "مبلغ الدفعة أكبر من المتبقي على الفاتورة. أدخل مبلغاً لا يتجاوز الرصيد المتبقي.",
      en: "The payment is larger than the invoice's remaining balance. Enter an amount up to the remaining balance.",
    },
  },
  {
    code: "CLIENT_PAYMENT_EXCEEDS_OUTSTANDING",
    copy: {
      kind: "validation",
      ar: "مبلغ التحصيل أكبر من المتبقي على الفاتورة. أدخل مبلغاً لا يتجاوز الرصيد المتبقي.",
      en: "The collection is larger than the invoice's remaining balance. Enter an amount up to the remaining balance.",
    },
  },
  {
    code: "CLIENT_PAYMENT_DUPLICATE_REFERENCE",
    copy: {
      kind: "conflict",
      ar: "مرجع التحصيل مستخدم مسبقاً. أدخل مرجعاً مختلفاً.",
      en: "This payment reference is already used. Enter a different reference.",
    },
  },
  {
    code: "SUPPLIER_INVOICE_NOT_PAYABLE",
    copy: {
      kind: "conflict",
      ar: "لا يمكن تسجيل دفعة إلا لفاتورة معتمدة للدفع أو مدفوعة جزئياً.",
      en: "Payments can only be recorded against invoices approved for payment or partially paid.",
    },
  },
  {
    code: "CLIENT_INVOICE_NOT_PAYABLE",
    copy: {
      kind: "conflict",
      ar: "لا يمكن تسجيل تحصيل على فاتورة غير صادرة.",
      en: "Payments can only be recorded against issued invoices.",
    },
  },
];

export function paymentErrorCopy(error: PgLikeError): PaymentErrorCopy | null {
  if (!error) return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  for (const entry of PAYMENT_ERRORS) {
    if (text.includes(entry.code)) return entry.copy;
  }
  return null;
}
