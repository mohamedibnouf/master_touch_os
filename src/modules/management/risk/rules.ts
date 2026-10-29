import { commercialEntityHref } from "@/lib/commercial/entity-routes";
import { MANAGEMENT_RISK_THRESHOLDS as T } from "./thresholds";
import { daysBetweenYmd, findingId, isoToYmd } from "./date-utils";
import type { RiskFinding, RiskInputSnapshot, RiskRule, RiskSourceType } from "./types";
import type { ManagementRiskSeverity } from "../types";

const OPEN_PROJECT = new Set(["active", "on_hold"]);
const OPEN_APPROVAL = new Set(["pending", "in_progress"]);
const OPEN_PO = new Set([
  "draft",
  "pending_approval",
  "approved",
  "issued",
  "partially_delivered",
  "partially_invoiced",
  "invoiced",
]);
const OPEN_SUPPLIER_INV = new Set([
  "received",
  "under_review",
  "matched",
  "discrepancy",
  "approved_for_payment",
  "partially_paid",
]);
const OPEN_CLIENT_INV = new Set(["issued", "partially_paid", "overdue"]);
const PENDING_VALUATION = new Set(["internal_review", "submitted", "under_client_review"]);
const PENDING_VARIATION = new Set(["under_review", "submitted", "negotiation"]);

function severityByOverdueDays(
  days: number,
  medium: number,
  high: number,
  critical?: number,
): ManagementRiskSeverity {
  if (critical != null && days >= critical) return "CRITICAL";
  if (days >= high) return "HIGH";
  if (days >= medium) return "MEDIUM";
  return "LOW";
}

