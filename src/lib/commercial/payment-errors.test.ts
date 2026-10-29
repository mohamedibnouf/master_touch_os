import { describe, expect, it } from "vitest";
import { paymentErrorCopy } from "./payment-errors";

describe("paymentErrorCopy", () => {
  it("maps over-payment RPC errors to localized validation messages", () => {
    const supplier = paymentErrorCopy({
      message: "SUPPLIER_PAYMENT_EXCEEDS_INVOICE: payment exceeds invoice outstanding amount",
    });
    expect(supplier?.kind).toBe("validation");
    expect(supplier?.en).toMatch(/remaining balance/);
    expect(supplier?.ar).toMatch(/المتبقي/);

    const client = paymentErrorCopy({ message: "CLIENT_PAYMENT_EXCEEDS_OUTSTANDING: payment exceeds" });
    expect(client?.kind).toBe("validation");
  });

  it("maps duplicate reference and non-payable states to conflicts", () => {
    expect(paymentErrorCopy({ message: "CLIENT_PAYMENT_DUPLICATE_REFERENCE: x" })?.kind).toBe("conflict");
    expect(paymentErrorCopy({ message: "CLIENT_INVOICE_NOT_PAYABLE: x" })?.kind).toBe("conflict");
  });

  it("returns null for unrelated errors", () => {
    expect(paymentErrorCopy({ message: "connection reset" })).toBeNull();
    expect(paymentErrorCopy(null)).toBeNull();
  });
});
