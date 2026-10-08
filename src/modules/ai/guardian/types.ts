import type { ManagementRiskCategory, ManagementRiskSeverity } from "@/modules/management/types";
import type { RiskSourceType } from "@/modules/management/risk/types";

export type GuardianFindingStatus = "open" | "acknowledged" | "in_review" | "resolved" | "dismissed";
export type GuardianDetector = "rule" | "model";

export type DurableFinding = {
  id: string;
  organizationId: string;
  sourceType: RiskSourceType;
  sourceId: string;
  ruleId: string;
  category: ManagementRiskCategory;
  severity: ManagementRiskSeverity;
  titleAr: string;
  titleEn: string;
  explanationAr: string;
  explanationEn: string;
  recommendedActionAr: string;
  evidence: Record<string, string | number | boolean | null>;
  href: string | null;
  status: GuardianFindingStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  assignedReviewerId: string | null;
  reviewNote: string | null;
  dedupKey: string;
  detectionVersion: string;
  detector: GuardianDetector;
  escalationCount: number;
  lastInAppNotifiedAt: string | null;
  lastEmailNotifiedAt: string | null;
};

export type GuardianScanCoverage = {
  complete: boolean;
  truncatedFamilies: string[];
};

export type JobClaimDecision = "run" | "skip_completed" | "skip_running" | "takeover";
