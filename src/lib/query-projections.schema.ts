/**
 * Column allowlists from CREATE/ALTER in migrations 001–064.
 * Used to keep PostgREST projections from selecting non-existent columns.
 */

/** 003_identity_and_hr.sql */
export const SCHEMA_PROFILES = [
  "id",
  "full_name_ar",
  "full_name_en",
  "phone",
  "locale",
  "is_active",
  "is_platform_admin",
  "avatar_path",
  "last_seen_at",
  "created_at",
  "updated_at",
] as const;

/** 002_organizations.sql + 056 leave_day_basis */
export const SCHEMA_ORGANIZATIONS = [
  "id",
  "name_ar",
  "name_en",
  "legal_name",
  "commercial_registration",
  "vat_number",
  "logo_path",
  "country",
  "timezone",
  "default_currency",
  "status",
  "created_at",
  "updated_at",
  "leave_day_basis",
] as const;

/** 003 organization_members */
export const SCHEMA_ORGANIZATION_MEMBERS = [
  "id",
  "organization_id",
  "profile_id",
  "status",
  "joined_at",
  "created_at",
  "updated_at",
] as const;

/** 003 departments */
export const SCHEMA_DEPARTMENTS = [
  "id",
  "organization_id",
  "code",
  "name_ar",
  "name_en",
  "description",
  "parent_department_id",
  "manager_user_id",
  "is_active",
  "created_at",
  "updated_at",
] as const;

/** 003 employees + 052 date_of_birth, gender, employment_type */
export const SCHEMA_EMPLOYEES = [
  "id",
  "organization_id",
  "profile_id",
  "employee_number",
  "job_title_ar",
  "job_title_en",
  "employment_status",
  "joining_date",
  "contract_start",
  "contract_end",
  "probation_end",
  "direct_manager_employee_id",
  "work_location",
  "nationality",
  "is_active",
  "terminated_at",
  "created_at",
  "updated_at",
  "date_of_birth",
  "gender",
  "employment_type",
] as const;

/** 003 employee_departments */
export const SCHEMA_EMPLOYEE_DEPARTMENTS = [
  "id",
  "organization_id",
  "employee_id",
  "department_id",
  "is_primary",
  "created_at",
] as const;

/** 004 roles */
export const SCHEMA_ROLES = [
  "id",
  "organization_id",
  "code",
  "name_ar",
  "name_en",
  "is_system",
  "is_external",
  "created_at",
  "updated_at",
] as const;

/** 004 role_permissions */
export const SCHEMA_ROLE_PERMISSIONS = ["role_id", "permission_key"] as const;

/** 004 user_roles — profile_id and granted_by both reference profiles; do not embed profiles unhinted */
export const SCHEMA_USER_ROLES = [
  "id",
  "organization_id",
  "profile_id",
  "role_id",
  "scope_type",
  "scope_id",
  "granted_by",
  "granted_at",
] as const;

/** 005 projects */
export const SCHEMA_PROJECTS = [
  "id",
  "organization_id",
  "project_code",
  "name_ar",
  "name_en",
  "description",
  "client_id",
  "project_manager_id",
  "status",
  "priority",
  "start_date",
  "planned_end_date",
  "actual_end_date",
  "contract_value",
  "budget",
  "progress_percentage",
  "risk_level",
  "location",
  "business_case_document_id",
  "created_by",
  "created_at",
  "updated_at",
  "archived_at",
] as const;

/** 005 project_members */
export const SCHEMA_PROJECT_MEMBERS = [
  "id",
  "organization_id",
  "project_id",
  "profile_id",
  "employee_id",
  "role_label",
  "is_active",
  "assigned_at",
  "unassigned_at",
] as const;

/** 008 documents + 016 type_code and register fields */
export const SCHEMA_DOCUMENTS = [
  "id",
  "organization_id",
  "project_id",
  "category",
  "document_number",
  "title",
  "current_revision",
  "status",
  "discipline",
  "confidentiality",
  "approval_state",
  "uploaded_by",
  "created_at",
  "updated_at",
  "type_code",
  "discipline_id",
  "description",
  "originator_id",
  "responsible_engineer_id",
  "submission_status",
  "official_decision",
  "submitted_at",
  "response_due_at",
  "response_at",
  "closed_at",
  "external_reference",
  "workflow_instance_id",
  "approval_request_id",
  "is_register_controlled",
] as const;

