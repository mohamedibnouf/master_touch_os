import { daysBetweenYmd } from "@/modules/management/risk/date-utils";
import type { ManagementInsightFacts } from "../schemas";
import type {
  ExecutiveIntelligenceFacts,
  ExecutiveMetric,
  ExecutiveProgressRow,
  ExecutiveProjectRow,
} from "./types";

export const EXECUTIVE_DELAYED_PROJECT_LIMIT = 8;
/** Display/allowlist cap only. Never use a capped sample as an organization-wide percentage denominator. */
export const EXECUTIVE_PROJECT_SAMPLE_CAP = 400;

export type ProjectPortfolioRow = {
  id: string;
  project_code: string;
  name_ar: string;
  status: string;
  planned_end_date: string | null;
  risk_level: string | null;
};

export type ProjectCensus = {
  total: number | null;
  active: number | null;
  tracked: number | null;
  overduePlannedEnd: number | null;
};

export function uniqueProjectsById(rows: ProjectPortfolioRow[]): ProjectPortfolioRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function censusComplete(census: ProjectCensus | null | undefined): census is {
  total: number | null;
  active: number;
  tracked: number;
  overduePlannedEnd: number;
} {
  return Boolean(
    census &&
      typeof census.active === "number" &&
      typeof census.tracked === "number" &&
      typeof census.overduePlannedEnd === "number",
  );
}

export function coerceExecutiveFacts(facts: ManagementInsightFacts | ExecutiveIntelligenceFacts): ExecutiveIntelligenceFacts {
  if ("metrics" in facts && Array.isArray(facts.metrics)) return facts;
  return {
    ...facts,
    metrics: [],
    delayedProjects: [],
    progressSample: [],
    pendingApprovalRows: [],
    allowedProjectIds: facts.projectNotes.map((p) => p.id),
    allowedHrefs: facts.projectNotes.map((p) => p.href),
    allowedRolesAr: ["مدير عام", "مدير مشروع", "مراجع اعتمادات", "مدير عمليات"],
    knownNumbers: [facts.followUpProjects, facts.overdueStages, facts.pendingApprovals],
    limitationsAr: ["عينة محدودة للتوافق مع المسار السابق."],
    operationalSummaryAr: "المقاييس الحتمية غير مكتملة في هذا المسار المختصر.",
    sections: { projects: true, approvals: true, people: false, finance: false },
  };
}

export function percentOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function metric(partial: ExecutiveMetric): ExecutiveMetric {
  return partial;
}

function hrefForProject(id: string): string {
  return `/projects/${id}`;
}

