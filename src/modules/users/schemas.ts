import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  full_name_ar: z.string().trim().min(2).max(200),
  full_name_en: z.string().trim().min(2).max(200),
  job_title_ar: z.string().trim().max(160).optional(),
  job_title_en: z.string().trim().max(160).optional(),
  department_id: z.string().uuid().optional().or(z.literal("")),
  role_id: z.string().uuid().optional().or(z.literal("")),
  employee_number: z.string().trim().max(64).optional().or(z.literal("")),
  employment_type: z
    .enum(["permanent", "fixed_term", "part_time", "temporary", "consultant"])
    .optional()
    .or(z.literal("")),
  nationality: z.string().trim().max(120).optional().or(z.literal("")),
  work_location: z.string().trim().max(160).optional().or(z.literal("")),
  joining_date: z.string().optional().or(z.literal("")),
});

export const createEmployeeSchema = createUserSchema.extend({
  employee_number: z.string().trim().min(1).max(64),
  email: z.union([z.literal(""), z.string().email()]).optional(),
  initial_password: z.union([z.literal(""), z.string().min(8).max(128)]).optional(),
});

export const provisionEmployeeLoginSchema = z.object({
  employeeId: z.string().uuid(),
  password: z.string().min(8).max(128),
});

export const updateEmployeeEmploymentSchema = z.object({
  employeeId: z.string().uuid(),
  employee_number: z.string().trim().max(64).optional().nullable(),
  job_title_ar: z.string().trim().max(160).optional().nullable(),
  job_title_en: z.string().trim().max(160).optional().nullable(),
  employment_type: z
    .enum(["permanent", "fixed_term", "part_time", "temporary", "consultant"])
    .optional()
    .nullable()
    .or(z.literal("")),
  employment_status: z.enum(["active", "on_leave", "probation", "terminated", "resigned"]),
  joining_date: z.string().optional().nullable().or(z.literal("")),
  contract_start: z.string().optional().nullable().or(z.literal("")),
  contract_end: z.string().optional().nullable().or(z.literal("")),
  probation_end: z.string().optional().nullable().or(z.literal("")),
  work_location: z.string().trim().max(160).optional().nullable(),
  nationality: z.string().trim().max(120).optional().nullable(),
  date_of_birth: z.string().optional().nullable().or(z.literal("")),
  gender: z.enum(["male", "female", "other", "unspecified"]).optional().nullable().or(z.literal("")),
  direct_manager_employee_id: z.string().uuid().optional().nullable().or(z.literal("")),
});

export const updateEmployeeProfileSchema = z.object({
  employeeId: z.string().uuid(),
  full_name_ar: z.string().trim().min(2).max(200),
  full_name_en: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(40).optional().nullable().or(z.literal("")),
});

export const upsertComplianceSchema = z.object({
  employeeId: z.string().uuid(),
  iqama_number: z.string().trim().max(64).optional().nullable().or(z.literal("")),
  iqama_expiry: z.string().optional().nullable().or(z.literal("")),
  passport_number: z.string().trim().max(64).optional().nullable().or(z.literal("")),
  passport_expiry: z.string().optional().nullable().or(z.literal("")),
  work_permit_expiry: z.string().optional().nullable().or(z.literal("")),
  insurance_provider: z.string().trim().max(160).optional().nullable().or(z.literal("")),
  insurance_expiry: z.string().optional().nullable().or(z.literal("")),
  gosi_number: z.string().trim().max(64).optional().nullable().or(z.literal("")),
});

export const upsertDepartmentSchema = z.object({
  departmentId: z.string().uuid().optional().or(z.literal("")),
  code: z.string().trim().min(1).max(32),
  name_ar: z.string().trim().min(1).max(160),
  name_en: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  parent_department_id: z.string().uuid().optional().nullable().or(z.literal("")),
  manager_user_id: z.string().uuid().optional().nullable().or(z.literal("")),
  is_active: z.boolean().default(true),
});

export const assignRoleSchema = z.object({
  profileId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export const assignDepartmentSchema = z.object({
  employeeId: z.string().uuid(),
  departmentId: z.string().uuid(),
  isPrimary: z.boolean().default(true),
});

export const setUserActiveSchema = z.object({
  profileId: z.string().uuid(),
  isActive: z.boolean(),
});

export const setEmployeeActiveSchema = z.object({
  employeeId: z.string().uuid(),
  isActive: z.boolean(),
});

export const createEmployeeContractSchema = z.object({
  employeeId: z.string().uuid(),
  contract_number: z.string().trim().min(1).max(64),
  contract_type: z.enum(["permanent", "fixed_term", "part_time", "temporary", "consultant"]),
  start_date: z.string().min(1),
  end_date: z.string().optional().nullable().or(z.literal("")),
  probation_end_date: z.string().optional().nullable().or(z.literal("")),
  notice_period_days: z.coerce.number().int().min(0).default(30),
  working_hours_per_week: z.coerce.number().min(1).max(168).default(40),
  currency: z.string().trim().min(1).max(10).default("SAR"),
  initial_basic_salary: z.coerce.number().min(0).optional().nullable(),
  initial_housing_allowance: z.coerce.number().min(0).default(0),
  initial_transport_allowance: z.coerce.number().min(0).default(0),
  initial_other_allowances: z.coerce.number().min(0).default(0),
  signed_document_id: z.string().uuid().optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(500).optional().nullable().or(z.literal("")),
});

export const activateEmployeeContractSchema = z.object({
  contractId: z.string().uuid(),
  employeeId: z.string().uuid(),
});

export const createCompensationVersionSchema = z.object({
  employeeId: z.string().uuid(),
  effective_from: z.string().min(1),
  currency: z.string().trim().min(1).max(10).default("SAR"),
  basic_salary: z.coerce.number().min(0),
  housing_allowance: z.coerce.number().min(0).default(0),
  transport_allowance: z.coerce.number().min(0).default(0),
  other_allowances: z.coerce.number().min(0).default(0),
  change_reason: z.string().trim().max(500).optional().nullable().or(z.literal("")),
});

export const uploadEmployeeDocumentSchema = z.object({
  employeeId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  category: z.enum([
    "contract",
    "id",
    "iqama",
    "passport",
    "insurance",
    "certificate",
    "bank",
    "hr_form",
    "other",
  ]),
  visibility_scope: z.enum(["hr_only", "employee_visible", "finance_visible", "restricted"]),
  document_number: z.string().trim().max(64).optional().nullable().or(z.literal("")),
  issue_date: z.string().optional().nullable().or(z.literal("")),
  expiry_date: z.string().optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(500).optional().nullable().or(z.literal("")),
});

export const upsertEmployeeBankSchema = z.object({
  employeeId: z.string().uuid(),
  bank_name: z.string().trim().min(2).max(120),
  iban: z.string().trim().min(15).max(34),
  account_name: z.string().trim().min(2).max(160),
  swift_code: z.string().trim().max(32).optional().nullable().or(z.literal("")),
  is_primary: z.boolean().default(true),
  accountId: z.string().uuid().optional().nullable().or(z.literal("")),
});

export const deactivateEmployeeBankSchema = z.object({
  employeeId: z.string().uuid(),
  accountId: z.string().uuid(),
});