/** 009 notifications + 062 event_type, href, dedup_key */
export const SCHEMA_NOTIFICATIONS = [
  "id",
  "organization_id",
  "recipient_profile_id",
  "type",
  "title",
  "message",
  "entity_type",
  "entity_id",
  "priority",
  "read_at",
  "created_at",
  "event_type",
  "href",
  "dedup_key",
] as const;

/** 009 audit_logs */
export const SCHEMA_AUDIT_LOGS = [
  "id",
  "organization_id",
  "actor_id",
  "action",
  "entity_type",
  "entity_id",
  "previous_values",
  "new_values",
  "ip_address",
  "user_agent",
  "correlation_id",
  "created_at",
] as const;

/** 007 approval_requests */
export const SCHEMA_APPROVAL_REQUESTS = [
  "id",
  "organization_id",
  "entity_type",
  "entity_id",
  "title",
  "status",
  "mode",
  "official_outcome",
  "official_code",
  "requested_by",
  "due_at",
  "warning_at",
  "overdue_at",
  "escalation_level",
  "escalated_at",
  "completed_at",
  "created_at",
  "updated_at",
] as const;

/** 007 approval_steps — decision is on approval_actions */
export const SCHEMA_APPROVAL_STEPS = [
  "id",
  "organization_id",
  "request_id",
  "sequence",
  "approver_type",
  "role_id",
  "department_id",
  "user_id",
  "delegated_to",
  "status",
  "due_at",
  "warning_at",
  "overdue_at",
  "escalation_level",
  "escalated_at",
  "created_at",
  "updated_at",
] as const;

/** 007 approval_actions */
export const SCHEMA_APPROVAL_ACTIONS = [
  "id",
  "organization_id",
  "request_id",
  "step_id",
  "actor_id",
  "decision",
  "official_code",
  "comment",
  "attachment_refs",
  "created_at",
] as const;

/** 056 leave_requests */
export const SCHEMA_LEAVE_REQUESTS = [
  "id",
  "organization_id",
  "employee_id",
  "leave_type_id",
  "start_date",
  "end_date",
  "total_days",
  "reason",
  "attachment_document_id",
  "status",
  "approval_stage",
  "manager_profile_id",
  "manager_decided_at",
  "manager_decision",
  "manager_comment",
  "hr_profile_id",
  "hr_decided_at",
  "hr_decision",
  "hr_comment",
  "submitted_at",
  "approved_at",
  "rejected_at",
  "cancelled_at",
  "created_by",
  "created_at",
  "updated_at",
] as const;

/** 056 employee_leave_balances */
export const SCHEMA_LEAVE_BALANCES = [
  "id",
  "organization_id",
  "employee_id",
  "leave_type_id",
  "year",
  "opening_balance",
  "entitled_days",
  "carried_forward_days",
  "used_days",
  "pending_days",
  "adjustment_days",
  "available_days",
  "created_at",
  "updated_at",
] as const;

/** 059 payroll_periods */
export const SCHEMA_PAYROLL_PERIODS = [
  "id",
  "organization_id",
  "year",
  "month",
  "period_start",
  "period_end",
  "status",
  "employee_count",
  "total_gross",
  "total_deductions",
  "total_net",
  "engine_version",
  "created_by",
  "calculated_at",
  "calculated_by",
  "submitted_at",
  "submitted_by",
  "reviewed_at",
  "reviewed_by",
  "approved_at",
  "approved_by",
  "locked_at",
  "locked_by",
  "paid_at",
  "cancelled_at",
  "cancelled_by",
  "notes",
  "created_at",
  "updated_at",
] as const;

