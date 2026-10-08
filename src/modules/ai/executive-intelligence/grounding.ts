import { safeNotificationHref } from "@/modules/notifications/safety";
import type { ManagementInsight } from "../schemas";
import type { ExecutiveIntelligenceFacts } from "./types";

const NUMBER_TOKEN = /\d+(?:\.\d+)?/g;
const GENERIC = /^(راجع|تابع|تحسين|يجب العمل|يُنصح بشكل عام)/;

function stripDateLike(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ");
}

function numbersIn(text: string): number[] {
  return (stripDateLike(text).match(NUMBER_TOKEN) ?? []).map(Number).filter((n) => Number.isFinite(n));
}

function usesUnknownNumber(text: string, known: number[]): boolean {
  const allowed = new Set(known);
  return numbersIn(text).some((n) => n > 1 && !allowed.has(n));
}

export function sanitizeInsightHref(
  href: string | null | undefined,
  allowedHrefs: string[],
): string | null {
  const safe = safeNotificationHref(href);
  if (!safe) return null;
  if (allowedHrefs.includes(safe)) return safe;
  if (safe === "/approvals" || safe.startsWith("/projects/")) {
    return allowedHrefs.includes(safe) ? safe : null;
  }
  return null;
}

export function groundManagementInsight(
  insight: ManagementInsight,
  facts: ExecutiveIntelligenceFacts,
): ManagementInsight {
  const known = facts.knownNumbers.concat([0, 1, facts.delayedProjects.length]);
  const allowedIds = new Set(facts.allowedProjectIds);
  const seenIssues = new Set<string>();

  const observations = (insight.observations ?? []).filter((row) => {
    const key = `${row.issue_key}:${row.evidence_ref ?? ""}`;
    if (seenIssues.has(key)) return false;
    seenIssues.add(key);
    if (usesUnknownNumber(`${row.title_ar} ${row.explanation_ar}`, known)) return false;
    if (row.evidence_ref && allowedIds.size && row.evidence_ref.includes("-") && !allowedIds.has(row.evidence_ref)) {
      if (!facts.metrics.some((m) => m.key === row.evidence_ref)) return false;
    }
    return true;
  });

  const seenRecs = new Set<string>();
  const recommendations = (insight.recommendations ?? []).filter((row) => {
    const key = `${row.record_ref ?? ""}:${row.problem_ar}`;
    if (seenRecs.has(key)) return false;
    seenRecs.add(key);
    if (!row.evidence_ar.trim() || GENERIC.test(row.action_ar.trim())) return false;
    if (usesUnknownNumber(`${row.problem_ar} ${row.evidence_ar} ${row.impact_ar}`, known)) return false;
    if (row.record_ref && !allowedIds.has(row.record_ref) && !facts.metrics.some((m) => m.key === row.record_ref)) {
      return false;
    }
    if (row.owner_role_ar && !facts.allowedRolesAr.includes(row.owner_role_ar)) {
      row.owner_role_ar = null;
    }
    row.href = sanitizeInsightHref(row.href, facts.allowedHrefs);
    return true;
  });

  const items = (insight.items ?? [])
    .filter((item) => !usesUnknownNumber(`${item.title_ar} ${item.explanation_ar}`, known))
    .map((item) => ({ ...item, href: sanitizeInsightHref(item.href, facts.allowedHrefs) }));

  let headline = insight.headline_ar.trim();
  let summary = insight.executive_summary_ar.trim();
  if (usesUnknownNumber(headline, known)) {
    headline = observations[0]?.title_ar || "تحليل مبني على المقاييس الحتمية المعروضة.";
  }
  if (usesUnknownNumber(summary, known)) {
    summary = headline;
  }

  return {
    ...insight,
    headline_ar: headline,
    executive_summary_ar: summary,
    observations,
    recommendations,
    items,
    data_as_of: facts.dataAsOf,
  };
}
