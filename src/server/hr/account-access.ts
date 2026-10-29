import "server-only";

import { DatabaseError, ValidationError } from "@/lib/errors";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  DEACTIVATED_ACCOUNT_BAN_DURATION,
  ROLE_ASSIGNMENT_REJECT_MESSAGES,
} from "@/lib/hr/account-security";
import { assignmentRejectReason } from "@/lib/rbac/custom-roles";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

type DepartmentLookupClient = {
  from: AdminClient["from"];
};

export type TargetAccountFacts = {
  profileExists: boolean;
  isPlatformAdmin: boolean;
  /** Role codes held in ANY organization. */
  roleCodes: string[];
  membershipStatus: string | null;
  otherOrganizationMemberships: number;
  otherActiveOrganizationMemberships: number;
};

/**
 * Service-role read of the facts needed to guard account-level actions. Call only after
 * the actor's permission check; returns no secrets.
 */
export async function loadTargetAccountFacts(
  admin: AdminClient,
  input: { organizationId: string; profileId: string },
): Promise<TargetAccountFacts> {
  const [profileResult, rolesResult, membershipsResult] = await Promise.all([
    admin.from("profiles").select("id, is_platform_admin").eq("id", input.profileId).maybeSingle<{
      id: string;
      is_platform_admin: boolean;
    }>(),
    admin.from("user_roles").select("organization_id, roles(code)").eq("profile_id", input.profileId),
    admin.from("organization_members").select("organization_id, status").eq("profile_id", input.profileId),
  ]);
  if (profileResult.error) throw new DatabaseError(profileResult.error);
  if (rolesResult.error) throw new DatabaseError(rolesResult.error);
  if (membershipsResult.error) throw new DatabaseError(membershipsResult.error);

  const roleCodes = ((rolesResult.data ?? []) as Array<{ roles: { code: string } | { code: string }[] | null }>)
    .flatMap((row) => (Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : []))
    .map((role) => role.code);
  const memberships = (membershipsResult.data ?? []) as Array<{ organization_id: string; status: string }>;
  const own = memberships.find((row) => row.organization_id === input.organizationId);
  const others = memberships.filter((row) => row.organization_id !== input.organizationId);

  return {
    profileExists: Boolean(profileResult.data),
    isPlatformAdmin: profileResult.data?.is_platform_admin === true,
    roleCodes,
    membershipStatus: own?.status ?? null,
    otherOrganizationMemberships: others.length,
    otherActiveOrganizationMemberships: others.filter((row) => row.status === "active").length,
  };
}

/** Rejects a department id that is not in the actor's organization. */
export async function assertDepartmentInOrganization(
  client: DepartmentLookupClient,
  organizationId: string,
  departmentId: string | null | undefined,
): Promise<void> {
  if (!departmentId) return;
  const { data, error } = await client
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("organization_id", organizationId)
    .maybeSingle<{ id: string }>();
  if (error) throw new DatabaseError(error);
  if (!data) {
    throw new ValidationError("الإدارة المحددة غير صالحة.", "The selected department is not valid.");
  }
}

/**
 * Same role checks as assignRoleAction (external / privileged / inactive / cross-org),
 * for paths that insert user_roles with the service role.
 */
export async function assertRoleAssignableInOrganization(
  client: DepartmentLookupClient,
  input: { roleId: string; organizationId: string; allowPrivileged: boolean },
): Promise<void> {
  const { data: role, error } = await client
    .from("roles")
    .select("code, is_external, is_system, is_active, organization_id")
    .eq("id", input.roleId)
    .maybeSingle<{
      code: string;
      is_external: boolean;
      is_system: boolean;
      is_active: boolean;
      organization_id: string | null;
    }>();
  if (error) throw new DatabaseError(error);
  const reject = assignmentRejectReason({
    role,
    organizationId: input.organizationId,
    allowPrivileged: input.allowPrivileged,
  });
  if (reject) {
    const message = ROLE_ASSIGNMENT_REJECT_MESSAGES[reject];
    throw new ValidationError(message.ar, message.en);
  }
}

