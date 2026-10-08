import type { ManagementAttentionItem } from "../types";
import { MANAGEMENT_RISK_THRESHOLDS } from "./thresholds";
import { MANAGEMENT_RISK_RULES } from "./rules";
import type { RiskFinding, RiskInputSnapshot, RiskRule } from "./types";

const SEVERITY_RANK: Record<RiskFinding["severity"], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function emptyRiskInput(
  asOfDate: string,
  asOfInstant: string,
  sections: RiskInputSnapshot["sections"],
): RiskInputSnapshot {
  return {
    asOfDate,
    asOfInstant,
    sections,
    projects: [],
    approvals: [],
    purchaseRequests: [],
    rfqs: [],
    purchaseOrders: [],
    supplierInvoices: [],
    clientInvoices: [],
    valuations: [],
    variations: [],
    compliance: [],
    contracts: [],
    attendanceToday: [],
    leavePending: [],
    payrollPeriods: [],
  };
}

/** Deduplicate by stable finding id (ruleId + sourceType + sourceId). */
export function dedupeFindings(findings: RiskFinding[]): RiskFinding[] {
  const seen = new Set<string>();
  const out: RiskFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

/**
 * CRITICAL → HIGH → MEDIUM → LOW, then oldest effectiveSince, then id.
 */
export function sortFindings(findings: RiskFinding[]): RiskFinding[] {
  return [...findings].sort((a, b) => {
    const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sr !== 0) return sr;
    const ae = a.effectiveSince ?? "9999-12-31";
    const be = b.effectiveSince ?? "9999-12-31";
    if (ae !== be) return ae < be ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** Full rule evaluation. Guardian scans must use this — never the UI cap. */
export function evaluateRisksUncapped(
  input: RiskInputSnapshot,
  rules: RiskRule[] = MANAGEMENT_RISK_RULES,
): RiskFinding[] {
  const raw: RiskFinding[] = [];
  for (const rule of rules) {
    raw.push(...rule.evaluate(input));
  }
  return sortFindings(dedupeFindings(raw));
}

export function evaluateRisks(
  input: RiskInputSnapshot,
  rules: RiskRule[] = MANAGEMENT_RISK_RULES,
): RiskFinding[] {
  return evaluateRisksUncapped(input, rules).slice(0, MANAGEMENT_RISK_THRESHOLDS.maxFindings);
}

/**
 * Collapse per-source findings into overview attention rows (one row per ruleId).
 * Keeps ECC compact while sharing the canonical rule source with /management/risks.
 */
export function summarizeFindingsAsAttention(findings: RiskFinding[]): ManagementAttentionItem[] {
  const byRule = new Map<string, { sample: RiskFinding; count: number; maxSeverity: RiskFinding["severity"] }>();

  for (const f of findings) {
    const prev = byRule.get(f.ruleId);
    if (!prev) {
      byRule.set(f.ruleId, { sample: f, count: 1, maxSeverity: f.severity });
      continue;
    }
    prev.count += 1;
    if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[prev.maxSeverity]) {
      prev.maxSeverity = f.severity;
      prev.sample = f;
    }
  }

  const items: ManagementAttentionItem[] = [...byRule.values()].map(({ sample, count, maxSeverity }) => ({
    id: sample.ruleId,
    category: sample.category,
    severity: maxSeverity,
    titleAr: sample.titleAr,
    titleEn: sample.titleEn,
    reasonAr: sample.explanationAr,
    reasonEn: sample.explanationEn,
    count,
    href: count === 1 ? sample.href : "/management/risks",
  }));

  return items.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.count - a.count ||
      a.id.localeCompare(b.id),
  );
}

export function filterFindings(
  findings: RiskFinding[],
  opts: { severity?: string | null; category?: string | null },
): RiskFinding[] {
  return findings.filter((f) => {
    if (opts.severity && f.severity !== opts.severity) return false;
    if (opts.category && f.category !== opts.category) return false;
    return true;
  });
}

export function countBySeverity(findings: RiskFinding[]): Record<RiskFinding["severity"], number> {
  const out: Record<RiskFinding["severity"], number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

export function countByCategory(findings: RiskFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) {
    out[f.category] = (out[f.category] ?? 0) + 1;
  }
  return out;
}
