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
