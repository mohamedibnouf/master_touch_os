import { MANAGEMENT_RISK_THRESHOLDS as T } from "../risk/thresholds";
import type { RiskFinding } from "../risk/types";
import type { ManagementSnapshot } from "../types";
import type { DecisionBriefSection } from "./types";

/** English count phrase with a regular or supplied plural: "1 approval", "3 approvals". */
function n(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function countSeverity(risks: RiskFinding[], sev: RiskFinding["severity"]): number {
  return risks.filter((r) => r.severity === sev).length;
}

/**
 * Deterministic decision brief — every statement maps to snapshot/risk counts.
 * No speculative prose.
 */
export function buildDecisionBrief(input: {
  snapshot: Pick<
    ManagementSnapshot,
    "projects" | "approvals" | "procurement" | "commercial" | "people" | "attendance" | "payroll" | "risks"
  >;
  sections: {
    projects: boolean;
    approvals: boolean;
    procurement: boolean;
    finance: boolean;
    people: boolean;
    attendanceLeave: boolean;
    payroll: boolean;
  };
}): DecisionBriefSection[] {
  const { snapshot: s, sections } = input;
  const out: DecisionBriefSection[] = [];

  const critical = countSeverity(s.risks, "CRITICAL");
  const high = countSeverity(s.risks, "HIGH");
  const attentionStatements: DecisionBriefSection["statements"] = [];
  if (critical > 0) {
    attentionStatements.push({
      id: "critical-risks",
      textAr: `${critical} مخاطر حرجة تتطلب مراجعة.`,
      textEn: `${n(critical, "critical risk")} ${critical === 1 ? "requires" : "require"} review.`,
      href: "/management/reports/risks?severity=CRITICAL",
      severity: "CRITICAL",
    });
  }
  if (high > 0) {
    attentionStatements.push({
      id: "high-risks",
      textAr: `${high} مخاطر عالية.`,
      textEn: `${n(high, "high-severity risk")} open.`,
      href: "/management/reports/risks?severity=HIGH",
      severity: "HIGH",
    });
  }
  if (sections.approvals && s.approvals.overdue > 0) {
    attentionStatements.push({
      id: "approvals-overdue",
      textAr: `${s.approvals.overdue} موافقات تجاوزت due_at.`,
      textEn: `${n(s.approvals.overdue, "approval")} overdue.`,
      href: "/approvals",
      severity: "HIGH",
    });
  }
  if (sections.approvals && s.approvals.pending > 0) {
    attentionStatements.push({
      id: "approvals-pending",
      textAr: `${s.approvals.pending} موافقات معلّقة (حد الانتباه ${T.approvalOpenDaysMedium} أيام للعمر — ليس SLA).`,
      textEn: `${n(s.approvals.pending, "pending approval")} (attention threshold: ${n(T.approvalOpenDaysMedium, "day")} open — not an SLA).`,
      href: "/approvals",
    });
  }
  if (attentionStatements.length > 0) {
    out.push({
      id: "attention-now",
      titleAr: "انتباه الآن",
      titleEn: "Needs attention now",
      statements: attentionStatements,
    });
  }

  if (sections.projects) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.projects.overduePlannedEnd > 0) {
      stmts.push({
        id: "projects-overdue",
        textAr: `${s.projects.overduePlannedEnd} مشاريع تجاوزت تاريخ الانتهاء المخطط.`,
        textEn: `${n(s.projects.overduePlannedEnd, "project")} past planned end date.`,
        href: "/management/reports/projects",
      });
    }
    if (s.projects.atRisk > 0) {
      stmts.push({
        id: "projects-declared-risk",
        textAr: `${s.projects.atRisk} مشاريع بمستوى مخاطر معلَن high/critical.`,
        textEn: `${n(s.projects.atRisk, "project")} declared at high or critical risk.`,
        href: "/management/reports/projects",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "projects", titleAr: "المشاريع", titleEn: "Projects", statements: stmts });
    }
  }

  if (sections.procurement) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.procurement.prAwaitingReview > 0) {
      stmts.push({
        id: "pr-queue",
        textAr: `${s.procurement.prAwaitingReview} طلبات شراء بانتظار المراجعة.`,
        textEn: `${n(s.procurement.prAwaitingReview, "purchase request")} awaiting review.`,
        href: "/management/reports/operations",
      });
    }
    if (s.procurement.lateDeliveries > 0) {
      stmts.push({
        id: "po-late",
        textAr: `${s.procurement.lateDeliveries} أوامر شراء تجاوزت تاريخ التسليم المطلوب.`,
        textEn: `${n(s.procurement.lateDeliveries, "purchase order")} past required delivery date.`,
        href: "/management/reports/operations",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "operations", titleAr: "العمليات", titleEn: "Operations", statements: stmts });
    }
  }

  if (sections.finance && s.commercial) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.commercial.overdueAr > 0) {
      stmts.push({
        id: "ar-overdue",
        textAr: `${s.commercial.overdueAr} فواتير عملاء متأخرة.`,
        textEn: `${n(s.commercial.overdueAr, "overdue client invoice")} (receivables).`,
        href: "/management/reports/finance",
      });
    }
    if (s.commercial.overdueAp > 0) {
      stmts.push({
        id: "ap-overdue",
        textAr: `${s.commercial.overdueAp} فواتير موردين تجاوزت due_date.`,
        textEn: `${n(s.commercial.overdueAp, "supplier invoice")} past due date (payables).`,
        href: "/management/reports/finance",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "commercial", titleAr: "التجاري", titleEn: "Commercial", statements: stmts });
    }
  }

  if (sections.people && s.people) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.people.complianceExpiring30d > 0) {
      stmts.push({
        id: "compliance",
        textAr: `${s.people.complianceExpiring30d} وثائق امتثال تنتهي خلال 30 يوماً.`,
        textEn: `${n(s.people.complianceExpiring30d, "compliance document")} expiring within 30 days.`,
        href: "/management/reports/people",
      });
    }
    if (s.people.contractsEnding30d > 0) {
      stmts.push({
        id: "contracts",
        textAr: `${s.people.contractsEnding30d} عقود تنتهي خلال 30 يوماً.`,
        textEn: `${n(s.people.contractsEnding30d, "employee contract")} ending within 30 days.`,
        href: "/management/reports/people",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "people", titleAr: "الأفراد", titleEn: "People", statements: stmts });
    }
  }

  if (sections.attendanceLeave && s.attendance) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.attendance.missingCheckout > 0) {
      stmts.push({
        id: "mco",
        textAr: `${s.attendance.missingCheckout} سجلات حضور بلا انصراف اليوم.`,
        textEn: `${n(s.attendance.missingCheckout, "attendance record")} without checkout today.`,
        href: "/management/reports/people",
      });
    }
    if (s.attendance.pendingLeaveApprovals > 0) {
      stmts.push({
        id: "leave",
        textAr: `${s.attendance.pendingLeaveApprovals} طلبات إجازة بانتظار الموافقة.`,
        textEn: `${n(s.attendance.pendingLeaveApprovals, "leave request")} awaiting approval.`,
        href: "/hr/leave",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "attendance", titleAr: "الحضور والإجازات", titleEn: "Attendance & leave", statements: stmts });
    }
  }

  if (sections.payroll && s.payroll) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.payroll.underReview > 0) {
      stmts.push({
        id: "payroll-review",
        textAr: `${s.payroll.underReview} فترة مسير بانتظار المراجعة${s.payroll.latestLabel ? ` (آخر فترة ${s.payroll.latestLabel})` : ""}.`,
        textEn: `${n(s.payroll.underReview, "payroll period")} awaiting review${s.payroll.latestLabel ? ` (latest: ${s.payroll.latestLabel})` : ""}.`,
        href: "/management/reports/payroll",
      });
    }
    if (s.payroll.approvedAwaitingLock > 0) {
      stmts.push({
        id: "payroll-lock",
        textAr: `${s.payroll.approvedAwaitingLock} فترة مسير معتمدة بانتظار القفل.`,
        textEn: `${n(s.payroll.approvedAwaitingLock, "approved payroll period")} awaiting lock.`,
        href: "/management/reports/payroll",
      });
    }
    if (s.payroll.lockedUnpaidEntries > 0) {
      stmts.push({
        id: "payroll-unpaid",
        textAr: `${s.payroll.lockedUnpaidEntries} قيود مسير مقفلة غير مصروفة.`,
        textEn: `${n(s.payroll.lockedUnpaidEntries, "unpaid payroll entry", "unpaid payroll entries")} in locked periods.`,
        href: "/management/reports/payroll",
        severity: "HIGH",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "payroll", titleAr: "الرواتب", titleEn: "Payroll", statements: stmts });
    }
  }

  if (out.length === 0) {
    out.push({
      id: "clear",
      titleAr: "ملخص",
      titleEn: "Summary",
      statements: [
        {
          id: "none",
          textAr: "لا توجد عناصر انتباه وفق القواعد الحتمية المتاحة حالياً.",
          textEn: "No items need attention under the current rules.",
        },
      ],
    });
  }

  return out;
}
