/** Presentation-only labels. Stored codes are unchanged. Unknown values fall back to the raw string. */
const PROJECT_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  active: "نشط",
  on_hold: "متوقف",
  completed: "مكتمل",
  cancelled: "ملغى",
};

const PROJECT_RISK_AR: Record<string, string> = {
  low: "منخفض",
  medium: "متوسط",
  high: "مرتفع",
  critical: "حرج",
};

const APPROVAL_STATUS_AR: Record<string, string> = {
  pending: "معلّق",
  in_progress: "قيد التنفيذ",
  approved: "معتمد",
  rejected: "مرفوض",
  cancelled: "ملغى",
  completed: "مكتمل",
};

const DOCUMENT_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مقدّم",
  in_review: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  superseded: "مستبدل",
  archived: "مؤرشف",
};

const STEP_STATUS_AR: Record<string, string> = {
  pending: "معلّق",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  skipped: "متجاوز",
  rejected: "مرفوض",
  approved: "معتمد",
  cancelled: "ملغاة",
};

const PROJECT_STATUS_EN: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PROJECT_RISK_EN: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const APPROVAL_STATUS_EN: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  completed: "Completed",
};

const DOCUMENT_STATUS_EN: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
  archived: "Archived",
};

const STEP_STATUS_EN: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
  rejected: "Rejected",
  approved: "Approved",
  cancelled: "Cancelled",
};

type LabelLocale = "ar" | "en";

function label(ar: Record<string, string>, en: Record<string, string>, code: string, locale: LabelLocale): string {
  return (locale === "en" ? en : ar)[code] ?? code.replaceAll("_", " ");
}

export function projectStatusLabel(status: string, locale: LabelLocale = "ar"): string {
  return label(PROJECT_STATUS_AR, PROJECT_STATUS_EN, status, locale);
}

export function projectRiskLabel(risk: string, locale: LabelLocale = "ar"): string {
  return label(PROJECT_RISK_AR, PROJECT_RISK_EN, risk, locale);
}

export function approvalStatusLabel(status: string, locale: LabelLocale = "ar"): string {
  return label(APPROVAL_STATUS_AR, APPROVAL_STATUS_EN, status, locale);
}

export function documentStatusLabel(status: string, locale: LabelLocale = "ar"): string {
  return label(DOCUMENT_STATUS_AR, DOCUMENT_STATUS_EN, status, locale);
}

export function approvalStepStatusLabel(status: string, locale: LabelLocale = "ar"): string {
  return label(STEP_STATUS_AR, STEP_STATUS_EN, status, locale);
}

export function projectStatusTone(status: string): "neutral" | "success" | "info" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "completed") return "success";
  if (status === "on_hold") return "warning";
  if (status === "cancelled") return "danger";
  return "neutral";
}

export function projectRiskTone(risk: string): "neutral" | "warning" | "danger" {
  if (risk === "critical" || risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

export function approvalStatusTone(status: string): "neutral" | "success" | "info" | "warning" | "danger" {
  if (status === "approved" || status === "completed") return "success";
  if (status === "pending" || status === "in_progress") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function documentStatusTone(status: string): "neutral" | "success" | "info" | "warning" | "danger" {
  if (status === "approved") return "success";
  if (status === "in_review" || status === "submitted") return "warning";
  if (status === "rejected") return "danger";
  if (status === "draft" || status === "archived" || status === "superseded") return "neutral";
  return "info";
}

export function leaveRequestTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "approved") return "success";
  if (status === "submitted") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function attendanceStatusTone(status: string): "neutral" | "success" | "info" | "warning" | "danger" {
  if (status === "present" || status === "holiday" || status === "off_day" || status === "on_leave") return "success";
  if (status === "late" || status === "partial" || status === "missing_checkout") return "warning";
  if (status === "absent") return "danger";
  return "info";
}
