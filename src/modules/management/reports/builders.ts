import { countByCategory, countBySeverity } from "../risk/engine";
import { daysBetweenYmd } from "../risk/date-utils";
import type { RiskFinding, RiskInputSnapshot } from "../risk/types";
import type { ManagementSnapshot } from "../types";
import { buildDecisionBrief } from "./decision-brief";
import type {
  ManagementExecutiveReport,
  ManagementFinanceReport,
  ManagementOperationsReport,
  ManagementPayrollReport,
  ManagementPeopleReport,
  ManagementProjectReport,
  ManagementReportContext,
  ManagementRiskReport,
  ReportMetric,
} from "./types";

function topRisks(risks: RiskFinding[], limit = 8): RiskFinding[] {
  return risks.slice(0, limit);
}

function metric(
  key: string,
  labelAr: string,
  labelEn: string,
  value: number | string,
  href?: string,
  isMoney?: boolean,
): ReportMetric {
  return { key, labelAr, labelEn, value, href, isMoney };
}

export function buildExecutiveReport(input: {
  context: ManagementReportContext;
  snapshot: ManagementSnapshot;
}): ManagementExecutiveReport {
  const { context, snapshot: s } = input;
  const metrics: ReportMetric[] = [];
  if (context.sections.projects) {
    metrics.push(metric("active-projects", "مشاريع نشطة", "Active projects", s.projects.active, "/projects"));
    metrics.push(
      metric("overdue-projects", "تجاوزت التاريخ المخطط", "Past planned end", s.projects.overduePlannedEnd, "/management/reports/projects"),
    );
  }
  if (context.sections.approvals) {
    metrics.push(metric("pending-approvals", "موافقات معلّقة", "Pending approvals", s.approvals.pending, "/approvals"));
  }
  if (context.sections.people && s.people) {
    metrics.push(metric("active-employees", "موظفون نشطون", "Active employees", s.people.activeEmployees, "/employees"));
  }
  if (context.sections.payroll && s.payroll) {
    metrics.push(metric("payroll-review", "مسيرات للمراجعة", "Payroll periods under review", s.payroll.underReview, "/payroll"));
  }
  metrics.push(metric("risk-total", "نتائج المخاطر", "Open risks", s.risks.length, "/management/reports/risks"));

  return {
    kind: "executive",
    context,
    metrics,
    decisionBrief: buildDecisionBrief({
      snapshot: s,
      sections: {
        projects: context.sections.projects,
        approvals: context.sections.approvals,
        procurement: context.sections.procurement,
        finance: context.sections.finance,
        people: context.sections.people,
        attendanceLeave: context.sections.attendanceLeave,
        payroll: context.sections.payroll,
      },
    }),
    topRisks: topRisks(s.risks),
    attention: s.attention,
    activity: s.activity,
    freshnessNoteAr:
      "المقاييس الحالية بتاريخ «كما في». النشاط الحديث إن وُجد يعكس نافذة محدودة من سجل التدقيق — وليس لقطة تاريخية كاملة.",
    freshnessNoteEn:
      "Metrics show the current position As of the date shown. Recent activity covers a limited audit-log window — not a full historical record.",
  };
}

