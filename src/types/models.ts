import type { PermissionKey } from "@/lib/permissions/catalog";
import type { RoleScopeType } from "@/lib/permissions/evaluate";
import type {
  ConfidentialityLevel,
  DocumentStatus,
  EmployeeGender,
  EmploymentStatus,
  EmploymentType,
  Locale,
  MembershipStatus,
  NotificationPriority,
  OrganizationStatus,
  ProjectPriority,
  ProjectStatus,
  RiskLevel,
  StageStatus,
} from "./enums";

export type Organization = {
  id: string;
  name_ar: string;
  name_en: string;
  legal_name: string | null;
  commercial_registration: string | null;
  vat_number: string | null;
  logo_path: string | null;
  country: string;
  timezone: string;
  default_currency: string;
  status: OrganizationStatus;
  leave_day_basis?: "calendar" | "working";
  created_at: string;
  updated_at: string;
};

export type Department = {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  description: string | null;
  parent_department_id: string | null;
  manager_user_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  full_name_ar: string;
  full_name_en: string;
  phone: string | null;
  locale: Locale;
  is_active: boolean;
  is_platform_admin: boolean;
  avatar_path: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Employee = {
  id: string;
  organization_id: string;
  profile_id: string;
  employee_number: string | null;
  job_title_ar: string | null;
  job_title_en: string | null;
  employment_status: EmploymentStatus;
  employment_type: EmploymentType | null;
  date_of_birth: string | null;
  gender: EmployeeGender | null;
  joining_date: string | null;
  contract_start: string | null;
  contract_end: string | null;
  probation_end: string | null;
  direct_manager_employee_id: string | null;
  work_location: string | null;
  nationality: string | null;
  is_active: boolean;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeContract = {
  id: string;
  organization_id: string;
  employee_id: string;
  contract_number: string;
  contract_type: EmploymentType;
  status: import("@/types/enums").EmployeeContractStatus;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  notice_period_days: number;
  working_hours_per_week: number;
  currency: string;
  initial_basic_salary: number | null;
  initial_housing_allowance: number;
  initial_transport_allowance: number;
  initial_other_allowances: number;
  signed_document_id: string | null;
  is_current: boolean;
  notes: string | null;
  created_by: string;
  activated_at: string | null;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeCompensationVersion = {
  id: string;
  organization_id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  currency: string;
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  total_salary?: number;
  change_reason: string | null;
  status: import("@/types/enums").CompensationVersionStatus;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeDocument = {
  id: string;
  organization_id: string;
  employee_id: string;
  document_id: string;
  category: import("@/types/enums").EmployeeDocumentCategory;
  visibility_scope: import("@/types/enums").HrDocumentVisibility;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  documents?: DocumentRecord | null;
};

export type EmployeeBankAccount = {
  id: string;
  organization_id: string;
  employee_id: string;
  bank_name: string;
  iban: string | null;
  masked_iban: string;
  account_name: string;
  swift_code: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AuthContext = {
  userId: string;
  profile: Profile;
  organization: Organization;
  employee: Employee | null;
  membershipStatus: MembershipStatus;
  grants: Array<{
    roleCode: string;
    isExternal: boolean;
    organizationId: string;
    scopeType: RoleScopeType;
    scopeId: string | null;
    permissions: readonly PermissionKey[];
  }>;
  permissions: PermissionKey[];
};

export type Project = {
  id: string;
  organization_id: string;
  project_code: string;
  name_ar: string;
  name_en: string;
  description: string | null;
  client_id: string | null;
  project_manager_id: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  start_date: string | null;
  planned_end_date: string | null;
  actual_end_date: string | null;
  contract_value: number | null;
  budget: number | null;
  progress_percentage: number;
  risk_level: RiskLevel;
  location: string | null;
  business_case_document_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ProjectStage = {
  id: string;
  project_id: string;
  organization_id: string;
  template_item_id: string | null;
  name_ar: string;
  name_en: string;
  sequence: number;
  owner_user_id: string | null;
  department_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: StageStatus;
  progress_percentage: number;
  requires_approval: boolean;
  sla_hours: number | null;
  due_at: string | null;
  warning_at: string | null;
  overdue_at: string | null;
  escalation_level: number;
  escalated_at: string | null;
  risk_level: RiskLevel;
  created_at: string;
  updated_at: string;
};

export type DocumentRecord = {
  id: string;
  organization_id: string;
  project_id: string | null;
  category: string;
  document_number: string | null;
  title: string;
  current_revision: string;
  status: DocumentStatus;
  discipline: string | null;
  confidentiality: ConfidentialityLevel;
  approval_state: string;
  uploaded_by: string;
  archived_at?: string | null;
  archived_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationRecord = {
  id: string;
  organization_id: string;
  recipient_profile_id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  priority: NotificationPriority;
  read_at: string | null;
  created_at: string;
};

export type AuditLogRecord = {
  id: string;
  organization_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  correlation_id: string | null;
  created_at: string;
};

export type DashboardStats = {
  activeProjects: number;
  projectsAtRisk: number;
  pendingApprovals: number;
  overdueApprovals: number;
  activeEmployees: number;
  unreadNotifications: number;
};

export type PendingAction = {
  id: string;
  kind:
    | "approval"
    | "workflow"
    | "rfi"
    | "document_revision"
    | "ncr"
    | "inspection"
    | "correspondence";
  title: string;
  entityType: string;
  entityId: string;
  dueAt: string | null;
  isOverdue: boolean;
  priority?: number;
};

export type LeaveType = {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  is_paid: boolean;
  annual_entitlement_days: number;
  requires_attachment: boolean;
  minimum_notice_days: number;
  maximum_consecutive_days: number | null;
  allow_carry_forward: boolean;
  maximum_carry_forward_days: number | null;
  allow_negative_balance: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type EmployeeLeaveBalance = {
  id: string;
  organization_id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  opening_balance: number;
  entitled_days: number;
  carried_forward_days: number;
  used_days: number;
  pending_days: number;
  adjustment_days: number;
  available_days: number;
  created_at: string;
  updated_at: string;
};

export type LeaveRequest = {
  id: string;
  organization_id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
  attachment_document_id: string | null;
  status: import("./enums").LeaveRequestStatus;
  approval_stage: import("./enums").LeaveApprovalStage;
  manager_profile_id: string | null;
  manager_decided_at: string | null;
  manager_decision: string | null;
  manager_comment: string | null;
  hr_profile_id: string | null;
  hr_decided_at: string | null;
  hr_decision: string | null;
  hr_comment: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LeaveBalanceAdjustment = {
  id: string;
  organization_id: string;
  balance_id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  adjustment_days: number;
  reason: string;
  created_by: string | null;
  created_at: string;
};

export type AttendancePolicy = {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  late_grace_minutes: number;
  early_leave_grace_minutes: number;
  minimum_work_minutes: number;
  allow_manual_check_in: boolean;
  allow_manual_check_out: boolean;
  require_hr_approval_for_adjustment: boolean;
  reconciliation_delay_hours: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AttendanceShift = {
  id: string;
  organization_id: string;
  policy_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  crosses_midnight: boolean;
  working_days: number[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type EmployeeShiftAssignment = {
  id: string;
  organization_id: string;
  employee_id: string;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
};

export type AttendanceRecord = {
  id: string;
  organization_id: string;
  employee_id: string;
  shift_id: string | null;
  attendance_date: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  attendance_status: import("./enums").AttendanceStatus;
  source: import("./enums").AttendanceSource;
  notes: string | null;
  check_in_workplace_id?: string | null;
  check_in_accuracy_meters?: number | null;
  check_in_distance_meters?: number | null;
  check_in_location_verified?: boolean | null;
  check_out_workplace_id?: string | null;
  check_out_accuracy_meters?: number | null;
  check_out_distance_meters?: number | null;
  check_out_location_verified?: boolean | null;
  created_at: string;
  updated_at: string;
};

export type WorkplaceLocation = {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  allowed_radius_meters: number;
  max_accuracy_meters: number | null;
  timezone: string;
  is_active: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

export type EmployeeWorkplaceAssignment = {
  id: string;
  organization_id: string;
  employee_id: string;
  workplace_location_id: string;
  effective_from: string;
  effective_to: string | null;
  is_primary: boolean;
  created_at: string;
};

export type AttendanceLocationAttempt = {
  id: string;
  organization_id: string;
  employee_id: string;
  workplace_location_id: string | null;
  action: "CHECK_IN" | "CHECK_OUT";
  result: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters: number | null;
  distance_meters: number | null;
  reason_code: string;
  created_at: string;
};

export type AttendanceAdjustment = {
  id: string;
  organization_id: string;
  attendance_record_id: string;
  employee_id: string;
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reason: string;
  adjusted_by: string;
  adjusted_at: string;
};

export type PayrollSettings = {
  id: string;
  organization_id: string;
  currency: string;
  standard_payable_days: number;
  deduct_unpaid_leave: boolean;
  deduct_absence: boolean;
  deduct_late_minutes: boolean;
  rounding_precision: number;
  default_payment_method: import("./enums").PayrollPaymentMethod;
  calculation_basis: string;
  created_at: string;
  updated_at: string;
};

export type PayrollPeriod = {
  id: string;
  organization_id: string;
  year: number;
  month: number;
  period_start: string;
  period_end: string;
  status: import("./enums").PayrollPeriodStatus;
  employee_count: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  engine_version: number;
  created_by: string | null;
  calculated_at: string | null;
  calculated_by: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  locked_at: string | null;
  locked_by: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PayrollEntry = {
  id: string;
  organization_id: string;
  payroll_period_id: string;
  employee_id: string;
  employee_number: string | null;
  employee_name: string | null;
  department_name: string | null;
  contract_id: string | null;
  primary_compensation_version_id: string | null;
  compensation_version_ids: string[] | null;
  base_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  gross_recurring: number;
  bank_account_id: string | null;
  masked_iban: string | null;
  eligible_start: string | null;
  eligible_end: string | null;
  payable_days: number;
  present_days: number;
  absent_days: number;
  leave_days: number;
  unpaid_leave_days: number;
  late_minutes: number;
  early_leave_minutes: number;
  worked_minutes: number;
  missing_checkout_count: number;
  total_earnings: number;
  total_deductions: number;
  gross_pay: number;
  net_pay: number;
  payment_status: import("./enums").PayrollPaymentStatus;
  calculation_details: Record<string, unknown>;
  engine_version: number;
  created_at: string;
  updated_at: string;
};

export type PayrollEntrySegment = {
  id: string;
  organization_id: string;
  payroll_entry_id: string;
  compensation_version_id: string;
  segment_start: string;
  segment_end: string;
  payable_days: number;
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  monthly_gross: number;
  segment_gross: number;
  daily_rate: number;
  created_at: string;
};

export type PayrollEarning = {
  id: string;
  organization_id: string;
  payroll_entry_id: string;
  payroll_period_id: string;
  code: string;
  description_ar: string;
  description_en: string;
  kind: import("./enums").PayrollEarningKind;
  source: import("./enums").PayrollLineSource;
  amount: number;
  is_manual: boolean;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type PayrollDeduction = {
  id: string;
  organization_id: string;
  payroll_entry_id: string;
  payroll_period_id: string;
  code: string;
  description_ar: string;
  description_en: string;
  source: import("./enums").PayrollLineSource;
  amount: number;
  is_manual: boolean;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type PayrollPayment = {
  id: string;
  organization_id: string;
  payroll_period_id: string;
  payroll_entry_id: string;
  payment_date: string;
  payment_method: import("./enums").PayrollPaymentMethod;
  payment_reference: string | null;
  amount: number;
  recorded_by: string | null;
  notes: string | null;
  created_at: string;
};
