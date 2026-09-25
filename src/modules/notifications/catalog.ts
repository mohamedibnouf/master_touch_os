import { z } from "zod";

export const NOTIFICATION_EVENT_TYPES = [
  "WORK_ASSIGNED",
  "APPROVAL_ASSIGNED",
  "APPROVAL_REMINDER",
  "APPROVAL_OVERDUE",
  "LEAVE_SUBMITTED",
  "LEAVE_MANAGER_APPROVED",
  "LEAVE_APPROVED",
  "LEAVE_REJECTED",
  "DOCUMENT_APPROVAL_REQUIRED",
  "PROJECT_DEADLINE_APPROACHING",
  "PROJECT_OVERDUE",
  "COMPLIANCE_EXPIRING",
  "CONTRACT_EXPIRING",
  "PAYROLL_REVIEW_REQUIRED",
  "PAYROLL_APPROVAL_REQUIRED",
  "PAYROLL_LOCKED_UNPAID",
  "RISK_HIGH",
  "RISK_CRITICAL",
  "ESCALATION_CREATED",
  "MANAGEMENT_DIGEST",
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const NOTIFICATION_CATEGORIES = [
  "WORK",
  "APPROVALS",
  "HR",
  "ATTENDANCE",
  "PROJECTS",
  "MANAGEMENT",
  "PAYROLL",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CHANNELS = ["in_app", "email", "whatsapp", "push"] as const;
export type HubChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const EVENT_CATEGORY: Record<NotificationEventType, NotificationCategory> = {
  WORK_ASSIGNED: "WORK",
  APPROVAL_ASSIGNED: "APPROVALS",
  APPROVAL_REMINDER: "APPROVALS",
  APPROVAL_OVERDUE: "APPROVALS",
  LEAVE_SUBMITTED: "HR",
  LEAVE_MANAGER_APPROVED: "HR",
  LEAVE_APPROVED: "HR",
  LEAVE_REJECTED: "HR",
  DOCUMENT_APPROVAL_REQUIRED: "APPROVALS",
  PROJECT_DEADLINE_APPROACHING: "PROJECTS",
  PROJECT_OVERDUE: "PROJECTS",
  COMPLIANCE_EXPIRING: "HR",
  CONTRACT_EXPIRING: "HR",
  PAYROLL_REVIEW_REQUIRED: "PAYROLL",
  PAYROLL_APPROVAL_REQUIRED: "PAYROLL",
  PAYROLL_LOCKED_UNPAID: "PAYROLL",
  RISK_HIGH: "MANAGEMENT",
  RISK_CRITICAL: "MANAGEMENT",
  ESCALATION_CREATED: "APPROVALS",
  MANAGEMENT_DIGEST: "MANAGEMENT",
};

/** In-app cannot be opted out for these categories. */
export const MANDATORY_IN_APP_CATEGORIES: ReadonlySet<NotificationCategory> = new Set([
  "WORK",
  "APPROVALS",
  "PAYROLL",
]);

export const SENSITIVE_CATEGORIES: ReadonlySet<NotificationCategory> = new Set(["PAYROLL"]);

export const notificationEventSchema = z.object({
  organizationId: z.string().uuid(),
  eventType: z.enum(NOTIFICATION_EVENT_TYPES),
  entityType: z.string().min(1).max(80),
  entityId: z.string().uuid(),
  actorId: z.string().uuid().nullable().optional(),
  recipientIds: z.array(z.string().uuid()).max(50),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(500),
  href: z.string().max(300).nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  occurredAt: z.string().min(1),
  deduplicationKey: z.string().min(3).max(240),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type NotificationEvent = z.infer<typeof notificationEventSchema>;

export type ActiveMember = {
  profileId: string;
  organizationId: string;
  status: string;
  isActive: boolean;
};

export type PreferenceRow = {
  profileId: string;
  category: NotificationCategory;
  channel: HubChannel;
  enabled: boolean;
};