export function buildProjectReport(input: {
  context: ManagementReportContext;
  snapshot: ManagementSnapshot;
  riskInput: RiskInputSnapshot;
}): ManagementProjectReport {
  const { context, snapshot: s, riskInput } = input;
  const asOf = context.asOfDate;
  const overdueProjects = riskInput.projects
    .filter((p) => ["active", "on_hold"].includes(p.status) && p.planned_end_date && p.planned_end_date < asOf)
    .map((p) => ({
      id: p.id,
      projectCode: p.project_code,
      nameAr: p.name_ar,
      status: p.status,
      plannedEndDate: p.planned_end_date!,
      overdueDays: daysBetweenYmd(p.planned_end_date!, asOf),
      href: `/projects/${p.id}`,
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays);

  const declaredHighRisk = riskInput.projects
    .filter((p) => ["active", "on_hold"].includes(p.status) && (p.risk_level === "high" || p.risk_level === "critical"))
    .map((p) => ({
      id: p.id,
      projectCode: p.project_code,
      nameAr: p.name_ar,
      riskLevel: p.risk_level ?? "",
      href: `/projects/${p.id}`,
    }));

  const projectFindings = s.risks.filter((r) => r.sourceType === "project" || r.category === "PROJECT_DELAY");
  const byProject = new Map<string, { label: string; findings: RiskFinding[] }>();
  for (const f of projectFindings) {
    if (f.sourceType !== "project") continue;
    const prev = byProject.get(f.sourceId);
    if (!prev) {
      const row = riskInput.projects.find((p) => p.id === f.sourceId);
      byProject.set(f.sourceId, {
        label: row ? `${row.project_code} — ${row.name_ar}` : f.sourceId.slice(0, 8),
        findings: [f],
      });
    } else {
      prev.findings.push(f);
    }
  }

  return {
    kind: "projects",
    context,
    metrics: [
      metric("active", "نشطة", "Active", s.projects.active),
      metric("on-hold", "معلّقة", "On hold", s.projects.onHold),
      metric("at-risk", "مخاطر معلنة", "Declared high risk", s.projects.atRisk),
      metric("overdue", "تجاوزت المخطط", "Past planned end", s.projects.overduePlannedEnd),
    ],
    overdueProjects,
    declaredHighRisk,
    risksByProject: [...byProject.entries()].map(([projectId, v]) => ({
      projectId,
      projectLabel: v.label,
      findings: v.findings,
    })),
    decisionBrief: buildDecisionBrief({
      snapshot: s,
      sections: {
        projects: true,
        approvals: false,
        procurement: false,
        finance: false,
        people: false,
        attendanceLeave: false,
        payroll: false,
      },
    }),
  };
}

export function buildOperationsReport(input: {
  context: ManagementReportContext;
  snapshot: ManagementSnapshot;
  riskInput: RiskInputSnapshot;
}): ManagementOperationsReport {
  const { context, snapshot: s, riskInput } = input;
  const asOf = context.asOfDate;
  const oldestApprovals = riskInput.approvals
    .map((a) => {
      const since = a.created_at.slice(0, 10);
      return {
        id: a.id,
        title: a.title ?? a.id.slice(0, 8),
        titleEn: a.title_en ?? null,
        status: a.status,
        openDays: daysBetweenYmd(since, asOf),
        href: "/approvals",
      };
    })
    .sort((a, b) => b.openDays - a.openDays)
    .slice(0, 20);

  const operationalRisks = s.risks.filter((r) =>
    ["APPROVAL_DELAY", "PROCUREMENT"].includes(r.category),
  );

  const metrics: ReportMetric[] = [];
  if (context.sections.approvals) {
    metrics.push(metric("pending", "موافقات معلّقة", "Pending approvals", s.approvals.pending, "/approvals"));
    metrics.push(metric("overdue", "موافقات past due_at", "Overdue approvals", s.approvals.overdue, "/approvals"));
  }
  if (context.sections.purchaseRequests) {
    metrics.push(metric("pr", "طلبات شراء للمراجعة", "Purchase requests awaiting review", s.procurement.prAwaitingReview));
  }
  if (context.sections.rfqs) {
    metrics.push(metric("rfq-issued", "مناقصات صادرة", "RFQs issued", s.procurement.rfqIssued));
    metrics.push(metric("rfq-compare", "تحتاج مقارنة", "RFQs awaiting comparison", s.procurement.rfqNeedsComparison));
  }
  if (context.sections.purchaseOrders) {
    metrics.push(metric("po-ready", "أوامر جاهزة للإصدار", "POs ready to issue", s.procurement.poReadyToIssue));
    metrics.push(metric("po-late", "توريدات متأخرة", "Late deliveries", s.procurement.lateDeliveries));
  }
  if (context.sections.supplierInvoices) {
    metrics.push(metric("inv-review", "فواتير مورد للمراجعة", "Supplier invoices in review", s.procurement.invoicesAwaitingReview));
  }

  return {
    kind: "operations",
    context,
    metrics,
    oldestApprovals,
    operationalRisks: operationalRisks.slice(0, 40),
    decisionBrief: buildDecisionBrief({
      snapshot: s,
      sections: {
        projects: false,
        approvals: context.sections.approvals,
        procurement: context.sections.procurement,
        finance: false,
        people: false,
        attendanceLeave: false,
        payroll: false,
      },
    }),
  };
}

export function buildFinanceReport(input: {
  context: ManagementReportContext;
  snapshot: ManagementSnapshot;
}): ManagementFinanceReport {
  const { context, snapshot: s } = input;
  const amountsVisible = false; // Management reports use counts only — amounts stay on operational finance screens.
  const metrics: ReportMetric[] = [];
  const redacted = !context.sections.finance;

  if (context.sections.finance && s.commercial) {
    metrics.push(metric("ar-open", "ذمم عملاء مفتوحة (عدد)", "Outstanding receivables (count)", s.commercial.outstandingAr, "/finance/receivables"));
    metrics.push(metric("ar-overdue", "فواتير عملاء متأخرة", "Overdue client invoices", s.commercial.overdueAr, "/finance/receivables"));
    metrics.push(metric("ap-overdue", "فواتير موردين متأخرة", "Overdue supplier invoices", s.commercial.overdueAp, "/finance/supplier-invoices"));
    metrics.push(metric("valuations", "مستخلصات معلّقة", "Pending valuations", s.commercial.pendingValuations, "/finance/client-valuations"));
    metrics.push(metric("variations", "أوامر تغيير مفتوحة", "Open variation orders", s.commercial.openVariations, "/finance/variations"));
  }
  if (context.sections.payroll && s.payroll) {
    metrics.push(metric("payroll-review", "مسيرات للمراجعة", "Payroll periods under review", s.payroll.underReview, "/payroll"));
    if (context.sections.payrollAmounts && s.payroll.latestNet != null) {
      metrics.push(
        metric(
          "payroll-net",
          "صافي آخر فترة (تجميعي)",
          "Latest period net payroll (aggregate)",
          s.payroll.latestNet,
          "/payroll",
          true,
        ),
      );
    }
  }

  const commercialRisks = s.risks.filter((r) => r.category === "COMMERCIAL");

  return {
    kind: "finance",
    context,
    amountsVisible: amountsVisible || (context.sections.payrollAmounts && s.payroll?.latestNet != null),
    metrics,
    commercialRisks: commercialRisks.slice(0, 40),
    decisionBrief: buildDecisionBrief({
      snapshot: s,
      sections: {
        projects: false,
        approvals: false,
        procurement: false,
        finance: context.sections.finance,
        people: false,
        attendanceLeave: false,
        payroll: context.sections.payroll,
      },
    }),
    redactionNoteAr: redacted
      ? "المقاييس المالية مخفية — يتطلب صلاحيات مالية/تجارية. reports.management.read وحدها لا تكفي."
      : "المبالغ التفصيلية تُعرض في الشاشات التشغيلية حسب الصلاحيات. هذا التقرير يعرض أعداداً حالاتية.",
    redactionNoteEn: redacted
      ? "Financial metrics are hidden — finance/commercial permissions are required; reports.management.read alone is insufficient."
      : "Detailed amounts stay on the operational finance screens, subject to permissions. This report shows counts by status.",
  };
}

export function buildPeopleReport(input: {
  context: ManagementReportContext;
  snapshot: ManagementSnapshot;
  departmentDistribution: Array<{ nameAr: string; nameEn: string; count: number }>;
}): ManagementPeopleReport {
  const { context, snapshot: s, departmentDistribution } = input;
  const metrics: ReportMetric[] = [];
  if (s.people) {
    if (context.sections.employeeHeadcount) {
      metrics.push(metric("active", "موظفون نشطون", "Active employees", s.people.activeEmployees, "/employees"));
    }
    if (context.sections.compliance) {
      metrics.push(metric("compliance", "امتثال خلال 30 يوماً", "Compliance documents expiring ≤30 days", s.people.complianceExpiring30d));
    }
    if (context.sections.contracts) {
      metrics.push(metric("contracts", "عقود تنتهي خلال 30 يوماً", "Contracts ending ≤30 days", s.people.contractsEnding30d));
    }
    metrics.push(metric("on-leave", "في إجازة اليوم", "On leave today", s.people.onLeaveToday));
  }
  if (s.attendance && context.sections.attendanceLeave) {
    metrics.push(metric("present", "حاضرون", "Present", s.attendance.present));
    metrics.push(metric("absent", "غائبون", "Absent", s.attendance.absent));
    metrics.push(metric("mco", "بلا انصراف", "Missing checkout", s.attendance.missingCheckout));
    metrics.push(metric("leave-pending", "إجازات معلّقة", "Leave requests pending", s.attendance.pendingLeaveApprovals));
  }

  const peopleRisks = s.risks.filter((r) =>
    ["HR", "COMPLIANCE", "ATTENDANCE", "LEAVE"].includes(r.category),
  );

  return {
    kind: "people",
    context,
    metrics,
    departmentDistribution,
    peopleRisks: peopleRisks.slice(0, 40),
    decisionBrief: buildDecisionBrief({
      snapshot: s,
      sections: {
        projects: false,
        approvals: false,
        procurement: false,
        finance: false,
        people: context.sections.people,
        attendanceLeave: context.sections.attendanceLeave,
        payroll: false,
      },
    }),
    privacyNoteAr: "لا يتضمن هذا التقرير IBAN أو رواتب فردية أو تعويضات.",
    privacyNoteEn: "This report excludes IBANs, individual salaries and compensation.",
  };
}

export function buildPayrollReport(input: {
  context: ManagementReportContext;
  snapshot: ManagementSnapshot;
}): ManagementPayrollReport {
  const { context, snapshot: s } = input;
  const p = s.payroll;
  const amountsVisible = Boolean(context.sections.payrollAmounts && p?.latestNet != null);
  const metrics: ReportMetric[] = [];
  if (p) {
    metrics.push(metric("latest-label", "آخر فترة", "Latest period", p.latestLabel ?? "—"));
    metrics.push(metric("latest-status", "حالة آخر فترة", "Latest period status", p.latestStatus ?? "—"));
    metrics.push(metric("employees", "عدد موظفي آخر فترة", "Headcount in latest period", p.latestEmployeeCount ?? "—"));
    metrics.push(metric("under-review", "بانتظار المراجعة", "Under review", p.underReview, "/payroll"));
    metrics.push(metric("awaiting-lock", "معتمدة بانتظار القفل", "Awaiting lock", p.approvedAwaitingLock, "/payroll"));
    metrics.push(metric("locked-unpaid", "مقفلة غير مصروفة", "Unpaid entries in locked periods", p.lockedUnpaidEntries, "/payroll"));
    if (amountsVisible) {
      metrics.push(metric("latest-net", "صافي آخر فترة (تجميعي)", "Latest period net payroll (aggregate)", p.latestNet!, "/payroll", true));
    }
  }

  return {
    kind: "payroll",
    context,
    amountsVisible,
    metrics,
    payrollRisks: s.risks.filter((r) => r.category === "PAYROLL").slice(0, 40),
    decisionBrief: buildDecisionBrief({
      snapshot: s,
      sections: {
        projects: false,
        approvals: false,
        procurement: false,
        finance: false,
        people: false,
        attendanceLeave: false,
        payroll: true,
      },
    }),
    redactionNoteAr: amountsVisible
      ? null
      : "صافي المسير مخفي — يتطلب payroll.view_all. لا تُعرض رواتب الأفراد.",
    redactionNoteEn: amountsVisible
      ? null
      : "Net payroll is hidden — requires payroll.view_all. Individual pay is never shown.",
  };
}

export function buildRiskReport(input: {
  context: ManagementReportContext;
  findings: RiskFinding[];
}): ManagementRiskReport {
  const { context, findings } = input;
  return {
    kind: "risks",
    context,
    total: findings.length,
    bySeverity: countBySeverity(findings),
    byCategory: countByCategory(findings),
    findings,
    decisionBrief: buildDecisionBrief({
      snapshot: {
        projects: { active: 0, atRisk: 0, onHold: 0, overduePlannedEnd: 0 },
        approvals: { pending: 0, overdue: 0, assignedToMe: 0, recentlyRejected: 0 },
        procurement: {
          prAwaitingReview: 0,
          rfqIssued: 0,
          rfqNeedsComparison: 0,
          poReadyToIssue: 0,
          lateDeliveries: 0,
          invoicesAwaitingReview: 0,
        },
        commercial: null,
        people: null,
        attendance: null,
        payroll: null,
        risks: findings,
      },
      sections: {
        projects: false,
        approvals: false,
        procurement: false,
        finance: false,
        people: false,
        attendanceLeave: false,
        payroll: false,
      },
    }),
  };
}
