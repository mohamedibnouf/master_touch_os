import { describe, expect, it } from "vitest";
import { classifyPayrollRpcError, payrollReviewControls } from "./review-controls";
import { isPayslipVisibleStatus } from "./payslip-visibility";

const base = {
  status: "under_review" as const,
  reviewedAt: null as string | null,
  reviewedBy: null as string | null,
  viewerProfileId: "approver",
  canReviewPermission: true,
  canApprovePermission: true,
};

describe("payrollReviewControls", () => {
  it("before review: can review, cannot approve (needs review)", () => {
    const c = payrollReviewControls(base);
    expect(c.canReview).toBe(true);
    expect(c.canApprove).toBe(false);
    expect(c.approveBlockedReason).toBe("not_reviewed");
  });

  it("reviewed by someone else: approver can approve, review button hidden", () => {
    const c = payrollReviewControls({ ...base, reviewedAt: "2026-10-29T08:00:00Z", reviewedBy: "reviewer" });
    expect(c.canReview).toBe(false);
    expect(c.canApprove).toBe(true);
    expect(c.approveBlockedReason).toBeNull();
  });

  it("reviewed by the viewer: cannot approve their own review", () => {
    const c = payrollReviewControls({ ...base, reviewedAt: "2026-10-29T08:00:00Z", reviewedBy: "approver" });
    expect(c.canApprove).toBe(false);
    expect(c.approveBlockedReason).toBe("self_reviewed");
  });

  it("not under review: nothing to do", () => {
    const c = payrollReviewControls({ ...base, status: "approved" });
    expect(c).toEqual({ canReview: false, canApprove: false, approveBlockedReason: null, isReviewed: false });
  });

  it("no approve permission: no blocked hint", () => {
    const c = payrollReviewControls({ ...base, canApprovePermission: false });
    expect(c.approveBlockedReason).toBeNull();
  });
});

describe("classifyPayrollRpcError", () => {
  it("maps 089 guard tokens", () => {
    expect(classifyPayrollRpcError("PAYROLL_NOT_REVIEWED")).toBe("notReviewed");
    expect(classifyPayrollRpcError("PAYROLL_SELF_APPROVAL")).toBe("selfApproval");
    expect(classifyPayrollRpcError("PAYROLL_NET_NEGATIVE")).toBe("netNegative");
    expect(classifyPayrollRpcError("PAYMENT_AMOUNT_MISMATCH")).toBe("amountMismatch");
    expect(classifyPayrollRpcError("INVALID_STATUS")).toBe("invalidStatus");
    expect(classifyPayrollRpcError("duplicate key")).toBeNull();
    expect(classifyPayrollRpcError(undefined)).toBeNull();
  });
});

describe("isPayslipVisibleStatus", () => {
  it("only locked and paid periods are visible as payslips", () => {
    expect(isPayslipVisibleStatus("locked")).toBe(true);
    expect(isPayslipVisibleStatus("paid")).toBe(true);
    for (const s of ["draft", "calculated", "under_review", "approved", "cancelled", null]) {
      expect(isPayslipVisibleStatus(s)).toBe(false);
    }
  });
});
