/**
 * Pure guards for account-level HR/admin actions (login provisioning, activation,
 * role grants, employment status). No I/O — the server actions load the facts.
 */

import { isPrivilegedRoleCode } from "@/lib/hr/roles";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";

type Message = { ar: string; en: string };

export type ProvisionLoginRejectReason =
  | "already_provisioned"
  | "platform_admin"
  | "privileged"
  | "other_org";

/**
 * Provisioning sets an initial password through the Auth Admin API. It is only safe for
 * an account nobody uses yet: never for one that is provisioned or has signed in (that
 * would be a password reset, i.e. account takeover), never for platform admins or
 * privileged role holders, and never for accounts that belong to another organization.
 */
export function provisionLoginRejectReason(input: {
  loginProvisioned: boolean;
  hasSignedIn: boolean;
  targetIsPlatformAdmin: boolean;
  targetRoleCodes: readonly (string | null | undefined)[];
  otherOrganizationMemberships: number;
}): ProvisionLoginRejectReason | null {
  if (input.targetIsPlatformAdmin) return "platform_admin";
  if (input.targetRoleCodes.some((code) => isPrivilegedRoleCode(code))) return "privileged";
  if (input.otherOrganizationMemberships > 0) return "other_org";
  if (input.loginProvisioned || input.hasSignedIn) return "already_provisioned";
  return null;
}

export const PROVISION_LOGIN_REJECT_MESSAGES: Record<ProvisionLoginRejectReason, Message> = {
  already_provisioned: {
    ar: "حساب الدخول مفعّل مسبقاً. لا يمكن تغيير كلمة المرور من هنا.",
    en: "This login is already active. Its password cannot be changed here.",
  },
  platform_admin: {
    ar: "لا يمكن تفعيل الدخول لحساب مدير المنصة من هذا المسار.",
    en: "Platform admin accounts cannot be provisioned from this path.",
  },
  privileged: {
    ar: "لا يمكن تفعيل الدخول لحساب يحمل دور إدارة محمي من هذا المسار.",
    en: "Accounts holding a protected management role cannot be provisioned here.",
  },
  other_org: {
    ar: "هذا الحساب مرتبط بمنشأة أخرى ولا يمكن تفعيل دخوله من هنا.",
    en: "This account belongs to another organization and cannot be provisioned here.",
  },
};

export type AccountStatusRejectReason = "self" | "platform_admin" | "privileged";

/** Who may deactivate/reactivate whom. Protected accounts need an equally privileged actor. */
export function accountStatusRejectReason(input: {
  actorProfileId: string;
  actorIsPlatformAdmin: boolean;
  actorRoleCodes: readonly (string | null | undefined)[];
  targetProfileId: string;
  targetIsPlatformAdmin: boolean;
  targetRoleCodes: readonly (string | null | undefined)[];
}): AccountStatusRejectReason | null {
  if (input.actorProfileId === input.targetProfileId) return "self";
  if (input.targetIsPlatformAdmin && !input.actorIsPlatformAdmin) return "platform_admin";
  const actorPrivileged =
    input.actorIsPlatformAdmin || input.actorRoleCodes.some((code) => isPrivilegedRoleCode(code));
  if (input.targetRoleCodes.some((code) => isPrivilegedRoleCode(code)) && !actorPrivileged) {
    return "privileged";
  }
  return null;
}

export const ACCOUNT_STATUS_REJECT_MESSAGES: Record<AccountStatusRejectReason, Message> = {
  self: {
    ar: "لا يمكنك إيقاف حسابك الحالي.",
    en: "You cannot disable your own account.",
  },
  platform_admin: {
    ar: "لا يمكن تغيير حالة حساب مدير المنصة.",
    en: "The platform admin account status cannot be changed.",
  },
  privileged: {
    ar: "لا يمكن تغيير حالة حساب يحمل دور إدارة محمي من هذا المسار.",
    en: "Accounts holding a protected management role cannot be changed here.",
  },
};

export type RoleAssignmentRejectReason = "missing" | "external" | "privileged" | "inactive" | "cross_org";

export const ROLE_ASSIGNMENT_REJECT_MESSAGES: Record<RoleAssignmentRejectReason, Message> = {
  missing: { ar: "الدور غير موجود.", en: "The role was not found." },
  external: {
    ar: "لا يمكن منح الأدوار الخارجية صلاحية داخلية.",
    en: "External roles cannot be granted internal access.",
  },
  privileged: {
    ar: "لا يمكن منح هذا الدور من مسار الموارد البشرية.",
    en: "That role cannot be assigned from the HR path.",
  },
  inactive: { ar: "لا يمكن تعيين دور موقوف.", en: "Inactive roles cannot be assigned." },
  cross_org: {
    ar: "لا يمكن تعيين دور من منشأة أخرى.",
    en: "Roles cannot be assigned across organizations.",
  },
};

/** Ban length used to revoke sessions of a deactivated account (Auth Admin API format). */
export const DEACTIVATED_ACCOUNT_BAN_DURATION = "876000h";

const TERMINAL_EMPLOYMENT_STATUSES = new Set(["terminated", "resigned"]);

export function isTerminalEmploymentStatus(status: string | null | undefined): boolean {
  return Boolean(status && TERMINAL_EMPLOYMENT_STATUSES.has(status));
}

/**
 * terminated_at for a Riyadh calendar day. Noon Riyadh (09:00 UTC) so `terminated_at::date`
 * is the same day in both UTC (payroll SQL) and Asia/Riyadh (UI).
 */
export function riyadhTerminationTimestamp(now = new Date()): string {
  return `${riyadhTodayYmd(now)}T12:00:00+03:00`;
}

/**
 * Keeps terminated_at consistent with employment_status: stamped (Riyadh today) when the
 * status moves into terminated/resigned, kept while it stays terminal, cleared when the
 * employee is reactivated. Returns undefined when the column should not be touched.
 */
export function terminationPatch(input: {
  previousStatus: string | null | undefined;
  nextStatus: string;
  previousTerminatedAt: string | null | undefined;
  now?: Date;
}): { terminated_at: string | null } | undefined {
  const wasTerminal = isTerminalEmploymentStatus(input.previousStatus);
  const isTerminal = isTerminalEmploymentStatus(input.nextStatus);
  if (isTerminal) {
    if (wasTerminal && input.previousTerminatedAt) return undefined;
    return { terminated_at: riyadhTerminationTimestamp(input.now) };
  }
  if (input.previousTerminatedAt) return { terminated_at: null };
  return undefined;
}

/** Employment-form columns that are only written when the submitted form carries them. */
export const EMPLOYMENT_OPTIONAL_FORM_FIELDS = [
  "employee_number",
  "employment_type",
  "joining_date",
  "contract_start",
  "contract_end",
  "probation_end",
  "work_location",
  "nationality",
  "date_of_birth",
  "gender",
  "direct_manager_employee_id",
] as const;

/** Drops the listed keys whose form field was not submitted, so a save never nulls them. */
export function omitAbsentFormFields<T extends Record<string, unknown>>(
  patch: T,
  formData: Pick<FormData, "has">,
  optionalKeys: readonly string[],
): Partial<T> {
  const out: Partial<T> = { ...patch };
  for (const key of optionalKeys) {
    if (!formData.has(key)) delete out[key as keyof T];
  }
  return out;
}
