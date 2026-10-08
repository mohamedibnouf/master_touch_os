import type { RiskFinding } from "@/modules/management/risk/types";
import { GUARDIAN_DETECTION_VERSION, GUARDIAN_RECOMMENDED_ACTION_AR } from "./constants";
import { sanitizeFindingEvidence } from "./redact";
import type { DurableFinding, GuardianScanCoverage } from "./types";
import { safeNotificationHref } from "@/modules/notifications/safety";

export function findingDedupKey(finding: Pick<RiskFinding, "id">): string {
  return finding.id;
}

export function liveToDurableDraft(
  organizationId: string,
  finding: RiskFinding,
  nowIso: string,
): Omit<DurableFinding, "id"> {
  return {
    organizationId,
    sourceType: finding.sourceType,
    sourceId: finding.sourceId,
    ruleId: finding.ruleId,
    category: finding.category,
    severity: finding.severity,
    titleAr: finding.titleAr,
    titleEn: finding.titleEn,
    explanationAr: finding.explanationAr,
    explanationEn: finding.explanationEn,
    recommendedActionAr: GUARDIAN_RECOMMENDED_ACTION_AR,
    evidence: sanitizeFindingEvidence(finding.evidence),
    href: safeNotificationHref(finding.href),
    status: "open",
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    resolvedAt: null,
    assignedReviewerId: null,
    reviewNote: null,
    dedupKey: findingDedupKey(finding),
    detectionVersion: GUARDIAN_DETECTION_VERSION,
    detector: "rule",
    escalationCount: 0,
    lastInAppNotifiedAt: null,
    lastEmailNotifiedAt: null,
  };
}

/**
 * Merge live rule hits into durable rows.
 * Never resolves on a partial scan (omitted rows are not treated as cleared).
 * Preserves acknowledgment / in_review / dismissed.
 * Reopens resolved rows only when the source condition is still present.
 */
export function mergeGuardianFindings(input: {
  previous: DurableFinding[];
  live: RiskFinding[];
  organizationId: string;
  nowIso: string;
  coverage: GuardianScanCoverage;
}): { upserts: DurableFinding[]; resolveIds: string[] } {
  const prevByKey = new Map(input.previous.map((row) => [row.dedupKey, row]));
  const liveKeys = new Set(input.live.map(findingDedupKey));
  const upserts: DurableFinding[] = [];

  for (const finding of input.live) {
    const key = findingDedupKey(finding);
    const prev = prevByKey.get(key);
    const draft = liveToDurableDraft(input.organizationId, finding, input.nowIso);
    if (!prev) {
      upserts.push({ ...draft, id: "" });
      continue;
    }
    const keepReview =
      prev.status === "acknowledged" || prev.status === "in_review" || prev.status === "dismissed";
    const nextStatus = keepReview ? prev.status : "open";
    upserts.push({
      ...prev,
      ...draft,
      id: prev.id,
      firstSeenAt: prev.firstSeenAt,
      assignedReviewerId: prev.assignedReviewerId,
      reviewNote: prev.reviewNote,
      status: nextStatus,
      resolvedAt: nextStatus === "resolved" ? prev.resolvedAt : null,
      escalationCount: prev.escalationCount,
      lastInAppNotifiedAt: prev.lastInAppNotifiedAt,
      lastEmailNotifiedAt: prev.lastEmailNotifiedAt,
      lastSeenAt: input.nowIso,
    });
  }

  const resolveIds: string[] = [];
  if (input.coverage.complete) {
    for (const prev of input.previous) {
      if (liveKeys.has(prev.dedupKey)) continue;
      if (prev.status === "resolved" || prev.status === "dismissed") continue;
      resolveIds.push(prev.id);
    }
  }

  return { upserts, resolveIds };
}
