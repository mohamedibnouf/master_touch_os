/**
 * Initial management attention thresholds for Phase 5.2.
 * These are NOT contractual SLAs — they are documented product rules for
 * when a condition becomes management-visible / higher severity.
 */
export const MANAGEMENT_RISK_THRESHOLDS = {
  /** Max candidate rows fetched per source family for rule evaluation. */
  candidateLimit: 80,

  /** Max findings returned after sort/dedupe (UI bound). */
  maxFindings: 120,

  /**
   * Approval still pending/in_progress without (or regardless of) due_at.
   * Phrased as "open for N days", not "SLA breached".
   */
  approvalOpenDaysMedium: 3,
  approvalOpenDaysHigh: 7,

  /** Days past planned_end_date for active/on_hold projects. */
  projectOverdueDaysMedium: 1,
  projectOverdueDaysHigh: 14,
  projectOverdueDaysCritical: 30,

  /** Compliance / contract window (inclusive) looking forward. */
  expiryWarningDays: 30,

  /** Purchase request submitted/under_review age. */
  prOpenDaysMedium: 5,
  prOpenDaysHigh: 10,

  /** Valuation / variation pending age. */
  commercialPendingDaysMedium: 7,
  commercialPendingDaysHigh: 14,

  /** Payroll under_review age (period.updated_at or created_at). */
  payrollReviewDaysHigh: 3,
} as const;

export type ManagementRiskThresholds = typeof MANAGEMENT_RISK_THRESHOLDS;
