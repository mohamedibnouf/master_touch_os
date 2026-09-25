import type { ManagementSnapshot } from "../types";
import type { RiskFinding } from "../risk/types";
import type { DecisionBriefSection, ReportMetric } from "../reports/types";
import { MANAGEMENT_AI_LIMITS as L } from "./limits";
import type {
  ManagementAIMode,
  ManagementAISourceRef,
  ManagementAITrustedContext,
} from "./schema";

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

function stripSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes("iban") ||
        lower.includes("bank") ||
        lower.includes("salary") ||
        lower.includes("compensation") ||
        lower.includes("net_pay") ||
        lower.includes("basic_salary") ||
        lower.includes("password") ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("api_key")
      ) {
        continue;
      }
      out[k] = stripSensitiveKeys(v);
    }
    return out;
  }
  return value;
}

export type BuildManagementAIContextInput = {
  mode: ManagementAIMode;
  question: string | null;
  locale: "ar" | "en";
  snapshot: ManagementSnapshot;
  decisionBrief: DecisionBriefSection[];
  metrics: ReportMetric[];
  organizationNameAr: string;
  organizationNameEn: string;
  asOfDate: string;
  generatedAt: string;
  /** Extra project/approval detail rows (already permission-scoped). */
  projectOverdue?: Array<{
    id: string;
    projectCode: string;
    nameAr: string;
    status: string;
    plannedEndDate: string;
    overdueDays: number;
    href: string;
  }>;
  oldestApprovals?: Array<{
    id: string;
    title: string;
    status: string;
    openDays: number;
    href: string;
  }>;
};

/**
 * Build permission-filtered, minimized AI context BEFORE any provider call.
 * Browser must never supply this — server builds it from trusted DTOs only.
 */