/** English count phrase: "1 day", "3 days". */
function daysEn(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/** Status codes read better in English prose without underscores. */
function statusEn(status: string): string {
  return status.replace(/_/g, " ");
}

const COMPLIANCE_LABEL_EN: Record<string, string> = {
  iqama: "Iqama",
  passport: "Passport",
  work_permit: "Work permit",
  insurance: "Medical insurance",
};

function f(partial: Omit<RiskFinding, "id"> & { sourceType: RiskSourceType; sourceId: string }): RiskFinding {
  return {
    ...partial,
    id: findingId(partial.ruleId, partial.sourceType, partial.sourceId),
  };
}

function approvalHref(row: RiskInputSnapshot["approvals"][number]): string {
  if (row.entity_type && row.entity_id) {
    const href = commercialEntityHref(row.entity_type, row.entity_id);
    if (href) return href;
  }
  return "/approvals";
}

const projectPlannedEndOverdue: RiskRule = {
  id: "PROJECT_PLANNED_END_OVERDUE",
  category: "PROJECT_DELAY",
  evaluate(input) {
    if (!input.sections.projects) return [];
    const out: RiskFinding[] = [];
    for (const p of input.projects) {
      if (!OPEN_PROJECT.has(p.status) || !p.planned_end_date) continue;
      const days = daysBetweenYmd(p.planned_end_date, input.asOfDate);
      if (days < T.projectOverdueDaysMedium) continue;
      const severity = severityByOverdueDays(
        days,
        T.projectOverdueDaysMedium,
        T.projectOverdueDaysHigh,
        T.projectOverdueDaysCritical,
      );
      const label = `${p.project_code} — ${p.name_ar}`;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity,
          titleAr: "مشروع تجاوز تاريخ الانتهاء المخطط",
          titleEn: "Project past planned end date",
          explanationAr: `المشروع ${label} ما زال بحالة ${p.status} بينما planned_end_date كان ${p.planned_end_date} (منذ ${days} يوماً).`,
          explanationEn: `Project ${label} is still ${statusEn(p.status)}; its planned end date was ${p.planned_end_date} (${daysEn(days)} ago).`,
          evidence: {
            status: p.status,
            planned_end_date: p.planned_end_date,
            overdue_days: days,
          },
          sourceType: "project",
          sourceId: p.id,
          href: `/projects/${p.id}`,
          effectiveSince: p.planned_end_date,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const projectDeclaredHighRisk: RiskRule = {
  id: "PROJECT_DECLARED_HIGH_RISK",
  category: "PROJECT_DELAY",
  evaluate(input) {
    if (!input.sections.projects) return [];
    const out: RiskFinding[] = [];
    for (const p of input.projects) {
      if (!OPEN_PROJECT.has(p.status)) continue;
      if (p.risk_level !== "high" && p.risk_level !== "critical") continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: p.risk_level === "critical" ? "CRITICAL" : "HIGH",
          titleAr: "مشروع بمستوى مخاطر معلَن",
          titleEn: "Project with declared high risk",
          explanationAr: `المشروع ${p.project_code} مسجّل بمستوى مخاطر ${p.risk_level} (قيمة تشغيلية معلنة وليست تنبؤاً).`,
          explanationEn: `Project ${p.project_code} is declared at ${p.risk_level} risk level (operational declaration, not a prediction).`,
          evidence: { risk_level: p.risk_level, status: p.status },
          sourceType: "project",
          sourceId: p.id,
          href: `/projects/${p.id}`,
          effectiveSince: null,
          ageDays: null,
        }),
      );
    }
    return out;
  },
};

const approvalPastDue: RiskRule = {
  id: "APPROVAL_PAST_DUE",
  category: "APPROVAL_DELAY",
  evaluate(input) {
    if (!input.sections.approvals) return [];
    const out: RiskFinding[] = [];
    for (const a of input.approvals) {
      if (!OPEN_APPROVAL.has(a.status) || !a.due_at) continue;
      if (a.due_at >= input.asOfInstant) continue;
      const since = isoToYmd(a.due_at);
      const days = Math.max(0, daysBetweenYmd(since, input.asOfDate));
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days >= 7 ? "HIGH" : "MEDIUM",
          titleAr: "موافقة تجاوزت تاريخ الاستحقاق",
          titleEn: "Approval overdue",
          explanationAr: `طلب الموافقة «${a.title ?? a.id.slice(0, 8)}» ما زال ${a.status} وdue_at=${a.due_at} مضى منذ ${days} يوماً.`,
          explanationEn: `Approval “${a.title ?? a.id.slice(0, 8)}” is still ${statusEn(a.status)}; it was due on ${a.due_at} (${daysEn(days)} ago).`,
          evidence: { status: a.status, due_at: a.due_at, overdue_days: days },
          sourceType: "approval_request",
          sourceId: a.id,
          href: approvalHref(a),
          effectiveSince: since,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const approvalOpenAge: RiskRule = {
  id: "APPROVAL_PENDING_AGE",
  category: "APPROVAL_DELAY",
  evaluate(input) {
    if (!input.sections.approvals) return [];
    const out: RiskFinding[] = [];
    for (const a of input.approvals) {
      if (!OPEN_APPROVAL.has(a.status)) continue;
      // Prefer past-due rule when due_at already breached — avoid duplicate noise.
      if (a.due_at && a.due_at < input.asOfInstant) continue;
      const since = isoToYmd(a.created_at);
      const days = daysBetweenYmd(since, input.asOfDate);
      if (days < T.approvalOpenDaysMedium) continue;
      const severity: ManagementRiskSeverity =
        days >= T.approvalOpenDaysHigh ? "HIGH" : "MEDIUM";
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity,
          titleAr: "موافقة معلّقة لفترة طويلة",
          titleEn: "Long-pending approval",
          explanationAr: `طلب الموافقة «${a.title ?? a.id.slice(0, 8)}» مفتوح منذ ${days} يوماً (حد الانتباه الإداري ${T.approvalOpenDaysMedium} أيام — ليس SLA تعاقدياً).`,
          explanationEn: `Approval “${a.title ?? a.id.slice(0, 8)}” has been open for ${daysEn(days)} (management attention threshold: ${daysEn(T.approvalOpenDaysMedium)} — not a contractual SLA).`,
          evidence: {
            status: a.status,
            created_at: a.created_at,
            open_days: days,
            threshold_days: T.approvalOpenDaysMedium,
          },
          sourceType: "approval_request",
          sourceId: a.id,
          href: approvalHref(a),
          effectiveSince: since,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const prPendingAge: RiskRule = {
  id: "PR_PENDING",
  category: "PROCUREMENT",
  evaluate(input) {
    if (!input.sections.purchaseRequests) return [];
    const out: RiskFinding[] = [];
    for (const pr of input.purchaseRequests) {
      if (!["submitted", "under_review"].includes(pr.status)) continue;
      const since = isoToYmd(pr.created_at);
      const days = daysBetweenYmd(since, input.asOfDate);
      if (days < T.prOpenDaysMedium) continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days >= T.prOpenDaysHigh ? "HIGH" : "MEDIUM",
          titleAr: "طلب شراء مفتوح لفترة",
          titleEn: "Long-open purchase request",
          explanationAr: `طلب الشراء ${pr.pr_number ?? pr.id.slice(0, 8)} بحالة ${pr.status} ومفتوح منذ ${days} يوماً.`,
          explanationEn: `Purchase request ${pr.pr_number ?? pr.id.slice(0, 8)} is ${statusEn(pr.status)} and has been open for ${daysEn(days)}.`,
          evidence: { status: pr.status, open_days: days, created_at: pr.created_at },
          sourceType: "purchase_request",
          sourceId: pr.id,
          href: `/procurement/purchase-requests/${pr.id}`,
          effectiveSince: since,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const rfqResponseDuePassed: RiskRule = {
  id: "RFQ_RESPONSE_DUE_PASSED",
  category: "PROCUREMENT",
  evaluate(input) {
    if (!input.sections.rfqs) return [];
    const out: RiskFinding[] = [];
    for (const r of input.rfqs) {
      if (r.status !== "issued" || !r.response_due_date) continue;
      const days = daysBetweenYmd(r.response_due_date, input.asOfDate);
      if (days < 1) continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days >= 7 ? "HIGH" : "MEDIUM",
          titleAr: "مناقصة تجاوزت تاريخ الرد",
          titleEn: "RFQ past response deadline",
          explanationAr: `المناقصة ${r.rfq_number ?? r.id.slice(0, 8)} صادرة وresponse_due_date=${r.response_due_date} مضى منذ ${days} يوماً.`,
          explanationEn: `RFQ ${r.rfq_number ?? r.id.slice(0, 8)} is issued; responses were due on ${r.response_due_date} (${daysEn(days)} ago).`,
          evidence: { status: r.status, response_due_date: r.response_due_date, overdue_days: days },
          sourceType: "rfq",
          sourceId: r.id,
          href: `/procurement/rfqs/${r.id}`,
          effectiveSince: r.response_due_date,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const rfqNeedsComparison: RiskRule = {
  id: "RFQ_NEEDS_COMPARISON",
  category: "PROCUREMENT",
  evaluate(input) {
    if (!input.sections.rfqs) return [];
    return input.rfqs
      .filter((r) => r.status === "responses_received")
      .map((r) =>
        f({
          ruleId: this.id,
          category: this.category,
          severity: "MEDIUM",
          titleAr: "مناقصة تحتاج مقارنة عروض",
          titleEn: "RFQ awaiting quotation comparison",
          explanationAr: `المناقصة ${r.rfq_number ?? r.id.slice(0, 8)} بحالة responses_received وتحتاج مقارنة.`,
          explanationEn: `RFQ ${r.rfq_number ?? r.id.slice(0, 8)} has received responses and needs a quotation comparison.`,
          evidence: { status: r.status },
          sourceType: "rfq",
          sourceId: r.id,
          href: `/procurement/rfqs/${r.id}/comparison`,
          effectiveSince: isoToYmd(r.created_at),
          ageDays: daysBetweenYmd(isoToYmd(r.created_at), input.asOfDate),
        }),
      );
  },
};

const poReadyToIssue: RiskRule = {
  id: "PO_READY_TO_ISSUE",
  category: "PROCUREMENT",
  evaluate(input) {
    if (!input.sections.purchaseOrders) return [];
    return input.purchaseOrders
      .filter((p) => p.status === "approved")
      .map((p) =>
        f({
          ruleId: this.id,
          category: this.category,
          severity: "MEDIUM",
          titleAr: "أمر شراء جاهز للإصدار",
          titleEn: "Purchase order ready to issue",
          explanationAr: `أمر الشراء ${p.po_number ?? p.id.slice(0, 8)} بحالة approved ولم يُصدر بعد.`,
          explanationEn: `Purchase order ${p.po_number ?? p.id.slice(0, 8)} is approved but not yet issued.`,
          evidence: { status: p.status },
          sourceType: "purchase_order",
          sourceId: p.id,
          href: `/procurement/purchase-orders/${p.id}`,
          effectiveSince: null,
          ageDays: null,
        }),
      );
  },
};

const poDeliveryDatePassed: RiskRule = {
  id: "PO_DELIVERY_DATE_PASSED",
  category: "PROCUREMENT",
  evaluate(input) {
    if (!input.sections.purchaseOrders) return [];
    const out: RiskFinding[] = [];
    for (const p of input.purchaseOrders) {
      if (!OPEN_PO.has(p.status) || !p.required_delivery_date) continue;
      const days = daysBetweenYmd(p.required_delivery_date, input.asOfDate);
      if (days < 1) continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days >= 14 ? "HIGH" : "MEDIUM",
          titleAr: "أمر شراء تجاوز تاريخ التسليم المطلوب",
          titleEn: "Purchase order delivery overdue",
          explanationAr: `أمر الشراء ${p.po_number ?? p.id.slice(0, 8)} ما زال ${p.status} وrequired_delivery_date=${p.required_delivery_date} مضى منذ ${days} يوماً.`,
          explanationEn: `Purchase order ${p.po_number ?? p.id.slice(0, 8)} is still ${statusEn(p.status)}; delivery was required by ${p.required_delivery_date} (${daysEn(days)} ago).`,
          evidence: {
            status: p.status,
            required_delivery_date: p.required_delivery_date,
            overdue_days: days,
          },
          sourceType: "purchase_order",
          sourceId: p.id,
          href: `/procurement/purchase-orders/${p.id}`,
          effectiveSince: p.required_delivery_date,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const supplierInvoicePastDue: RiskRule = {
  id: "SUPPLIER_INVOICE_OVERDUE",
  category: "COMMERCIAL",
  evaluate(input) {
    if (!input.sections.supplierInvoices && !input.sections.finance) return [];
    const out: RiskFinding[] = [];
    for (const inv of input.supplierInvoices) {
      if (!OPEN_SUPPLIER_INV.has(inv.status) || !inv.due_date) continue;
      const days = daysBetweenYmd(inv.due_date, input.asOfDate);
      if (days < 1) continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days >= 14 ? "HIGH" : "MEDIUM",
          titleAr: "فاتورة مورد تجاوزت تاريخ الاستحقاق",
          titleEn: "Supplier invoice overdue",
          explanationAr: `فاتورة المورد ${inv.invoice_number ?? inv.id.slice(0, 8)} ما زالت ${inv.status} وdue_date=${inv.due_date} مضى منذ ${days} يوماً.`,
          explanationEn: `Supplier invoice ${inv.invoice_number ?? inv.id.slice(0, 8)} is still ${statusEn(inv.status)}; it was due on ${inv.due_date} (${daysEn(days)} ago).`,
          evidence: { status: inv.status, due_date: inv.due_date, overdue_days: days },
          sourceType: "supplier_invoice",
          sourceId: inv.id,
          href: `/finance/supplier-invoices/${inv.id}`,
          effectiveSince: inv.due_date,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const clientInvoicePastDue: RiskRule = {
  id: "CLIENT_INVOICE_OVERDUE",
  category: "COMMERCIAL",
  evaluate(input) {
    if (!input.sections.finance) return [];
    const out: RiskFinding[] = [];
    for (const inv of input.clientInvoices) {
      if (!OPEN_CLIENT_INV.has(inv.status)) continue;
      const byStatus = inv.status === "overdue";
      const byDate = inv.due_date ? daysBetweenYmd(inv.due_date, input.asOfDate) >= 1 : false;
      if (!byStatus && !byDate) continue;
      const days = inv.due_date ? Math.max(0, daysBetweenYmd(inv.due_date, input.asOfDate)) : null;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: (days ?? 0) >= 14 || byStatus ? "HIGH" : "MEDIUM",
          titleAr: "فاتورة عميل متأخرة",
          titleEn: "Client invoice overdue",
          explanationAr: byStatus
            ? `فاتورة العميل ${inv.invoice_number ?? inv.id.slice(0, 8)} بحالة overdue${inv.due_date ? ` (due_date=${inv.due_date})` : ""}.`
            : `فاتورة العميل ${inv.invoice_number ?? inv.id.slice(0, 8)} due_date=${inv.due_date} مضى منذ ${days} يوماً.`,
          explanationEn: byStatus
            ? `Client invoice ${inv.invoice_number ?? inv.id.slice(0, 8)} is marked overdue${inv.due_date ? ` (due ${inv.due_date})` : ""}.`
            : `Client invoice ${inv.invoice_number ?? inv.id.slice(0, 8)} was due on ${inv.due_date} (${daysEn(days ?? 0)} ago).`,
          evidence: {
            status: inv.status,
            due_date: inv.due_date,
            overdue_days: days,
          },
          sourceType: "client_invoice",
          sourceId: inv.id,
          href: `/finance/client-invoices/${inv.id}`,
          effectiveSince: inv.due_date,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const valuationPending: RiskRule = {
  id: "VALUATION_PENDING",
  category: "COMMERCIAL",
  evaluate(input) {
    if (!input.sections.finance) return [];
    const out: RiskFinding[] = [];
    for (const v of input.valuations) {
      if (!PENDING_VALUATION.has(v.status)) continue;
      const since = isoToYmd(v.created_at);
      const days = daysBetweenYmd(since, input.asOfDate);
      if (days < T.commercialPendingDaysMedium) continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days >= T.commercialPendingDaysHigh ? "HIGH" : "MEDIUM",
          titleAr: "مستخلص عميل معلّق",
          titleEn: "Client valuation pending",
          explanationAr: `المستخلص ${v.valuation_number ?? v.id.slice(0, 8)} بحالة ${v.status} ومفتوح منذ ${days} يوماً.`,
          explanationEn: `Valuation ${v.valuation_number ?? v.id.slice(0, 8)} is ${statusEn(v.status)} and has been open for ${daysEn(days)}.`,
          evidence: { status: v.status, open_days: days },
          sourceType: "client_valuation",
          sourceId: v.id,
          href: `/finance/client-valuations/${v.id}`,
          effectiveSince: since,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const variationPending: RiskRule = {
  id: "VARIATION_PENDING",
  category: "COMMERCIAL",
  evaluate(input) {
    if (!input.sections.finance) return [];
    const out: RiskFinding[] = [];
    for (const v of input.variations) {
      if (!PENDING_VARIATION.has(v.status)) continue;
      const since = isoToYmd(v.created_at);
      const days = daysBetweenYmd(since, input.asOfDate);
      if (days < T.commercialPendingDaysMedium) continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days >= T.commercialPendingDaysHigh ? "HIGH" : "MEDIUM",
          titleAr: "أمر تغيير معلّق",
          titleEn: "Variation order pending decision",
          explanationAr: `أمر التغيير ${v.vo_number ?? v.id.slice(0, 8)} بحالة ${v.status} ومفتوح منذ ${days} يوماً.`,
          explanationEn: `Variation order ${v.vo_number ?? v.id.slice(0, 8)} is ${statusEn(v.status)} and has been open for ${daysEn(days)}.`,
          evidence: { status: v.status, open_days: days },
          sourceType: "variation",
          sourceId: v.id,
          href: `/finance/variations/${v.id}`,
          effectiveSince: since,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

function complianceFindings(input: RiskInputSnapshot): RiskFinding[] {
  if (!input.sections.compliance) return [];
  const fields: Array<{ key: keyof RiskInputSnapshot["compliance"][number]; label: string }> = [
    { key: "iqama_expiry", label: "iqama" },
    { key: "passport_expiry", label: "passport" },
    { key: "work_permit_expiry", label: "work_permit" },
    { key: "insurance_expiry", label: "insurance" },
  ];
  const out: RiskFinding[] = [];
  for (const row of input.compliance) {
    for (const field of fields) {
      const expiry = row[field.key];
      if (typeof expiry !== "string" || !expiry) continue;
      const days = daysBetweenYmd(input.asOfDate, expiry);
      if (days < 0) {
        out.push(
          f({
            ruleId: "COMPLIANCE_EXPIRED",
            category: "COMPLIANCE",
            severity: "HIGH",
            titleAr: "وثيقة امتثال منتهية",
            titleEn: "Compliance document expired",
            explanationAr: `انتهت صلاحية ${field.label} للموظف ${row.employee_id.slice(0, 8)}… بتاريخ ${expiry} (منذ ${-days} يوماً).`,
            explanationEn: `${COMPLIANCE_LABEL_EN[field.label] ?? field.label} for employee ${row.employee_id.slice(0, 8)}… expired on ${expiry} (${daysEn(-days)} ago).`,
            evidence: { field: field.label, expiry, days_past: -days },
            sourceType: "employee_compliance",
            sourceId: `${row.employee_id}:${field.label}`,
            href: `/employees/${row.employee_id}`,
            effectiveSince: expiry,
            ageDays: -days,
          }),
        );
      } else if (days <= T.expiryWarningDays) {
        out.push(
          f({
            ruleId: "COMPLIANCE_EXPIRING",
            category: "COMPLIANCE",
            severity: days <= 7 ? "HIGH" : "MEDIUM",
            titleAr: "وثيقة امتثال تنتهي قريباً",
            titleEn: "Compliance document expiring soon",
            explanationAr: `${field.label} للموظف ${row.employee_id.slice(0, 8)}… تنتهي في ${expiry} (خلال ${days} يوماً؛ حد التحذير ${T.expiryWarningDays}).`,
            explanationEn: `${COMPLIANCE_LABEL_EN[field.label] ?? field.label} for employee ${row.employee_id.slice(0, 8)}… expires on ${expiry} (in ${daysEn(days)}; warning window ${daysEn(T.expiryWarningDays)}).`,
            evidence: { field: field.label, expiry, days_remaining: days },
            sourceType: "employee_compliance",
            sourceId: `${row.employee_id}:${field.label}`,
            href: `/employees/${row.employee_id}`,
            effectiveSince: null,
            ageDays: days,
          }),
        );
      }
    }
  }
  return out;
}

const complianceExpired: RiskRule = {
  id: "COMPLIANCE_EXPIRED",
  category: "COMPLIANCE",
  evaluate: (input) => complianceFindings(input).filter((x) => x.ruleId === "COMPLIANCE_EXPIRED"),
};

const complianceExpiring: RiskRule = {
  id: "COMPLIANCE_EXPIRING",
  category: "COMPLIANCE",
  evaluate: (input) => complianceFindings(input).filter((x) => x.ruleId === "COMPLIANCE_EXPIRING"),
};

const contractExpiring: RiskRule = {
  id: "CONTRACT_EXPIRING",
  category: "HR",
  evaluate(input) {
    if (!input.sections.contracts) return [];
    const out: RiskFinding[] = [];
    for (const c of input.contracts) {
      if (!c.end_date) continue;
      const days = daysBetweenYmd(input.asOfDate, c.end_date);
      if (days < 0 || days > T.expiryWarningDays) continue;
      out.push(
        f({
          ruleId: this.id,
          category: this.category,
          severity: days <= 7 ? "HIGH" : "MEDIUM",
          titleAr: "عقد ينتهي قريباً",
          titleEn: "Employee contract ending soon",
          explanationAr: `العقد ${c.contract_number} ينتهي في ${c.end_date} (خلال ${days} يوماً).`,
          explanationEn: `Contract ${c.contract_number} ends on ${c.end_date} (in ${daysEn(days)}).`,
          evidence: { end_date: c.end_date, days_remaining: days },
          sourceType: "employee_contract",
          sourceId: c.id,
          href: `/employees/${c.employee_id}`,
          effectiveSince: null,
          ageDays: days,
        }),
      );
    }
    return out;
  },
};

const missingCheckout: RiskRule = {
  id: "MISSING_CHECKOUT",
  category: "ATTENDANCE",
  evaluate(input) {
    if (!input.sections.attendanceLeave) return [];
    return input.attendanceToday
      .filter((r) => r.attendance_status === "missing_checkout")
      .map((r) =>
        f({
          ruleId: this.id,
          category: this.category,
          severity: "MEDIUM",
          titleAr: "حضور بلا انصراف اليوم",
          titleEn: "Missing checkout today",
          explanationAr: `سجل حضور ${r.id.slice(0, 8)}… ليوم ${input.asOfDate} بحالة missing_checkout.`,
          explanationEn: `Attendance record ${r.id.slice(0, 8)}… on ${input.asOfDate} has no checkout.`,
          evidence: { attendance_date: input.asOfDate, attendance_status: r.attendance_status },
          sourceType: "attendance_record",
          sourceId: r.id,
          href: "/hr/attendance",
          effectiveSince: input.asOfDate,
          ageDays: 0,
        }),
      );
  },
};

const absentToday: RiskRule = {
  id: "ABSENT_TODAY",
  category: "ATTENDANCE",
  evaluate(input) {
    if (!input.sections.attendanceLeave) return [];
    return input.attendanceToday
      .filter((r) => r.attendance_status === "absent")
      .map((r) =>
        f({
          ruleId: this.id,
          category: this.category,
          severity: "LOW",
          titleAr: "غياب اليوم",
          titleEn: "Absent today",
          explanationAr: `سجل حضور ${r.id.slice(0, 8)}… ليوم ${input.asOfDate} بحالة absent (لا يُفسَّر كاتجاه متكرر).`,
          explanationEn: `Attendance record ${r.id.slice(0, 8)}… on ${input.asOfDate} is marked absent (a single day, not a repeated-absence trend).`,
          evidence: { attendance_date: input.asOfDate, attendance_status: r.attendance_status },
          sourceType: "attendance_record",
          sourceId: r.id,
          href: "/hr/attendance",
          effectiveSince: input.asOfDate,
          ageDays: 0,
        }),
      );
  },
};

const leavePending: RiskRule = {
  id: "LEAVE_PENDING",
  category: "LEAVE",
  evaluate(input) {
    if (!input.sections.attendanceLeave) return [];
    return input.leavePending.map((r) => {
      const since = isoToYmd(r.created_at);
      const days = daysBetweenYmd(since, input.asOfDate);
      return f({
        ruleId: this.id,
        category: this.category,
        severity: days >= 3 ? "MEDIUM" : "LOW",
        titleAr: "طلب إجازة بانتظار الموافقة",
        titleEn: "Leave request awaiting approval",
        explanationAr: `طلب إجازة ${r.id.slice(0, 8)}… بحالة submitted ومفتوح منذ ${days} يوماً.`,
        explanationEn: `Leave request ${r.id.slice(0, 8)}… was submitted and has been awaiting approval for ${daysEn(days)}.`,
        evidence: { status: "submitted", open_days: days },
        sourceType: "leave_request",
        sourceId: r.id,
        href: `/leave/${r.id}`,
        effectiveSince: since,
        ageDays: days,
      });
    });
  },
};

const payrollWaitingReview: RiskRule = {
  id: "PAYROLL_WAITING_REVIEW",
  category: "PAYROLL",
  evaluate(input) {
    if (!input.sections.payroll) return [];
    return input.payrollPeriods
      .filter((p) => p.status === "under_review")
      .map((p) => {
        const since = isoToYmd(p.updated_at ?? p.created_at);
        const days = daysBetweenYmd(since, input.asOfDate);
        return f({
          ruleId: this.id,
          category: this.category,
          severity: days >= T.payrollReviewDaysHigh ? "HIGH" : "MEDIUM",
          titleAr: "مسير بانتظار المراجعة",
          titleEn: "Payroll period awaiting review",
          explanationAr: `فترة ${p.year}/${String(p.month).padStart(2, "0")} بحالة under_review منذ ${days} يوماً.`,
          explanationEn: `Payroll period ${p.year}/${String(p.month).padStart(2, "0")} has been under review for ${daysEn(days)}.`,
          evidence: { status: p.status, open_days: days },
          sourceType: "payroll_period",
          sourceId: p.id,
          href: `/payroll/${p.id}/review`,
          effectiveSince: since,
          ageDays: days,
        });
      });
  },
};

const payrollWaitingLock: RiskRule = {
  id: "PAYROLL_WAITING_APPROVAL",
  category: "PAYROLL",
  evaluate(input) {
    if (!input.sections.payroll) return [];
    // "approved" awaits lock in this product (approval already done).
    return input.payrollPeriods
      .filter((p) => p.status === "approved")
      .map((p) => {
        const since = isoToYmd(p.updated_at ?? p.created_at);
        const days = daysBetweenYmd(since, input.asOfDate);
        return f({
          ruleId: this.id,
          category: this.category,
          severity: days >= T.payrollReviewDaysHigh ? "HIGH" : "MEDIUM",
          titleAr: "مسير معتمد بانتظار القفل",
          titleEn: "Approved payroll awaiting lock",
          explanationAr: `فترة ${p.year}/${String(p.month).padStart(2, "0")} بحالة approved وبانتظار القفل منذ ${days} يوماً.`,
          explanationEn: `Payroll period ${p.year}/${String(p.month).padStart(2, "0")} is approved and has been awaiting lock for ${daysEn(days)}.`,
          evidence: { status: p.status, open_days: days },
          sourceType: "payroll_period",
          sourceId: p.id,
          href: `/payroll/${p.id}/review`,
          effectiveSince: since,
          ageDays: days,
        });
      });
  },
};

const payrollLockedUnpaid: RiskRule = {
  id: "PAYROLL_LOCKED_UNPAID",
  category: "PAYROLL",
  evaluate(input) {
    if (!input.sections.payroll) return [];
    return input.payrollPeriods
      .filter((p) => p.status === "locked" && p.unpaidEntryCount > 0)
      .map((p) =>
        f({
          ruleId: this.id,
          category: this.category,
          severity: "HIGH",
          titleAr: "مسير مقفل بقيود غير مصروفة",
          titleEn: "Locked payroll with unpaid entries",
          explanationAr: `فترة ${p.year}/${String(p.month).padStart(2, "0")} مقفلة ويوجد ${p.unpaidEntryCount} قيداً غير مدفوع (بدون عرض مبالغ).`,
          explanationEn: `Payroll period ${p.year}/${String(p.month).padStart(2, "0")} is locked with ${p.unpaidEntryCount} unpaid ${p.unpaidEntryCount === 1 ? "entry" : "entries"} (amounts not shown).`,
          evidence: { status: p.status, unpaid_entry_count: p.unpaidEntryCount },
          sourceType: "payroll_period",
          sourceId: p.id,
          href: `/payroll/${p.id}`,
          effectiveSince: null,
          ageDays: null,
        }),
      );
  },
};

/** Canonical registry — single source for ECC attention + /management/risks. */
export const MANAGEMENT_RISK_RULES: RiskRule[] = [
  projectPlannedEndOverdue,
  projectDeclaredHighRisk,
  approvalPastDue,
  approvalOpenAge,
  prPendingAge,
  rfqResponseDuePassed,
  rfqNeedsComparison,
  poReadyToIssue,
  poDeliveryDatePassed,
  supplierInvoicePastDue,
  clientInvoicePastDue,
  valuationPending,
  variationPending,
  complianceExpired,
  complianceExpiring,
  contractExpiring,
  missingCheckout,
  absentToday,
  leavePending,
  payrollWaitingReview,
  payrollWaitingLock,
  payrollLockedUnpaid,
];
