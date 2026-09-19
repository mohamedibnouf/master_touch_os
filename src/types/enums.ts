export type OrganizationStatus = "active" | "suspended" | "archived";
export type MembershipStatus = "active" | "invited" | "suspended" | "removed";
export type EmploymentStatus = "active" | "on_leave" | "probation" | "terminated" | "resigned";
export type EmploymentType =
  | "permanent"
  | "fixed_term"
  | "part_time"
  | "temporary"
  | "consultant";
export type EmployeeGender = "male" | "female" | "other" | "unspecified";
export type EmployeeContractStatus =
  | "draft"
  | "active"
  | "expired"
  | "renewed"
  | "terminated"
  | "cancelled";
export type EmployeeDocumentCategory =
  | "contract"
  | "id"
  | "iqama"
  | "passport"
  | "insurance"
  | "certificate"
  | "bank"
  | "hr_form"
  | "other";
export type HrDocumentVisibility =
  | "hr_only"
  | "employee_visible"
  | "finance_visible"
  | "restricted";
export type CompensationVersionStatus = "active" | "superseded" | "cancelled";
export type LeaveRequestStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled";
export type LeaveApprovalStage = "none" | "manager" | "hr" | "complete";
export type AttendanceStatus =
  | "present"
  | "late"
  | "absent"
  | "partial"
  | "on_leave"
  | "holiday"
  | "off_day"
  | "missing_checkout";
export type AttendanceSource = "self_service" | "hr_adjustment" | "system_reconcile" | "import";
export type ProjectStatus = "draft" | "active" | "on_hold" | "completed" | "cancelled" | "archived";
export type ProjectPriority = "low" | "medium" | "high" | "critical";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type StageStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "completed"
  | "skipped"
  | "cancelled";
export type DocumentStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "superseded"
  | "archived";
export type ConfidentialityLevel = "internal" | "confidential" | "restricted";
export type NotificationPriority = "low" | "normal" | "high" | "urgent";
export type NotificationChannel = "in_app" | "email" | "whatsapp" | "push";
export type Locale = "ar" | "en";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "draft",
  "active",
  "on_hold",
  "completed",
  "cancelled",
  "archived",
];

export const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];
