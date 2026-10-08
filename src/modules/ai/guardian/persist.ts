import { sanitizeFindingEvidence } from "./redact";
import type { DurableFinding, GuardianFindingStatus } from "./types";
import type { ManagementRiskCategory, ManagementRiskSeverity } from "@/modules/management/types";
import type { RiskSourceType } from "@/modules/management/risk/types";

export type AiFindingRow = {
  id: string;
  organization_id: string;
  source_type: string;
  source_id: string;
  rule_id: string;
  category: string;
  severity: string;
  title_ar: string;
  title_en: string;
  explanation_ar: string;
  explanation_en: string;
  recommended_action_ar: string;
  evidence: Record<string, string | number | boolean | null>;
  href: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  assigned_reviewer_id: string | null;
  review_note: string | null;
  dedup_key: string;
  detection_version: string;
  detector: string;
  escalation_count: number;
  last_in_app_notified_at: string | null;
  last_email_notified_at: string | null;
};

export function rowToFinding(row: AiFindingRow): DurableFinding {
  return {
    id: row.id,
    organizationId: row.organization_id,
    sourceType: row.source_type as RiskSourceType,
    sourceId: row.source_id,
    ruleId: row.rule_id,
    category: row.category as ManagementRiskCategory,
    severity: row.severity as ManagementRiskSeverity,
    titleAr: row.title_ar,
    titleEn: row.title_en,
    explanationAr: row.explanation_ar,
    explanationEn: row.explanation_en,
    recommendedActionAr: row.recommended_action_ar,
    evidence: row.evidence ?? {},
    href: row.href,
    status: row.status as GuardianFindingStatus,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    assignedReviewerId: row.assigned_reviewer_id,
    reviewNote: row.review_note ?? null,
    dedupKey: row.dedup_key,
    detectionVersion: row.detection_version,
    detector: row.detector === "model" ? "model" : "rule",
    escalationCount: row.escalation_count,
    lastInAppNotifiedAt: row.last_in_app_notified_at,
    lastEmailNotifiedAt: row.last_email_notified_at,
  };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function findingToRow(finding: DurableFinding): Partial<AiFindingRow> {
  const row: Partial<AiFindingRow> = {
    organization_id: finding.organizationId,
    source_type: finding.sourceType,
    source_id: finding.sourceId,
    rule_id: finding.ruleId,
    category: finding.category,
    severity: finding.severity,
    title_ar: finding.titleAr,
    title_en: finding.titleEn,
    explanation_ar: finding.explanationAr,
    explanation_en: finding.explanationEn,
    recommended_action_ar: finding.recommendedActionAr,
    evidence: sanitizeFindingEvidence(finding.evidence),
    href: finding.href,
    status: finding.status,
    first_seen_at: finding.firstSeenAt,
    last_seen_at: finding.lastSeenAt,
    resolved_at: finding.resolvedAt,
    assigned_reviewer_id: finding.assignedReviewerId,
    review_note: finding.reviewNote,
    dedup_key: finding.dedupKey,
    detection_version: finding.detectionVersion,
    detector: finding.detector,
    escalation_count: finding.escalationCount,
    last_in_app_notified_at: finding.lastInAppNotifiedAt,
    last_email_notified_at: finding.lastEmailNotifiedAt,
  };
  if (isUuid(finding.id)) row.id = finding.id;
  return row;
}

export function isMissingGuardianSchema(message: string | undefined): boolean {
  return /does not exist|schema cache|ai_findings/i.test(message ?? "");
}
