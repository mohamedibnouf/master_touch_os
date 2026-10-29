/**
 * Payroll maker-checker rules shared by the period/review pages.
 * Mirrors the SQL guards added in migration 089:
 *  - approve_payroll_period requires a completed review (reviewed_at/by set)
 *    performed by a different user than the approver;
 *  - a manual earning/deduction added while under review resets the review.
 */

import type { PayrollPeriodStatus } from "@/types/enums";

export type PayrollApproveBlock = "not_reviewed" | "self_reviewed" | null;

export type PayrollReviewControls = {
  canReview: boolean;
  canApprove: boolean;
  /** Why an approver cannot approve yet (null when approvable or not an approver). */
  approveBlockedReason: PayrollApproveBlock;
  isReviewed: boolean;
};

export function payrollReviewControls(input: {
  status: PayrollPeriodStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  viewerProfileId: string | null | undefined;
  canReviewPermission: boolean;
  canApprovePermission: boolean;
}): PayrollReviewControls {
  const underReview = input.status === "under_review";
  const isReviewed = underReview && Boolean(input.reviewedAt) && Boolean(input.reviewedBy);
  const canReview = input.canReviewPermission && underReview && !isReviewed;

  let approveBlockedReason: PayrollApproveBlock = null;
  if (input.canApprovePermission && underReview) {
    if (!isReviewed) approveBlockedReason = "not_reviewed";
    else if (input.viewerProfileId && input.reviewedBy === input.viewerProfileId) {
      approveBlockedReason = "self_reviewed";
    }
  }
  const canApprove = input.canApprovePermission && underReview && isReviewed && approveBlockedReason === null;

  return { canReview, canApprove, approveBlockedReason, isReviewed };
}

/** SQL error tokens raised by migration 089 payroll guards. */
export const PAYROLL_RPC_ERRORS = {
  notReviewed: "PAYROLL_NOT_REVIEWED",
  selfApproval: "PAYROLL_SELF_APPROVAL",
  netNegative: "PAYROLL_NET_NEGATIVE",
  amountMismatch: "PAYMENT_AMOUNT_MISMATCH",
  invalidStatus: "INVALID_STATUS",
} as const;

export type PayrollRpcErrorKind = keyof typeof PAYROLL_RPC_ERRORS;

/** Classifies a Supabase RPC error message into a known payroll guard, if any. */
export function classifyPayrollRpcError(message: string | null | undefined): PayrollRpcErrorKind | null {
  const text = String(message ?? "");
  for (const [kind, token] of Object.entries(PAYROLL_RPC_ERRORS) as [PayrollRpcErrorKind, string][]) {
    if (text.includes(token)) return kind;
  }
  return null;
}
