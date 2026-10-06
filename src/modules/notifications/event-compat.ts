import { EVENT_CATEGORY, type NotificationCategory } from "./catalog";

export type EmailAudience = "none" | "personal" | "management";

const DOT_CATEGORY: Record<string, NotificationCategory> = {
  "approval.created": "APPROVALS",
  "approval.required": "APPROVALS",
  "approval.decided": "APPROVALS",
  "leave_request.submitted": "HR",
  "leave_request.approved": "HR",
  "leave_request.rejected": "HR",
  "leave_request.manager_approved": "HR",
  "leave_request.cancelled": "HR",
  "payroll.submitted": "PAYROLL",
  "payroll.reviewed": "PAYROLL",
  "payroll.approved": "PAYROLL",
  "payroll.locked": "PAYROLL",
  "attendance.adjusted": "ATTENDANCE",
  "attendance.checked_in": "ATTENDANCE",
  "attendance.checked_out": "ATTENDANCE",
  "ncr.critical": "MANAGEMENT",
  "inspection.failed": "PROJECTS",
  "workflow.step.activated": "WORK",
  "workflow.step.completed": "WORK",
  "workflow.step.deadline_changed": "WORK",
  "workflow.step.deadline_warning": "PROJECTS",
  "workflow.step.overdue": "PROJECTS",
  "workflow.step.overdue.management": "MANAGEMENT",
  "workflow.completed": "MANAGEMENT",
};

/** Personal inbox (auth.users.email) — opt-in via existing category defaults. */
export const PERSONAL_EMAIL_TYPES = new Set([
  "approval.created",
  "approval.required",
  "approval.decided",
  "APPROVAL_ASSIGNED",
  "DOCUMENT_APPROVAL_REQUIRED",
  "APPROVAL_OVERDUE",
  "WORK_ASSIGNED",
  "leave_request.submitted",
  "leave_request.approved",
  "leave_request.rejected",
  "leave_request.manager_approved",
  "LEAVE_SUBMITTED",
  "LEAVE_APPROVED",
  "LEAVE_REJECTED",
  "LEAVE_MANAGER_APPROVED",
  "payroll.locked",
  "PROJECT_OVERDUE",
  "workflow.step.activated",
  "workflow.step.deadline_changed",
  "workflow.step.deadline_warning",
  "workflow.step.overdue",
]);

/** Organization management_notification_email — never auth login / info@. */
export const MANAGEMENT_EMAIL_TYPES = new Set([
  "ESCALATION_CREATED",
  "ncr.critical",
  "RISK_HIGH",
  "RISK_CRITICAL",
  "payroll.submitted",
  "payroll.reviewed",
  "payroll.approved",
  "PAYROLL_REVIEW_REQUIRED",
  "PAYROLL_APPROVAL_REQUIRED",
  "PAYROLL_LOCKED_UNPAID",
  "COMPLIANCE_EXPIRING",
  "CONTRACT_EXPIRING",
  "workflow.completed",
  "workflow.step.overdue.management",
]);

/** Explicitly not emailed (reminders / noise). */
export const NO_EMAIL_TYPES = new Set([
  "APPROVAL_REMINDER",
  "PROJECT_DEADLINE_APPROACHING",
  "MANAGEMENT_DIGEST",
  "attendance.adjusted",
  "attendance.checked_in",
  "attendance.checked_out",
  "leave_request.cancelled",
  "inspection.failed",
  "workflow.step.completed",
  "workflow.step.assignee_changed",
]);

export function categoryForNotificationType(type: string): NotificationCategory {
  if (type in EVENT_CATEGORY) {
    return EVENT_CATEGORY[type as keyof typeof EVENT_CATEGORY];
  }
  if (DOT_CATEGORY[type]) return DOT_CATEGORY[type];
  if (type.startsWith("approval")) return "APPROVALS";
  if (type.startsWith("leave")) return "HR";
  if (type.startsWith("payroll")) return "PAYROLL";
  if (type.startsWith("attendance")) return "ATTENDANCE";
  return "WORK";
}

export function emailAudienceFor(type: string): EmailAudience {
  if (NO_EMAIL_TYPES.has(type)) return "none";
  if (MANAGEMENT_EMAIL_TYPES.has(type)) return "management";
  if (PERSONAL_EMAIL_TYPES.has(type)) return "personal";
  return "none";
}