export function buildExecutiveIntelligenceFacts(input: {
  asOf: string;
  canProjects: boolean;
  canApprovals: boolean;
  canPeople: boolean;
  canFinance: boolean;
  projects: ProjectPortfolioRow[];
  census?: ProjectCensus | null;
  portfolioCapped?: boolean;
  overdueStageCount: number | null;
  pendingApprovalCount: number | null;
  pendingApprovalRows: Array<{ id: string; title: string | null }>;
  progressSample: ExecutiveProgressRow[];
  activeEmployeeCount: number | null;
}): ExecutiveIntelligenceFacts {
  const asOf = input.asOf;
  const unique = uniqueProjectsById(input.projects);
  const tracked = unique.filter((p) => p.status === "active" || p.status === "on_hold");
  const active = unique.filter((p) => p.status === "active");
  const overdueProjects: ExecutiveProjectRow[] = tracked
    .filter((p) => p.planned_end_date && p.planned_end_date < asOf)
    .map((p) => ({
      id: p.id,
      projectCode: p.project_code,
      nameAr: p.name_ar,
      status: p.status,
      plannedEndDate: p.planned_end_date,
      overdueDays: p.planned_end_date ? daysBetweenYmd(p.planned_end_date, asOf) : null,
      riskLevel: p.risk_level,
      href: hrefForProject(p.id),
    }))
    .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));

  const highRisk = tracked.filter((p) => p.risk_level === "high" || p.risk_level === "critical");
  const progressWithTotal = input.progressSample.filter((row) => Number.isFinite(row.percent));
  const avgProgress =
    progressWithTotal.length > 0
      ? Math.round(progressWithTotal.reduce((sum, row) => sum + row.percent, 0) / progressWithTotal.length)
      : null;

  const metrics: ExecutiveMetric[] = [];
  if (input.canProjects) {
    const census = input.census;
    const completeCensus = censusComplete(census);
    const orgActive = completeCensus ? census.active : active.length;
    const orgTracked = completeCensus ? census.tracked : tracked.length;
    const orgOverdue = completeCensus ? census.overduePlannedEnd : overdueProjects.length;
    const sampledOnly = Boolean(input.portfolioCapped) && !completeCensus;
    const orgPercent = sampledOnly ? null : percentOf(orgOverdue, orgTracked);
    const countAvailability = sampledOnly ? "PARTIAL" : "AVAILABLE_AND_RELIABLE";
    const percentAvailability = sampledOnly || orgPercent == null ? "NOT_AVAILABLE" : "AVAILABLE_AND_RELIABLE";

    metrics.push(
      metric({
        key: "projects.total_loaded",
        labelAr: "مشاريع في قائمة العرض",
        value: unique.length,
        unit: "count",
        source: "projects",
        definitionAr: "عدد المشاريع الفريدة في قائمة العرض بعد إزالة التكرار. ليست حصراً للمنظمة.",
        asOf,
        scopeAr: "عينة عرض",
        denominator: completeCensus ? census.tracked : null,
        availability: "PARTIAL",
      }),
      metric({
        key: "projects.active",
        labelAr: "مشاريع نشطة",
        value: orgActive,
        unit: "count",
        source: "projects.status",
        definitionAr: "عدد المشاريع ذات الحالة active ضمن نطاق المنظمة والصلاحية (حصر exact، ليس عينة).",
        asOf,
        scopeAr: "المنظمة الحالية",
        denominator: null,
        availability: countAvailability,
      }),
      metric({
        key: "projects.overdue_planned_end",
        labelAr: "تجاوزت التاريخ المخطط",
        value: orgOverdue,
        unit: "count",
        source: "projects.planned_end_date",
        definitionAr: "مشاريع نشطة أو معلّقة تاريخها المخطط قبل يوم الرياض الحالي. النسبة العالمية لا تُحسب من عينة العرض.",
        asOf,
        scopeAr: "active + on_hold",
        denominator: orgTracked,
        availability: countAvailability,
      }),
      metric({
        key: "projects.overdue_percent",
        labelAr: "نسبة التجاوز المخطط",
        value: percentAvailability === "NOT_AVAILABLE" ? null : orgPercent,
        unit: "percent",
        source: "projects.planned_end_date",
        definitionAr: "حصر المتجاوزة ÷ حصر (النشطة + المعلّقة). لا تُستخدم عينة العرض كمقام. القيمة فارغة إذا المقام صفر أو الحصر غير مكتمل.",
        asOf,
        scopeAr: "active + on_hold (حصر المنظمة)",
        denominator: orgTracked,
        availability: percentAvailability,
      }),
      metric({
        key: "projects.declared_high_risk",
        labelAr: "مخاطر معلنة عالية",
        value: highRisk.length,
        unit: "count",
        source: "projects.risk_level",
        definitionAr: "حقل risk_level يساوي high أو critical.",
        asOf,
        scopeAr: "active + on_hold",
        denominator: null,
        availability: "PARTIAL",
      }),
      metric({
        key: "workflow.overdue_stages",
        labelAr: "مراحل متأخرة",
        value: input.overdueStageCount,
        unit: "count",
        source: "workflow_instance_steps.due_at",
        definitionAr: "خطوات ready/in_progress تجاوز due_at وقت الطلب.",
        asOf,
        scopeAr: "المنظمة الحالية",
        denominator: null,
        availability: input.overdueStageCount == null ? "NOT_AVAILABLE" : "AVAILABLE_AND_RELIABLE",
      }),
      metric({
        key: "workflow.avg_progress_sample",
        labelAr: "متوسط تقدم العينة",
        value: avgProgress,
        unit: "percent",
        source: "workflow_instance_steps",
        definitionAr: "متوسط نسبة الخطوات المكتملة لمثيلات العمل الجارية في العينة فقط.",
        asOf,
        scopeAr: "workflow in_progress (عينة)",
        denominator: progressWithTotal.length,
        availability: avgProgress == null ? "NOT_AVAILABLE" : "PARTIAL",
      }),
    );
  }

  if (input.canApprovals) {
    metrics.push(
      metric({
        key: "approvals.pending",
        labelAr: "موافقات معلّقة",
        value: input.pendingApprovalCount,
        unit: "count",
        source: "approval_requests.status",
        definitionAr: "طلبات بحالة pending أو in_progress.",
        asOf,
        scopeAr: "المنظمة الحالية",
        denominator: null,
        availability: input.pendingApprovalCount == null ? "NOT_AVAILABLE" : "AVAILABLE_AND_RELIABLE",
      }),
    );
  }

  if (input.canPeople) {
    metrics.push(
      metric({
        key: "people.active_employees",
        labelAr: "موظفون نشطون",
        value: input.activeEmployeeCount,
        unit: "count",
        source: "employees.is_active",
        definitionAr: "عدد الموظفين النشطين. لا يشمل تقييم أداء.",
        asOf,
        scopeAr: "المنظمة الحالية",
        denominator: null,
        availability: input.activeEmployeeCount == null ? "NOT_AVAILABLE" : "AVAILABLE_AND_RELIABLE",
      }),
    );
  }

  metrics.push(
    metric({
      key: "finance.portfolio_variance",
      labelAr: "انحراف مالي للمحفظة",
      value: null,
      unit: "percent",
      source: "none",
      definitionAr: "لا يوجد مقياس محفظة معتمد للميزانية مقابل الصرف على لوحة الإدارة.",
      asOf,
      scopeAr: "غير محسوب",
      denominator: null,
      availability: "NOT_AVAILABLE",
    }),
  );

  const limitationsAr = [
    "الأرقام المعروضة حتمية من قاعدة البيانات ضمن صلاحياتك.",
    "نسب المحفظة تُحسب من حصر المنظمة وليس من قائمة العرض المحدودة.",
    "متوسط التقدم جزئي: يعتمد على مثيلات سير العمل الجارية في العينة فقط.",
    "حقل المخاطر المعلنة لا يغني عن محرك المخاطر في مركز القيادة.",
    "لا تُحسب ميزانيات أو انحرافات مالية على هذه البطاقة.",
  ];
  if (!input.canProjects) limitationsAr.push("لا صلاحية قراءة المشاريع؛ أخفيت مقاييس المحفظة.");
  if (!input.canApprovals) limitationsAr.push("لا صلاحية الموافقات.");
  if (!input.canFinance) limitationsAr.push("لا تُعرض مبالغ مالية.");

  if (input.portfolioCapped) {
    limitationsAr.push("قائمة المشاريع المتأخرة عينة مرتّبة للتاريخ المخطط وليست حصراً كاملاً للصفوف.");
  }

  const delayedTop = overdueProjects.slice(0, EXECUTIVE_DELAYED_PROJECT_LIMIT);
  const projectNotes = delayedTop.length
    ? delayedTop.map((p) => ({
        id: p.id,
        nameAr: p.nameAr,
        reasonAr: `تجاوز التاريخ المخطط بـ ${p.overdueDays ?? 0} يوماً`,
        href: p.href,
      }))
    : active.slice(0, 5).map((p) => ({
        id: p.id,
        nameAr: p.name_ar,
        reasonAr: "مشروع نشط مصرّح بعرضه",
        href: hrefForProject(p.id),
      }));

  const allowedHrefs = [
    "/projects",
    "/approvals",
    "/management/projects",
    "/management/risks",
    ...unique.map((p) => hrefForProject(p.id)),
    ...input.pendingApprovalRows.map(() => `/approvals`),
  ];

  const pick = (key: string) => metrics.find((m) => m.key === key);
  const summaryParts: string[] = [`حتى ${asOf} (آسيا/الرياض)`];
  const activeM = pick("projects.active");
  const overdueM = pick("projects.overdue_planned_end");
  const pctM = pick("projects.overdue_percent");
  const stagesM = pick("workflow.overdue_stages");
  const pendingM = pick("approvals.pending");
  if (activeM?.value != null && activeM.availability === "AVAILABLE_AND_RELIABLE") {
    summaryParts.push(`${activeM.value} مشروع نشط`);
  }
  if (overdueM?.value != null && overdueM.availability === "AVAILABLE_AND_RELIABLE") {
    summaryParts.push(`${overdueM.value} تجاوزت التاريخ المخطط`);
  }
  if (pctM?.value != null && pctM.availability === "AVAILABLE_AND_RELIABLE") {
    summaryParts.push(`نسبة التجاوز ${pctM.value}%`);
  }
  if (stagesM?.value != null && stagesM.availability !== "NOT_AVAILABLE") {
    summaryParts.push(`${stagesM.value} مرحلة متأخرة`);
  }
  if (pendingM?.value != null && pendingM.availability !== "NOT_AVAILABLE") {
    summaryParts.push(`${pendingM.value} موافقة معلّقة`);
  }
  const operationalSummaryAr = `${summaryParts.join(" — ")}. الأرقام من النظام وليست تقديراً من النموذج.`;

  const knownNumbers = metrics
    .map((m) => m.value)
    .filter((v): v is number => typeof v === "number")
    .concat(overdueProjects.map((p) => p.overdueDays).filter((v): v is number => typeof v === "number"))
    .concat(progressWithTotal.map((p) => p.percent));

  return {
    followUpProjects: projectNotes.length,
    overdueStages: input.overdueStageCount ?? 0,
    pendingApprovals: input.pendingApprovalCount ?? 0,
    projectNotes,
    dataAsOf: asOf,
    metrics,
    delayedProjects: delayedTop,
    progressSample: input.progressSample.slice(0, 8),
    pendingApprovalRows: input.pendingApprovalRows.slice(0, 8).map((row) => ({
      id: row.id,
      titleAr: row.title?.trim() || "طلب موافقة",
      href: "/approvals",
    })),
    allowedProjectIds: unique.map((p) => p.id),
    allowedHrefs: [...new Set(allowedHrefs)],
    allowedRolesAr: ["مدير عام", "مدير مشروع", "مراجع اعتمادات", "مدير عمليات"],
    knownNumbers: [...new Set(knownNumbers)],
    limitationsAr,
    operationalSummaryAr,
    sections: {
      projects: input.canProjects,
      approvals: input.canApprovals,
      people: input.canPeople,
      finance: input.canFinance,
    },
  };
}
