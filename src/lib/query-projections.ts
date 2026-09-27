/** Explicit PostgREST projections for list/picker/header reads. Not used for payroll calculation rows. */

export const AUTH_PROFILE_COLUMNS =
  "id, full_name_ar, full_name_en, phone, locale, is_active, is_platform_admin, avatar_path, last_seen_at, created_at, updated_at" as const;

export const AUTH_ORGANIZATION_COLUMNS =
  "id, name_ar, name_en, legal_name, commercial_registration, vat_number, logo_path, country, timezone, default_currency, status, leave_day_basis, created_at, updated_at" as const;

export const AUTH_EMPLOYEE_COLUMNS =
  "id, organization_id, profile_id, employee_number, job_title_ar, job_title_en, employment_status, is_active" as const;

export const PROJECT_LIST_COLUMNS =
  "id, project_code, name_ar, name_en, status, risk_level, progress_percentage, project_manager_id, created_at" as const;

export const PROJECT_PICKER_COLUMNS = "id, project_code, name_ar" as const;

export const DOCUMENT_LIST_COLUMNS =
  "id, title, category, current_revision, status, created_at, project_id, document_number" as const;

export const NOTIFICATION_LIST_COLUMNS =
  "id, title, message, type, priority, read_at, created_at, entity_type, entity_id" as const;

export const NOTIFICATION_HEADER_COLUMNS = "id, title, created_at, read_at, entity_type, entity_id" as const;

export const DEPARTMENT_LIST_COLUMNS =
  "id, organization_id, code, name_ar, name_en, description, parent_department_id, manager_user_id, is_active" as const;

export const ROLE_LIST_COLUMNS = "id, code, name_ar, name_en, is_system, is_external" as const;

export const PAYROLL_PERIOD_LIST_COLUMNS =
  "id, year, month, status, employee_count, total_gross, total_net" as const;

export const LEAVE_REQUEST_LIST_COLUMNS =
  "id, employee_id, leave_type_id, start_date, end_date, total_days, status, approval_stage, submitted_at, created_at" as const;

export const LEAVE_BALANCE_LIST_COLUMNS =
  "id, leave_type_id, year, entitled_days, used_days, pending_days, available_days" as const;

export const ATTENDANCE_RECORD_LIST_COLUMNS =
  "id, organization_id, employee_id, attendance_date, attendance_status, check_in_at, check_out_at, worked_minutes, late_minutes, source, check_in_distance_meters, check_out_distance_meters, check_in_location_verified, check_out_location_verified" as const;

export const AUDIT_FEED_COLUMNS = "id, action, entity_type, entity_id, created_at, actor_id" as const;

export const PROJECT_MEMBER_COLUMNS =
  "id, profile_id, role_label, is_active, assigned_at, unassigned_at, profiles(id, full_name_ar, full_name_en, is_active)" as const;
