import { logger } from "@/lib/logger";
import { isPrivilegedRoleCode } from "@/lib/hr/roles";
import type { z } from "zod";

export const CREATE_EMPLOYEE_FIELD_KEYS = [
  "employee_number",
  "full_name_ar",
  "full_name_en",
  "email",
  "initial_password",
  "job_title_id",
  "job_title_ar",
  "job_title_en",
  "department_id",
  "role_id",
  "employment_type",
  "nationality",
  "work_location",
  "joining_date",
] as const;

export type CreateEmployeeFieldKey = (typeof CREATE_EMPLOYEE_FIELD_KEYS)[number];

function formText(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : "";
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Maps native FormData the way the /employees create form actually submits it. */
export function readCreateEmployeeFormData(formData: FormData) {
  return {
    employee_number: formText(formData, "employee_number"),
    full_name_ar: formText(formData, "full_name_ar"),
    full_name_en: formText(formData, "full_name_en"),
    email: optionalTrimmed(formText(formData, "email")),
    initial_password: optionalTrimmed(formText(formData, "initial_password")),
    job_title_id: optionalTrimmed(formText(formData, "job_title_id")),
    job_title_ar: optionalTrimmed(formText(formData, "job_title_ar")),
    job_title_en: optionalTrimmed(formText(formData, "job_title_en")),
    department_id: optionalTrimmed(formText(formData, "department_id")),
    role_id: optionalTrimmed(formText(formData, "role_id")),
    employment_type: optionalTrimmed(formText(formData, "employment_type")),
    nationality: optionalTrimmed(formText(formData, "nationality")),
    work_location: optionalTrimmed(formText(formData, "work_location")),
    joining_date: optionalTrimmed(formText(formData, "joining_date")),
  };
}

export type CreateEmployeeFormPayload = ReturnType<typeof readCreateEmployeeFormData>;

function issueMessageAr(issue: z.ZodIssue): string {
  const field = String(issue.path[0] ?? "");
  if (field === "employee_number") {
    if (issue.code === "too_small") return "الرقم الوظيفي مطلوب.";
    return "الرقم الوظيفي غير صالح.";
  }
  if (field === "full_name_ar") {
    if (issue.code === "too_small") return "اسم الموظف بالعربية يجب ألا يقل عن حرفين.";
    return "اسم الموظف بالعربية مطلوب.";
  }
  if (field === "full_name_en") {
    if (issue.code === "too_small") return "اسم الموظف بالإنجليزية يجب ألا يقل عن حرفين.";
    return "اسم الموظف بالإنجليزية مطلوب.";
  }
  if (field === "email") return "البريد الداخلي غير صالح.";
  if (field === "initial_password") return "كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.";
  if (field === "employment_type") return "نوع التوظيف غير صالح.";
  if (field === "department_id") return "القسم المحدد غير صالح.";
  if (field === "role_id") return "صلاحية النظام المحددة غير صالحة.";
  if (field === "joining_date") return "تاريخ الالتحاق غير صالح.";
  if (field === "job_title_id" || field === "job_title_ar" || field === "job_title_en") {
    return "المسمى الوظيفي غير صالح.";
  }
  if (field === "nationality") return "الجنسية غير صالحة.";
  if (field === "work_location") return "موقع العمل غير صالح.";
  return "تحقق من بيانات الموظف.";
}

export function createEmployeeValidationMessageAr(error: z.ZodError): string {
  const messages = [...new Set(error.issues.map(issueMessageAr))];
  return messages.join(" ");
}

export function logCreateEmployeeValidationFailure(
  payload: CreateEmployeeFormPayload,
  error: z.ZodError,
): void {
  const fields: Record<string, "present" | "missing"> = {};
  for (const key of CREATE_EMPLOYEE_FIELD_KEYS) {
    const value = payload[key];
    fields[key] = value == null || value === "" ? "missing" : "present";
  }
  logger.warn("create employee validation failed", {
    route: "/employees",
    operation: "createEmployee",
    fields,
    issueCodes: error.issues.map((issue) => `${String(issue.path[0] ?? "form")}:${issue.code}`),
  });
}

export function createEmployeeLoginProvisioned(password: string | undefined): boolean {
  return Boolean(password);
}

export function employeeNumberConflictMessage(error: {
  code?: string;
  message?: string;
  details?: string;
} | null): string | null {
  if (error?.code !== "23505") return null;
  const blob = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (blob.includes("employee_number")) {
    return "الرقم الوظيفي مستخدم مسبقاً في هذه المنشأة.";
  }
  return "هذه البيانات مستخدمة مسبقاً.";
}

export function hrCreateRoleAssignmentError(input: {
  roleId: string | undefined;
  canAssignRole: boolean;
  isPlatformAdmin: boolean;
  role: { code: string; is_external: boolean } | null;
}): "forbidden" | "external" | "privileged" | null {
  if (!input.roleId) return null;
  if (!input.canAssignRole) return "forbidden";
  if (input.role?.is_external) return "external";
  if (isPrivilegedRoleCode(input.role?.code) && !input.isPlatformAdmin) {
    return "privileged";
  }
  return null;
}
