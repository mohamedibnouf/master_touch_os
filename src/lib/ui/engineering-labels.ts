/**
 * Presentation-only labels for engineering / document-control codes.
 * Stored codes are unchanged. Unknown values fall back to the code with underscores replaced.
 */
import type { Locale } from "@/lib/i18n/config";

type LabelMap = Record<string, { ar: string; en: string }>;

function lookup(map: LabelMap, code: string | null | undefined, locale: Locale): string {
  if (!code) return "—";
  const entry = map[code];
  if (entry) return entry[locale];
  return code.replace(/_/g, " ");
}

/** Union of RFI, submittal, shop drawing, method statement, inspection and NCR workflow statuses. */
const ENGINEERING_STATUS: LabelMap = {
  draft: { ar: "مسودة", en: "Draft" },
  internal_review: { ar: "مراجعة داخلية", en: "Internal review" },
  hse_review: { ar: "مراجعة السلامة", en: "HSE review" },
  quality_review: { ar: "مراجعة الجودة", en: "QA/QC review" },
  pm_review: { ar: "مراجعة مدير المشروع", en: "PM review" },
  ready: { ar: "جاهز", en: "Ready" },
  ready_for_submission: { ar: "جاهز للتقديم", en: "Ready for submission" },
  submitted: { ar: "مقدّم", en: "Submitted" },
  under_review: { ar: "قيد المراجعة", en: "Under review" },
  answered: { ar: "تم الرد", en: "Answered" },
  approved: { ar: "معتمد", en: "Approved" },
  approved_as_noted: { ar: "معتمد بملاحظات", en: "Approved as noted" },
  approved_for_use: { ar: "معتمد للاستخدام", en: "Approved for use" },
  resubmit: { ar: "إعادة تقديم", en: "Revise & resubmit" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  for_information: { ar: "للعلم", en: "For information" },
  superseded: { ar: "مستبدل", en: "Superseded" },
  scheduled: { ar: "مجدول", en: "Scheduled" },
  inspected: { ar: "تم الفحص", en: "Inspected" },
  passed: { ar: "ناجح", en: "Passed" },
  passed_with_comments: { ar: "ناجح مع ملاحظات", en: "Passed with comments" },
  failed: { ar: "فاشل", en: "Failed" },
  reinspection_required: { ar: "يتطلب إعادة فحص", en: "Re-inspection required" },
  open: { ar: "مفتوح", en: "Open" },
  under_investigation: { ar: "قيد التحقيق", en: "Under investigation" },
  corrective_action: { ar: "إجراء تصحيحي", en: "Corrective action" },
  waiting_verification: { ar: "بانتظار التحقق", en: "Awaiting verification" },
  reopened: { ar: "أعيد فتحه", en: "Reopened" },
  closed: { ar: "مغلق", en: "Closed" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
};

/** NCR severity and RFI priority share the same scale. */
const SEVERITY: LabelMap = {
  low: { ar: "منخفضة", en: "Low" },
  medium: { ar: "متوسطة", en: "Medium" },
  high: { ar: "عالية", en: "High" },
  critical: { ar: "حرجة", en: "Critical" },
};

const REPORT_TYPE: LabelMap = {
  daily: { ar: "يومي", en: "Daily" },
  weekly: { ar: "أسبوعي", en: "Weekly" },
  monthly: { ar: "شهري", en: "Monthly" },
};

const REPORT_STATUS: LabelMap = {
  draft: { ar: "مسودة", en: "Draft" },
  submitted: { ar: "مقدّم", en: "Submitted" },
  approved: { ar: "معتمد", en: "Approved" },
  archived: { ar: "مؤرشف", en: "Archived" },
};

const CORRESPONDENCE_DIRECTION: LabelMap = {
  incoming: { ar: "وارد", en: "Incoming" },
  outgoing: { ar: "صادر", en: "Outgoing" },
  internal: { ar: "داخلي", en: "Internal" },
};

const CORRESPONDENCE_STATUS: LabelMap = {
  open: { ar: "مفتوح", en: "Open" },
  awaiting_response: { ar: "بانتظار الرد", en: "Awaiting response" },
  responded: { ar: "تم الرد", en: "Responded" },
  closed: { ar: "مغلق", en: "Closed" },
};

const SUBMISSION_STATUS: LabelMap = {
  not_submitted: { ar: "لم يُقدَّم", en: "Not submitted" },
  ready: { ar: "جاهز للتقديم", en: "Ready to submit" },
  submitted: { ar: "مقدّم", en: "Submitted" },
  under_review: { ar: "قيد المراجعة", en: "Under review" },
  responded: { ar: "تم الرد", en: "Responded" },
  closed: { ar: "مغلق", en: "Closed" },
};

const OFFICIAL_DECISION: LabelMap = {
  A: { ar: "معتمد", en: "Approved" },
  B: { ar: "معتمد بملاحظات", en: "Approved as noted" },
  C: { ar: "إعادة تقديم", en: "Revise & resubmit" },
  D: { ar: "مرفوض", en: "Rejected" },
  E: { ar: "للعلم", en: "For information" },
};

const TRANSMITTAL_STATUS: LabelMap = {
  draft: { ar: "مسودة", en: "Draft" },
  issued: { ar: "صادرة", en: "Issued" },
  acknowledged: { ar: "تم الاستلام", en: "Acknowledged" },
  closed: { ar: "مغلقة", en: "Closed" },
  cancelled: { ar: "ملغاة", en: "Cancelled" },
};

const TRANSMITTAL_PURPOSE: LabelMap = {
  for_approval: { ar: "للاعتماد", en: "For approval" },
  for_review: { ar: "للمراجعة", en: "For review" },
  for_information: { ar: "للعلم", en: "For information" },
  for_construction: { ar: "للتنفيذ", en: "For construction" },
  for_record: { ar: "للسجل", en: "For record" },
};

export function engineeringStatusLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(ENGINEERING_STATUS, code, locale);
}

export function ncrSeverityLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(SEVERITY, code, locale);
}

