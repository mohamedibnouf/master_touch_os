/**
 * Phase 5.1–5.2 management intelligence DTOs.
 * Attention items are summaries of deterministic RiskFinding rows (Phase 5.2).
 */

import type { RiskFinding } from "./risk/types";

export type ManagementRiskCategory =
  | "PROJECT_DELAY"
  | "APPROVAL_DELAY"
  | "PROCUREMENT"
  | "COMMERCIAL"
  | "HR"
  | "ATTENDANCE"
  | "LEAVE"
  | "PAYROLL"
  | "COMPLIANCE";

export type ManagementRiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ManagementAttentionItem = {
  id: string;
  category: ManagementRiskCategory;
  severity: ManagementRiskSeverity;
  titleAr: string;
  titleEn: string;
  reasonAr: string;
  reasonEn: string;
  count: number;
  href: string;
};

export type ManagementMetric = {
  key: string;
  labelAr: string;
  labelEn: string;
  value: number | string;
  href?: string;
  /** When true, value is a money amount and must only be shown with finance perms. */
  isMoney?: boolean;
};

export type ManagementSectionFlags = {
  projects: boolean;
  approvals: boolean;
  procurement: boolean;
  purchaseRequests: boolean;
  rfqs: boolean;
  purchaseOrders: boolean;
  supplierInvoices: boolean;
  finance: boolean;
  people: boolean;
  employeeHeadcount: boolean;
  compliance: boolean;
  contracts: boolean;
  attendanceLeave: boolean;
  payroll: boolean;
  /** Show payroll period totals (gross/net) — requires payroll.view_all */
  payrollAmounts: boolean;
  activity: boolean;
};

export type ManagementSnapshot = {
  asOfDate: string;
  /** Per-source deterministic findings (canonical Phase 5.2 risk engine). */
  risks: RiskFinding[];
  /** Aggregated attention rows (one per ruleId) derived from `risks`. */
  attention: ManagementAttentionItem[];
  projects: {
    active: number;
    atRisk: number;
    onHold: number;
    overduePlannedEnd: number;
  };
  approvals: {
    pending: number;
    overdue: number;
    assignedToMe: number;
    recentlyRejected: number;
  };
  procurement: {
    prAwaitingReview: number;
    rfqIssued: number;
    rfqNeedsComparison: number;
    poReadyToIssue: number;
    lateDeliveries: number;
    invoicesAwaitingReview: number;
  };
  commercial: {
    outstandingAr: number;
    overdueAr: number;
    overdueAp: number;
    pendingValuations: number;
    openVariations: number;
  } | null;
  people: {
    activeEmployees: number;
    complianceExpiring30d: number;
    contractsEnding30d: number;
    onLeaveToday: number;
  } | null;
  attendance: {
    present: number;
    late: number;
    absent: number;
    missingCheckout: number;
    pendingLeaveApprovals: number;
  } | null;
  payroll: {
    underReview: number;
    approvedAwaitingLock: number;
    lockedUnpaidEntries: number;
    latestLabel: string | null;
    latestStatus: string | null;
    latestEmployeeCount: number | null;
    latestNet: number | null;
  } | null;
  activity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string;
  }>;
};