/** The target of a grant must be an active member of the actor's organization. */
export async function assertActiveOrganizationMember(
  client: DepartmentLookupClient,
  organizationId: string,
  profileId: string,
): Promise<void> {
  const { data, error } = await client
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();
  if (error) throw new DatabaseError(error);
  if (!data) {
    throw new ValidationError(
      "المستخدم ليس عضواً نشطاً في هذه المنشأة.",
      "The user is not an active member of this organization.",
    );
  }
}

export type EmployeeProfilePatch = {
  full_name_ar: string;
  full_name_en: string;
  phone: string | null;
  whatsapp_opt_in?: boolean;
};

/**
 * HR edit of an employee's names/phone, with the service role (call after the actor's
 * employee.manage check). Re-proves that the profile belongs to an employee of the actor's
 * organization, refuses platform-admin profiles for non-platform-admin actors (their phone
 * routes operational WhatsApp), writes only the allowed columns, and fails on 0 rows.
 */
export async function updateEmployeeProfileFields(
  admin: AdminClient,
  input: {
    organizationId: string;
    employeeId: string;
    profileId: string;
    actorIsPlatformAdmin: boolean;
    patch: EmployeeProfilePatch;
  },
): Promise<void> {
  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id")
    .eq("id", input.employeeId)
    .eq("organization_id", input.organizationId)
    .eq("profile_id", input.profileId)
    .maybeSingle<{ id: string }>();
  if (employeeError) throw new DatabaseError(employeeError);
  if (!employee) throw new ValidationError("الموظف غير موجود.", "Employee not found.");

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", input.profileId)
    .maybeSingle<{ is_platform_admin: boolean }>();
  if (targetError) throw new DatabaseError(targetError);
  if (!target) throw new ValidationError("الموظف غير موجود.", "Employee not found.");
  if (target.is_platform_admin && !input.actorIsPlatformAdmin) {
    throw new ValidationError(
      "لا يمكن تعديل بيانات حساب مدير المنصة من هذا المسار.",
      "The platform admin profile cannot be edited from this path.",
    );
  }

  const patch: EmployeeProfilePatch = {
    full_name_ar: input.patch.full_name_ar,
    full_name_en: input.patch.full_name_en,
    phone: input.patch.phone,
    ...(input.patch.whatsapp_opt_in === undefined ? {} : { whatsapp_opt_in: input.patch.whatsapp_opt_in }),
  };
  const { data: rows, error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", input.profileId)
    .select("id");
  if (error) throw new DatabaseError(error);
  if (!rows?.length) throw new ValidationError("الموظف غير موجود.", "Employee not found.");
}

/**
 * Soft activation/deactivation, performed with the service role AFTER the caller's
 * permission and target checks. Membership in this organization always follows
 * `isActive`. The global profile flag and the Auth ban (which revokes refresh tokens,
 * i.e. signs the user out everywhere) are only touched when the account has no other
 * active organization, so one tenant cannot lock a user out of another.
 * Never deletes the auth user or history.
 */
export async function applyAccountAccess(
  admin: AdminClient,
  input: {
    organizationId: string;
    profileId: string;
    isActive: boolean;
    otherActiveOrganizationMemberships: number;
  },
): Promise<{ globalChange: boolean }> {
  const { data: membershipRows, error: membershipError } = await admin
    .from("organization_members")
    .update({ status: input.isActive ? "active" : "suspended" })
    .eq("organization_id", input.organizationId)
    .eq("profile_id", input.profileId)
    .select("id");
  if (membershipError) throw new DatabaseError(membershipError);
  if (!membershipRows?.length) {
    throw new ValidationError("المستخدم ليس عضواً في هذه المنشأة.", "The user is not a member of this organization.");
  }

  const globalChange = input.isActive || input.otherActiveOrganizationMemberships === 0;
  if (!globalChange) return { globalChange };

  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .update({ is_active: input.isActive })
    .eq("id", input.profileId)
    .select("id");
  if (profileError) throw new DatabaseError(profileError);
  if (!profileRows?.length) {
    throw new ValidationError("المستخدم غير موجود.", "The user was not found.");
  }

  const { error: banError } = await admin.auth.admin.updateUserById(input.profileId, {
    ban_duration: input.isActive ? "none" : DEACTIVATED_ACCOUNT_BAN_DURATION,
  });
  if (banError) throw new DatabaseError(banError);

  return { globalChange };
}
