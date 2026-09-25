import { MANAGEMENT_RISK_THRESHOLDS as T } from "../risk/thresholds";
import type { RiskFinding } from "../risk/types";
import type { ManagementSnapshot } from "../types";
import type { DecisionBriefSection } from "./types";

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
      textEn: `${critical} critical risk finding(s) require review.`,
      href: "/management/reports/risks?severity=CRITICAL",
      severity: "CRITICAL",
    });
  }
  if (high > 0) {
    attentionStatements.push({
      id: "high-risks",
      textAr: `${high} مخاطر عالية.`,
      textEn: `${high} high-severity risk finding(s).`,
      href: "/management/reports/risks?severity=HIGH",
      severity: "HIGH",
    });
  }
  if (sections.approvals && s.approvals.overdue > 0) {
    attentionStatements.push({
      id: "approvals-overdue",
      textAr: `${s.approvals.overdue} موافقات تجاوزت due_at.`,
      textEn: `${s.approvals.overdue} approval(s) past due_at.`,
      href: "/approvals",
      severity: "HIGH",
    });
  }
  if (sections.approvals && s.approvals.pending > 0) {
    attentionStatements.push({
      id: "approvals-pending",
      textAr: `${s.approvals.pending} موافقات معلّقة (حد الانتباه ${T.approvalOpenDaysMedium} أيام للعمر — ليس SLA).`,
      textEn: `${s.approvals.pending} pending approval(s) (attention age threshold ${T.approvalOpenDaysMedium} days — not an SLA).`,
      href: "/approvals",
    });
  }
  if (attentionStatements.length > 0) {
    out.push({
      id: "attention-now",
      titleAr: "انتباه الآن",
      titleEn: "ATTENTION NOW",
      statements: attentionStatements,
    });
  }

  if (sections.projects) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.projects.overduePlannedEnd > 0) {
      stmts.push({
        id: "projects-overdue",
        textAr: `${s.projects.overduePlannedEnd} مشاريع تجاوزت تاريخ الانتهاء المخطط.`,
        textEn: `${s.projects.overduePlannedEnd} project(s) past planned end date.`,
        href: "/management/reports/projects",
      });
    }
    if (s.projects.atRisk > 0) {
      stmts.push({
        id: "projects-declared-risk",
        textAr: `${s.projects.atRisk} مشاريع بمستوى مخاطر معلَن high/critical.`,
        textEn: `${s.projects.atRisk} project(s) with declared high/critical risk_level.`,
        href: "/management/reports/projects",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "projects", titleAr: "المشاريع", titleEn: "PROJECTS", statements: stmts });
    }
  }

  if (sections.procurement) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.procurement.prAwaitingReview > 0) {
      stmts.push({
        id: "pr-queue",
        textAr: `${s.procurement.prAwaitingReview} طلبات شراء بانتظار المراجعة.`,
        textEn: `${s.procurement.prAwaitingReview} purchase request(s) awaiting review.`,
        href: "/management/reports/operations",
      });
    }
    if (s.procurement.lateDeliveries > 0) {
      stmts.push({
        id: "po-late",
        textAr: `${s.procurement.lateDeliveries} أوامر شراء تجاوزت تاريخ التسليم المطلوب.`,
        textEn: `${s.procurement.lateDeliveries} PO(s) past required delivery date.`,
        href: "/management/reports/operations",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "operations", titleAr: "العمليات", titleEn: "OPERATIONS", statements: stmts });
    }
  }

  if (sections.finance && s.commercial) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.commercial.overdueAr > 0) {
      stmts.push({
        id: "ar-overdue",
        textAr: `${s.commercial.overdueAr} فواتير عملاء متأخرة.`,
        textEn: `${s.commercial.overdueAr} overdue client invoice(s).`,
        href: "/management/reports/finance",
      });
    }
    if (s.commercial.overdueAp > 0) {
      stmts.push({
        id: "ap-overdue",
        textAr: `${s.commercial.overdueAp} فواتير موردين تجاوزت due_date.`,
        textEn: `${s.commercial.overdueAp} supplier invoice(s) past due_date.`,
        href: "/management/reports/finance",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "commercial", titleAr: "التجاري", titleEn: "COMMERCIAL", statements: stmts });
    }
  }

  if (sections.people && s.people) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.people.complianceExpiring30d > 0) {
      stmts.push({
        id: "compliance",
        textAr: `${s.people.complianceExpiring30d} وثائق امتثال تنتهي خلال 30 يوماً.`,
        textEn: `${s.people.complianceExpiring30d} compliance document(s) expiring within 30 days.`,
        href: "/management/reports/people",
      });
    }
    if (s.people.contractsEnding30d > 0) {
      stmts.push({
        id: "contracts",
        textAr: `${s.people.contractsEnding30d} عقود تنتهي خلال 30 يوماً.`,
        textEn: `${s.people.contractsEnding30d} contract(s) ending within 30 days.`,
        href: "/management/reports/people",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "people", titleAr: "الأفراد", titleEn: "PEOPLE", statements: stmts });
    }
  }

  if (sections.attendanceLeave && s.attendance) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.attendance.missingCheckout > 0) {
      stmts.push({
        id: "mco",
        textAr: `${s.attendance.missingCheckout} سجلات حضور بلا انصراف اليوم.`,
        textEn: `${s.attendance.missingCheckout} missing checkout(s) today.`,
        href: "/management/reports/people",
      });
    }
    if (s.attendance.pendingLeaveApprovals > 0) {
      stmts.push({
        id: "leave",
        textAr: `${s.attendance.pendingLeaveApprovals} طلبات إجازة بانتظار الموافقة.`,
        textEn: `${s.attendance.pendingLeaveApprovals} leave request(s) awaiting approval.`,
        href: "/hr/leave",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "attendance", titleAr: "الحضور والإجازات", titleEn: "ATTENDANCE / LEAVE", statements: stmts });
    }
  }

  if (sections.payroll && s.payroll) {
    const stmts: DecisionBriefSection["statements"] = [];
    if (s.payroll.underReview > 0) {
      stmts.push({
        id: "payroll-review",
        textAr: `${s.payroll.underReview} فترة مسير بانتظار المراجعة${s.payroll.latestLabel ? ` (آخر فترة ${s.payroll.latestLabel})` : ""}.`,
        textEn: `${s.payroll.underReview} payroll period(s) awaiting review${s.payroll.latestLabel ? ` (latest ${s.payroll.latestLabel})` : ""}.`,
        href: "/management/reports/payroll",
      });
    }
    if (s.payroll.approvedAwaitingLock > 0) {
      stmts.push({
        id: "payroll-lock",
        textAr: `${s.payroll.approvedAwaitingLock} فترة مسير معتمدة بانتظار القفل.`,
        textEn: `${s.payroll.approvedAwaitingLock} approved payroll period(s) awaiting lock.`,
        href: "/management/reports/payroll",
      });
    }
    if (s.payroll.lockedUnpaidEntries > 0) {
      stmts.push({
        id: "payroll-unpaid",
        textAr: `${s.payroll.lockedUnpaidEntries} قيود مسير مقفلة غير مصروفة.`,
        textEn: `${s.payroll.lockedUnpaidEntries} locked unpaid payroll entr(y/ies).`,
        href: "/management/reports/payroll",
        severity: "HIGH",
      });
    }
    if (stmts.length > 0) {
      out.push({ id: "payroll", titleAr: "الرواتب", titleEn: "PAYROLL", statements: stmts });
    }
  }

  if (out.length === 0) {
    out.push({
      id: "clear",
      titleAr: "ملخص",
      titleEn: "SUMMARY",
      statements: [
        {
          id: "none",
          textAr: "لا توجد عناصر انتباه وفق القواعد الحتمية المتاحة حالياً.",
          textEn: "No attention items under the available deterministic rules.",
        },
      ],
    });
  }

  return out;
}