export function buildManagementAIContext(input: BuildManagementAIContextInput): ManagementAITrustedContext {
  const sources: Record<string, ManagementAISourceRef> = {};
  const limitations: string[] = [
    "Analysis is limited to current authorized Master Touch system data as of the report timestamp.",
    "Deterministic Risk Engine findings are authoritative; AI does not create official system risks.",
    "No persistent chat memory — each request is independently grounded.",
  ];

  const risks = input.snapshot.risks.slice(0, L.maxRisks);
  const riskPayload = risks.map((r, i) => {
    const id = `RISK_${pad(i + 1)}`;
    sources[id] = {
      id,
      kind: "risk",
      labelAr: r.titleAr,
      labelEn: r.titleEn,
      href: r.href,
      officialSeverity: r.severity,
    };
    return {
      ref: id,
      ruleId: r.ruleId,
      category: r.category,
      severity: r.severity,
      title: input.locale === "en" ? r.titleEn : r.titleAr,
      explanation: input.locale === "en" ? r.explanationEn : r.explanationAr,
      evidence: stripSensitiveKeys(r.evidence),
      effectiveSince: r.effectiveSince,
      ageDays: r.ageDays,
      sourceType: r.sourceType,
    };
  });

  const metrics = input.metrics.slice(0, L.maxMetrics).map((m, i) => {
    const id = `METRIC_${pad(i + 1)}`;
    sources[id] = {
      id,
      kind: "metric",
      labelAr: m.labelAr,
      labelEn: m.labelEn,
      href: m.href ?? null,
    };
    return {
      ref: id,
      key: m.key,
      label: input.locale === "en" ? m.labelEn : m.labelAr,
      value: m.isMoney ? m.value : m.value,
      isMoney: Boolean(m.isMoney),
    };
  });

  let briefCount = 0;
  const brief = input.decisionBrief
    .map((sec) => {
      const statements = sec.statements.slice(0, Math.max(0, L.maxBriefStatements - briefCount)).map((st, j) => {
        briefCount += 1;
        const id = `BRIEF_${pad(briefCount)}`;
        sources[id] = {
          id,
          kind: "brief",
          labelAr: st.textAr,
          labelEn: st.textEn,
          href: st.href ?? null,
          officialSeverity: st.severity,
        };
        return {
          ref: id,
          text: input.locale === "en" ? st.textEn : st.textAr,
          severity: st.severity ?? null,
        };
      });
      return {
        section: input.locale === "en" ? sec.titleEn : sec.titleAr,
        statements,
      };
    })
    .filter((s) => s.statements.length > 0);

  const activity = input.snapshot.activity.slice(0, L.maxActivity).map((a, i) => {
    const id = `ACTIVITY_${pad(i + 1)}`;
    sources[id] = {
      id,
      kind: "activity",
      labelAr: `${a.action} · ${a.entityType}`,
      labelEn: `${a.action} · ${a.entityType}`,
      href: null,
    };
    return {
      ref: id,
      action: a.action,
      entityType: a.entityType,
      createdAt: a.createdAt,
    };
  });

  const projects = (input.projectOverdue ?? []).slice(0, L.maxProjectRows).map((p, i) => {
    const id = `PROJECT_${pad(i + 1)}`;
    sources[id] = {
      id,
      kind: "project",
      labelAr: `${p.projectCode} — ${p.nameAr}`,
      labelEn: `${p.projectCode} — ${p.nameAr}`,
      href: p.href,
    };
    return {
      ref: id,
      projectCode: p.projectCode,
      name: p.nameAr,
      status: p.status,
      plannedEndDate: p.plannedEndDate,
      overdueDays: p.overdueDays,
    };
  });

  const approvals = (input.oldestApprovals ?? []).slice(0, L.maxApprovalRows).map((a, i) => {
    const id = `APPROVAL_${pad(i + 1)}`;
    sources[id] = {
      id,
      kind: "approval",
      labelAr: a.title,
      labelEn: a.title,
      href: a.href,
    };
    return {
      ref: id,
      title: a.title,
      status: a.status,
      openDays: a.openDays,
    };
  });

  // Mode-scoped data projection (still only from trusted DTOs).
  const data: Record<string, unknown> = {
    mode: input.mode,
    question: input.question,
    asOfDate: input.asOfDate,
    portfolio: {
      projects: input.snapshot.projects,
      approvals: input.snapshot.approvals,
      procurement: input.snapshot.procurement,
      commercial: input.snapshot.commercial,
      people: input.snapshot.people,
      attendance: input.snapshot.attendance,
      payroll: input.snapshot.payroll
        ? {
            underReview: input.snapshot.payroll.underReview,
            approvedAwaitingLock: input.snapshot.payroll.approvedAwaitingLock,
            lockedUnpaidEntries: input.snapshot.payroll.lockedUnpaidEntries,
            latestLabel: input.snapshot.payroll.latestLabel,
            latestStatus: input.snapshot.payroll.latestStatus,
            latestEmployeeCount: input.snapshot.payroll.latestEmployeeCount,
            // latestNet only if already present on snapshot (permission-gated upstream)
            latestNet: input.snapshot.payroll.latestNet,
          }
        : null,
    },
    metrics,
    decisionBrief: brief,
    risks: riskPayload,
    projectsOverdue: projects,
    oldestApprovals: approvals,
    activity,
    sourceIds: Object.keys(sources),
  };

  if (!input.snapshot.commercial) {
    limitations.push("Commercial/finance section not available for this user — omitted from context.");
  }
  if (!input.snapshot.payroll) {
    limitations.push("Payroll section not available for this user — omitted from context.");
  }
  if (input.snapshot.payroll && input.snapshot.payroll.latestNet == null) {
    limitations.push("Aggregate payroll net is hidden for this user.");
  }
  if (!input.snapshot.people) {
    limitations.push("People section not available for this user — omitted from context.");
  }

  return {
    asOfDate: input.asOfDate,
    generatedAt: input.generatedAt,
    organizationNameAr: input.organizationNameAr,
    organizationNameEn: input.organizationNameEn,
    locale: input.locale,
    mode: input.mode,
    question: input.question,
    data: stripSensitiveKeys(data) as Record<string, unknown>,
    sources,
    limitations,
  };
}

export function filterRisksForMode(risks: RiskFinding[], mode: ManagementAIMode): RiskFinding[] {
  switch (mode) {
    case "project_risks":
      return risks.filter((r) => r.category === "PROJECT_DELAY");
    case "approvals":
      return risks.filter((r) => r.category === "APPROVAL_DELAY");
    case "procurement":
      return risks.filter((r) => r.category === "PROCUREMENT");
    case "commercial":
      return risks.filter((r) => r.category === "COMMERCIAL");
    case "people":
      return risks.filter((r) => ["HR", "COMPLIANCE", "ATTENDANCE", "LEAVE"].includes(r.category));
    case "payroll":
      return risks.filter((r) => r.category === "PAYROLL");
    default:
      return risks;
  }
}
