import { ConflictError, DatabaseError, ValidationError } from "@/lib/errors";
import { generateInternalAuthEmail } from "@/lib/auth/employee-login";
import { logger } from "@/lib/logger";

export const CREATE_EMPLOYEE_ROUTE = "/employees";
export const CREATE_EMPLOYEE_ACTION = "createEmployee";

/** GoTrue-style mailbox check: no empty labels, no `.@`, no `..`. */
export const GOTRUE_EMAIL_SHAPE =
  /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isGotrueCompatibleEmail(email: string): boolean {
  if (!email || email.includes("..") || email.includes(".@") || email.includes("@.")) return false;
  return GOTRUE_EMAIL_SHAPE.test(email);
}

const CODE_TOKEN = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3}|[a-z_]+)$/i;
const CONSTRAINT_TOKEN = /^[a-z0-9_]+$/i;

function postgrestOrAuthCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const rec = error as { code?: unknown; status?: unknown; name?: unknown };
  if (typeof rec.code === "string" && CODE_TOKEN.test(rec.code)) return rec.code;
  if (typeof rec.status === "number") return String(rec.status);
  return null;
}

function safeConstraint(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const rec = error as { message?: unknown; details?: unknown; hint?: unknown };
  const blob = `${rec.message ?? ""} ${rec.details ?? ""} ${rec.hint ?? ""}`;
  const quoted = blob.match(/constraint \"([a-z0-9_]+)\"/i);
  if (quoted && CONSTRAINT_TOKEN.test(quoted[1] ?? "")) return quoted[1] ?? null;
  return null;
}

export function logCreateEmployeeOpFailure(operation: string, error: unknown): void {
  logger.error("create employee op failed", {
    route: CREATE_EMPLOYEE_ROUTE,
    action: CREATE_EMPLOYEE_ACTION,
    operation,
    errorClass: error instanceof Error ? error.name : "unknown",
    code: postgrestOrAuthCode(error),
    constraint: safeConstraint(error),
  });
}

export function buildCreateEmployeeProfileMetadata(input: {
  fullNameAr: string;
  fullNameEn: string;
  employeeNumber: string;
  loginProvisioned: boolean;
}) {
  return {
    full_name_ar: input.fullNameAr,
    full_name_en: input.fullNameEn,
    locale: "ar" as const,
    employee_number: input.employeeNumber,
    login_provisioned: input.loginProvisioned,
  };
}

export function buildCreateEmployeeMembershipPayload(organizationId: string, profileId: string) {
  return {
    organization_id: organizationId,
    profile_id: profileId,
    status: "active" as const,
  };
}

export function buildCreateEmployeeInsertPayload(input: {
  organizationId: string;
  profileId: string;
  employeeNumber: string;
  jobTitleAr?: string;
  jobTitleEn?: string;
  employmentType?: string;
  nationality?: string;
  workLocation?: string;
  joiningDate?: string;
}) {
  return {
    organization_id: input.organizationId,
    profile_id: input.profileId,
    employee_number: input.employeeNumber,
    job_title_ar: input.jobTitleAr ?? null,
    job_title_en: input.jobTitleEn ?? null,
    employment_type: input.employmentType ?? null,
    nationality: input.nationality ?? null,
    work_location: input.workLocation ?? null,
    joining_date: input.joiningDate ?? null,
    employment_status: "active" as const,
    is_active: true,
  };
}

export type CreateEmployeeAuthRequest = {
  params: {
    email: string;
    email_confirm: true;
    password: string;
    user_metadata: ReturnType<typeof buildCreateEmployeeProfileMetadata>;
  };
  loginProvisioned: boolean;
};

/** Auth Admin createUser always sends a password. Blank HR password is not sent as "". */
export function buildCreateEmployeeAuthRequest(input: {
  organizationId: string;
  employeeNumber: string;
  fullNameAr: string;
  fullNameEn: string;
  email?: string;
  initialPassword?: string;
}): CreateEmployeeAuthRequest {
  const email = input.email ?? generateInternalAuthEmail(input.organizationId, input.employeeNumber);
  const loginProvisioned = Boolean(input.initialPassword);
  const password = input.initialPassword ?? `${crypto.randomUUID()}Aa1!`;
  return {
    loginProvisioned,
    params: {
      email,
      email_confirm: true,
      password,
      user_metadata: buildCreateEmployeeProfileMetadata({
        fullNameAr: input.fullNameAr,
        fullNameEn: input.fullNameEn,
        employeeNumber: input.employeeNumber,
        loginProvisioned,
      }),
    },
  };
}

export function assertCreateEmployeeAuthRequest(request: CreateEmployeeAuthRequest): void {
  if (!request.params.password || request.params.password.length < 8) {
    throw new ValidationError("تعذر إنشاء حساب الدخول.", "Auth password payload invalid.");
  }
  if (!isGotrueCompatibleEmail(request.params.email)) {
    throw new ValidationError("تعذر إنشاء حساب الدخول.", "Internal auth identity is not a valid mailbox.");
  }
}

export function mapAuthCreateUserFailure(error: unknown): never {
  logCreateEmployeeOpFailure("auth.createUser", error);
  const code = postgrestOrAuthCode(error);
  const rec = error && typeof error === "object" ? (error as { message?: unknown }) : null;
  const msg = typeof rec?.message === "string" ? rec.message : "";
  if (
    code === "email_exists" ||
    code === "422" ||
    /already been registered|already exists|duplicate/i.test(msg)
  ) {
    throw new ConflictError(
      "تعذر إنشاء حساب الدخول لأن الهوية مستخدمة مسبقاً.",
      "Auth identity already exists.",
    );
  }
  throw new ValidationError("تعذر إنشاء حساب الدخول.", "Auth createUser failed.");
}

export function mapMembershipInsertFailure(error: unknown): never {
  logCreateEmployeeOpFailure("organization_members.insert", error);
  throw new ValidationError("تعذر ربط الموظف بالمنشأة.", "Membership insert failed.");
}

export function mapEmployeeInsertFailure(error: unknown): never {
  logCreateEmployeeOpFailure("employees.insert", error);
  const rec = error && typeof error === "object" ? (error as { code?: string; message?: string; details?: string }) : null;
  const conflict = rec
    ? (rec.code === "23505" && `${rec.message ?? ""} ${rec.details ?? ""}`.toLowerCase().includes("employee_number")
        ? "الرقم الوظيفي مستخدم مسبقاً في هذه المنشأة."
        : rec.code === "23505"
          ? "هذه البيانات مستخدمة مسبقاً."
          : null)
    : null;
  if (conflict) throw new ConflictError(conflict, "Employee insert conflict.");
  throw new DatabaseError(error);
}

export function mapDepartmentInsertFailure(error: unknown): never {
  logCreateEmployeeOpFailure("employee_departments.insert", error);
  throw new ValidationError("تعذر ربط الموظف بالقسم.", "Department assignment failed.");
}

export function mapRoleInsertFailure(error: unknown): never {
  logCreateEmployeeOpFailure("user_roles.insert", error);
  throw new ValidationError("تعذر تعيين الدور.", "Role assignment failed.");
}

/** Ordered steps for documentation / tests — creation is not atomic. */
export const CREATE_EMPLOYEE_PIPELINE = [
  "auth.createUser",
  "profiles.handle_new_user",
  "organization_members.insert",
  "employees.insert",
  "employee_departments.insert?",
  "user_roles.insert?",
  "audit.log",
  "domain_events.emit",
  "hr_alert_hooks.sync?",
  "redirect",
] as const;
