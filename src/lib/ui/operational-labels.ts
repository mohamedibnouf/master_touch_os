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
};

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_AR[status] ?? status.replaceAll("_", " ");
}

export function projectRiskLabel(risk: string): string {
  return PROJECT_RISK_AR[risk] ?? risk.replaceAll("_", " ");
}

export function approvalStatusLabel(status: string): string {
  return APPROVAL_STATUS_AR[status] ?? status.replaceAll("_", " ");
}

export function documentStatusLabel(status: string): string {
  return DOCUMENT_STATUS_AR[status] ?? status.replaceAll("_", " ");
}

export function approvalStepStatusLabel(status: string): string {
  return STEP_STATUS_AR[status] ?? status.replaceAll("_", " ");
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