/** 057 attendance_records + 063 geofence metadata (no lat/lng on this table) */
export const SCHEMA_ATTENDANCE_RECORDS = [
  "id",
  "organization_id",
  "employee_id",
  "shift_id",
  "attendance_date",
  "scheduled_start",
  "scheduled_end",
  "check_in_at",
  "check_out_at",
  "worked_minutes",
  "late_minutes",
  "early_leave_minutes",
  "attendance_status",
  "source",
  "notes",
  "created_at",
  "updated_at",
  "check_in_workplace_id",
  "check_in_accuracy_meters",
  "check_in_distance_meters",
  "check_in_location_verified",
  "check_out_workplace_id",
  "check_out_accuracy_meters",
  "check_out_distance_meters",
  "check_out_location_verified",
] as const;

export const SCHEMA_BY_TABLE: Record<string, readonly string[]> = {
  profiles: SCHEMA_PROFILES,
  organizations: SCHEMA_ORGANIZATIONS,
  organization_members: SCHEMA_ORGANIZATION_MEMBERS,
  departments: SCHEMA_DEPARTMENTS,
  employees: SCHEMA_EMPLOYEES,
  employee_departments: SCHEMA_EMPLOYEE_DEPARTMENTS,
  roles: SCHEMA_ROLES,
  role_permissions: SCHEMA_ROLE_PERMISSIONS,
  user_roles: SCHEMA_USER_ROLES,
  projects: SCHEMA_PROJECTS,
  project_members: SCHEMA_PROJECT_MEMBERS,
  documents: SCHEMA_DOCUMENTS,
  notifications: SCHEMA_NOTIFICATIONS,
  audit_logs: SCHEMA_AUDIT_LOGS,
  approval_requests: SCHEMA_APPROVAL_REQUESTS,
  approval_steps: SCHEMA_APPROVAL_STEPS,
  approval_actions: SCHEMA_APPROVAL_ACTIONS,
  leave_requests: SCHEMA_LEAVE_REQUESTS,
  employee_leave_balances: SCHEMA_LEAVE_BALANCES,
  payroll_periods: SCHEMA_PAYROLL_PERIODS,
  attendance_records: SCHEMA_ATTENDANCE_RECORDS,
};

/** Default PostgREST embed resource name → table (no invented FK hints). */
export const POSTGREST_EMBED_TABLE: Record<string, string> = {
  profiles: "profiles",
  organizations: "organizations",
  approval_steps: "approval_steps",
  roles: "roles",
  role_permissions: "role_permissions",
  departments: "departments",
  employee_departments: "employee_departments",
  projects: "projects",
};

export type ParsedSelect = {
  columns: string[];
  embeds: Array<{ relation: string; inner: string }>;
};

export function parsePostgrestSelect(select: string): ParsedSelect {
  const columns: string[] = [];
  const embeds: Array<{ relation: string; inner: string }> = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") {
      depth += 1;
      current += ch;
    } else if (ch === ")") {
      depth -= 1;
      current += ch;
    } else if (ch === "," && depth === 0) {
      pushPart(current.trim(), columns, embeds);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) pushPart(current.trim(), columns, embeds);
  return { columns, embeds };
}

function pushPart(
  part: string,
  columns: string[],
  embeds: Array<{ relation: string; inner: string }>,
) {
  const embed = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
  if (embed) {
    embeds.push({ relation: embed[1], inner: embed[2] });
    return;
  }
  columns.push(part);
}

export function assertColumnsOnTable(table: string, columns: string[]) {
  const allowed = SCHEMA_BY_TABLE[table];
  if (!allowed) {
    throw new Error(`No migration-backed allowlist for table ${table}`);
  }
  for (const col of columns) {
    if (col.includes("!") || col.includes(":")) {
      throw new Error(`${table} projection uses a hint or alias (${col}) that must be reviewed`);
    }
    if (!allowed.includes(col)) {
      throw new Error(`${table}.${col} is not in migrations 001–064 allowlist`);
    }
  }
}

export function assertSelectAgainstSchema(table: string, select: string) {
  const parsed = parsePostgrestSelect(select);
  if (parsed.columns.includes("*")) {
    throw new Error(`${table} projection uses *`);
  }
  assertColumnsOnTable(table, parsed.columns);
  for (const embed of parsed.embeds) {
    const nestedTable = POSTGREST_EMBED_TABLE[embed.relation];
    if (!nestedTable) {
      throw new Error(`Unknown embed ${embed.relation} on ${table}`);
    }
    assertSelectAgainstSchema(nestedTable, embed.inner);
  }
}