/** RFI priority uses the same low/medium/high/critical scale as NCR severity. */
export const rfiPriorityLabel = ncrSeverityLabel;

export function reportTypeLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(REPORT_TYPE, code, locale);
}

export function reportStatusLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(REPORT_STATUS, code, locale);
}

export function correspondenceDirectionLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(CORRESPONDENCE_DIRECTION, code, locale);
}

export function correspondenceStatusLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(CORRESPONDENCE_STATUS, code, locale);
}

export function submissionStatusLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(SUBMISSION_STATUS, code, locale);
}

/** Official review decision label without the code (e.g. "Approved as noted"). */
export function officialDecisionLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(OFFICIAL_DECISION, code, locale);
}

/** "B — Approved as noted" style label used in decision pickers and badges. */
export function officialDecisionWithCode(code: string | null | undefined, locale: Locale = "ar"): string {
  if (!code) return "—";
  return `${code} — ${officialDecisionLabel(code, locale)}`;
}

export function transmittalStatusLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(TRANSMITTAL_STATUS, code, locale);
}

export function transmittalPurposeLabel(code: string | null | undefined, locale: Locale = "ar"): string {
  return lookup(TRANSMITTAL_PURPOSE, code, locale);
}

export type EngineeringTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Badge tone for any engineering workflow status. */
export function engineeringStatusTone(code: string | null | undefined): EngineeringTone {
  switch (code) {
    case "approved":
    case "approved_for_use":
    case "passed":
    case "answered":
    case "closed":
    case "responded":
    case "issued":
    case "acknowledged":
      return "success";
    case "approved_as_noted":
    case "passed_with_comments":
    case "resubmit":
    case "reinspection_required":
    case "corrective_action":
    case "waiting_verification":
    case "under_investigation":
    case "reopened":
    case "awaiting_response":
      return "warning";
    case "rejected":
    case "failed":
    case "open":
      return "danger";
    case "submitted":
    case "under_review":
    case "scheduled":
    case "inspected":
    case "ready":
    case "ready_for_submission":
    case "internal_review":
    case "hse_review":
    case "quality_review":
    case "pm_review":
      return "info";
    default:
      return "neutral";
  }
}

export function severityTone(code: string | null | undefined): EngineeringTone {
  switch (code) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    default:
      return "neutral";
  }
}

export function officialDecisionTone(code: string | null | undefined): EngineeringTone {
  switch (code) {
    case "A":
      return "success";
    case "B":
      return "success";
    case "C":
      return "warning";
    case "D":
      return "danger";
    case "E":
      return "info";
    default:
      return "neutral";
  }
}
