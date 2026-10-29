import { daysBetweenYmd } from "@/modules/management/risk/date-utils";
import type { ManagementInsightFacts } from "../schemas";
import type { Locale } from "@/lib/i18n/config";
import type {
  ExecutiveIntelligenceFacts,
  ExecutiveMetric,
  ExecutiveProgressRow,
  ExecutiveProjectRow,
} from "./types";

export const EXECUTIVE_DELAYED_PROJECT_LIMIT = 8;
/** Display/allowlist cap only. Never use a capped sample as an organization-wide percentage denominator. */
export const EXECUTIVE_PROJECT_SAMPLE_CAP = 400;

const ALLOWED_ROLES_AR = ["مدير عام", "مدير مشروع", "مراجع اعتمادات", "مدير عمليات"];
const ALLOWED_ROLES_EN = ["General Manager", "Project Manager", "Approvals Reviewer", "Operations Manager"];

/** Owner roles the model may suggest (grounding drops any other value), in the requested locale. */
export function allowedRoles(locale: Locale = "ar"): string[] {
  return [...(locale === "en" ? ALLOWED_ROLES_EN : ALLOWED_ROLES_AR)];
}

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

export function coerceExecutiveFacts(
  facts: ManagementInsightFacts | ExecutiveIntelligenceFacts,
  locale: Locale = "ar",
): ExecutiveIntelligenceFacts {
  const en = locale === "en";
  if ("metrics" in facts && Array.isArray(facts.metrics)) return facts;
  return {
    ...facts,
    metrics: [],
    delayedProjects: [],
    progressSample: [],
    pendingApprovalRows: [],
    allowedProjectIds: facts.projectNotes.map((p) => p.id),
    allowedHrefs: facts.projectNotes.map((p) => p.href),
    allowedRolesAr: allowedRoles(locale),
    knownNumbers: [facts.followUpProjects, facts.overdueStages, facts.pendingApprovals],
    limitationsAr: [en ? "Limited sample for compatibility with the previous path." : "عينة محدودة للتوافق مع المسار السابق."],
    operationalSummaryAr: en
      ? "Deterministic metrics are incomplete in this shortened path."
      : "المقاييس الحتمية غير مكتملة في هذا المسار المختصر.",
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
  /** Language of deterministic labels/limitations (Arabic by default). `*Ar` fields hold this language. */
  locale?: Locale;
}): ExecutiveIntelligenceFacts {
  const locale = input.locale ?? "ar";
  const en = locale === "en";
  const L = (ar: string, enText: string) => (en ? enText : ar);
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
        labelAr: L("مشاريع في قائمة العرض", "Projects in the display list"),
        value: unique.length,
        unit: "count",
        source: "projects",
        definitionAr: L("عدد المشاريع الفريدة في قائمة العرض بعد إزالة التكرار. ليست حصراً للمنظمة.", "Unique projects in the display list after de-duplication. Not an organization-wide count."),
        asOf,
        scopeAr: L("عينة عرض", "Display sample"),
        denominator: completeCensus ? census.tracked : null,
        availability: "PARTIAL",
      }),
      metric({
        key: "projects.active",
        labelAr: L("مشاريع نشطة", "Active projects"),
        value: orgActive,
        unit: "count",
        source: "projects.status",
        definitionAr: L("عدد المشاريع ذات الحالة active ضمن نطاق المنظمة والصلاحية (حصر exact، ليس عينة).", "Projects with status active within the organization and your permissions (exact count, not a sample)."),
        asOf,
        scopeAr: L("المنظمة الحالية", "Current organization"),
        denominator: null,
        availability: countAvailability,
      }),
      metric({
        key: "projects.overdue_planned_end",
        labelAr: L("تجاوزت التاريخ المخطط", "Past planned end date"),
        value: orgOverdue,
        unit: "count",
        source: "projects.planned_end_date",
        definitionAr: L("مشاريع نشطة أو معلّقة تاريخها المخطط قبل يوم الرياض الحالي. النسبة العالمية لا تُحسب من عينة العرض.", "Active or on-hold projects whose planned end date is before today (Riyadh). The organization-wide percentage is not computed from the display sample."),
        asOf,
        scopeAr: "active + on_hold",
        denominator: orgTracked,
        availability: countAvailability,
      }),
      metric({
        key: "projects.overdue_percent",
        labelAr: L("نسبة التجاوز المخطط", "Planned-end overrun rate"),
        value: percentAvailability === "NOT_AVAILABLE" ? null : orgPercent,
        unit: "percent",
        source: "projects.planned_end_date",
        definitionAr: L("حصر المتجاوزة ÷ حصر (النشطة + المعلّقة). لا تُستخدم عينة العرض كمقام. القيمة فارغة إذا المقام صفر أو الحصر غير مكتمل.", "Overdue count ÷ (active + on-hold) count. The display sample is never used as the denominator. Empty when the denominator is zero or the count is incomplete."),
        asOf,
        scopeAr: L("active + on_hold (حصر المنظمة)", "active + on_hold (organization count)"),
        denominator: orgTracked,
        availability: percentAvailability,
      }),
      metric({
        key: "projects.declared_high_risk",
        labelAr: L("مخاطر معلنة عالية", "Declared high risks"),
        value: highRisk.length,
        unit: "count",
        source: "projects.risk_level",
        definitionAr: L("حقل risk_level يساوي high أو critical.", "risk_level field equals high or critical."),
        asOf,
        scopeAr: "active + on_hold",
        denominator: null,
        availability: "PARTIAL",
      }),
      metric({
        key: "workflow.overdue_stages",
        labelAr: L("مراحل متأخرة", "Overdue stages"),
        value: input.overdueStageCount,
        unit: "count",
        source: "workflow_instance_steps.due_at",
        definitionAr: L("خطوات ready/in_progress تجاوز due_at وقت الطلب.", "ready/in_progress steps whose due_at has passed at request time."),
        asOf,
        scopeAr: L("المنظمة الحالية", "Current organization"),
        denominator: null,
        availability: input.overdueStageCount == null ? "NOT_AVAILABLE" : "AVAILABLE_AND_RELIABLE",
      }),
      metric({
        key: "workflow.avg_progress_sample",
        labelAr: L("متوسط تقدم العينة", "Sample average progress"),
        value: avgProgress,
        unit: "percent",
        source: "workflow_instance_steps",
        definitionAr: L("متوسط نسبة الخطوات المكتملة لمثيلات العمل الجارية في العينة فقط.", "Average share of completed steps for in-progress workflow instances in the sample only."),
        asOf,
        scopeAr: L("workflow in_progress (عينة)", "workflow in_progress (sample)"),
        denominator: progressWithTotal.length,
        availability: avgProgress == null ? "NOT_AVAILABLE" : "PARTIAL",
      }),
    );
  }

  if (input.canApprovals) {
    metrics.push(
      metric({
        key: "approvals.pending",
        labelAr: L("موافقات معلّقة", "Pending approvals"),
        value: input.pendingApprovalCount,
        unit: "count",
        source: "approval_requests.status",
        definitionAr: L("طلبات بحالة pending أو in_progress.", "Requests with status pending or in_progress."),
        asOf,
        scopeAr: L("المنظمة الحالية", "Current organization"),
        denominator: null,
        availability: input.pendingApprovalCount == null ? "NOT_AVAILABLE" : "AVAILABLE_AND_RELIABLE",
      }),
    );
  }

  if (input.canPeople) {
    metrics.push(
      metric({
        key: "people.active_employees",
        labelAr: L("موظفون نشطون", "Active employees"),
        value: input.activeEmployeeCount,
        unit: "count",
        source: "employees.is_active",
        definitionAr: L("عدد الموظفين النشطين. لا يشمل تقييم أداء.", "Number of active employees. Does not include performance evaluation."),
        asOf,
        scopeAr: L("المنظمة الحالية", "Current organization"),
        denominator: null,
        availability: input.activeEmployeeCount == null ? "NOT_AVAILABLE" : "AVAILABLE_AND_RELIABLE",
      }),
    );
  }

  metrics.push(
    metric({
      key: "finance.portfolio_variance",
      labelAr: L("انحراف مالي للمحفظة", "Portfolio financial variance"),
      value: null,
      unit: "percent",
      source: "none",
      definitionAr: L("لا يوجد مقياس محفظة معتمد للميزانية مقابل الصرف على لوحة الإدارة.", "There is no approved portfolio budget-vs-spend metric on the management dashboard."),
      asOf,
      scopeAr: L("غير محسوب", "Not computed"),
      denominator: null,
      availability: "NOT_AVAILABLE",
    }),
  );

  const limitationsAr = [
    L("الأرقام المعروضة حتمية من قاعدة البيانات ضمن صلاحياتك.", "Displayed numbers are deterministic from the database within your permissions."),
    L("نسب المحفظة تُحسب من حصر المنظمة وليس من قائمة العرض المحدودة.", "Portfolio percentages are computed from the organization count, not the limited display list."),
    L("متوسط التقدم جزئي: يعتمد على مثيلات سير العمل الجارية في العينة فقط.", "Average progress is partial: it relies only on in-progress workflow instances in the sample."),
    L("حقل المخاطر المعلنة لا يغني عن محرك المخاطر في مركز القيادة.", "The declared-risk field does not replace the risk engine in the command center."),
    L("لا تُحسب ميزانيات أو انحرافات مالية على هذه البطاقة.", "No budgets or financial variances are computed on this card."),
  ];
  if (!input.canProjects) limitationsAr.push(L("لا صلاحية قراءة المشاريع؛ أخفيت مقاييس المحفظة.", "No project read permission; portfolio metrics are hidden."));
  if (!input.canApprovals) limitationsAr.push(L("لا صلاحية الموافقات.", "No approvals permission."));
  if (!input.canFinance) limitationsAr.push(L("لا تُعرض مبالغ مالية.", "No financial amounts are shown."));

  if (input.portfolioCapped) {
    limitationsAr.push(L("قائمة المشاريع المتأخرة عينة مرتّبة للتاريخ المخطط وليست حصراً كاملاً للصفوف.", "The delayed-projects list is a sample ordered by planned end date, not a complete list of rows."));
  }

  const delayedTop = overdueProjects.slice(0, EXECUTIVE_DELAYED_PROJECT_LIMIT);
  const projectNotes = delayedTop.length
    ? delayedTop.map((p) => ({
        id: p.id,
        nameAr: p.nameAr,
        reasonAr: en
          ? `Past planned end date by ${p.overdueDays ?? 0} days`
          : `تجاوز التاريخ المخطط بـ ${p.overdueDays ?? 0} يوماً`,
        href: p.href,
      }))
    : active.slice(0, 5).map((p) => ({
        id: p.id,
        nameAr: p.name_ar,
        reasonAr: L("مشروع نشط مصرّح بعرضه", "Active project you are authorized to view"),
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
  const summaryParts: string[] = [en ? `As of ${asOf} (Asia/Riyadh)` : `حتى ${asOf} (آسيا/الرياض)`];
  const activeM = pick("projects.active");
  const overdueM = pick("projects.overdue_planned_end");
  const pctM = pick("projects.overdue_percent");
  const stagesM = pick("workflow.overdue_stages");
  const pendingM = pick("approvals.pending");
  if (activeM?.value != null && activeM.availability === "AVAILABLE_AND_RELIABLE") {
    summaryParts.push(en ? `${activeM.value} active projects` : `${activeM.value} مشروع نشط`);
  }
  if (overdueM?.value != null && overdueM.availability === "AVAILABLE_AND_RELIABLE") {
    summaryParts.push(en ? `${overdueM.value} past planned end date` : `${overdueM.value} تجاوزت التاريخ المخطط`);
  }
  if (pctM?.value != null && pctM.availability === "AVAILABLE_AND_RELIABLE") {
    summaryParts.push(en ? `overrun rate ${pctM.value}%` : `نسبة التجاوز ${pctM.value}%`);
  }
  if (stagesM?.value != null && stagesM.availability !== "NOT_AVAILABLE") {
    summaryParts.push(en ? `${stagesM.value} overdue stages` : `${stagesM.value} مرحلة متأخرة`);
  }
  if (pendingM?.value != null && pendingM.availability !== "NOT_AVAILABLE") {
    summaryParts.push(en ? `${pendingM.value} pending approvals` : `${pendingM.value} موافقة معلّقة`);
  }
  const operationalSummaryAr = `${summaryParts.join(" — ")}. ${L("الأرقام من النظام وليست تقديراً من النموذج.", "Numbers come from the system, not model estimates.")}`;

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
      titleAr: row.title?.trim() || L("طلب موافقة", "Approval request"),
      href: "/approvals",
    })),
    allowedProjectIds: unique.map((p) => p.id),
    allowedHrefs: [...new Set(allowedHrefs)],
    allowedRolesAr: allowedRoles(locale),
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
