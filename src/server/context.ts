import "server-only";

import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { listGrantedPermissions } from "@/lib/permissions/evaluate";
import { mapUserRoleRowsToGrants, type AuthUserRoleRow } from "@/lib/auth/auth-grants";
import { logger } from "@/lib/logger";
import type { AuthContext, Employee, Organization, Profile } from "@/types/models";
import type { MembershipStatus } from "@/types/enums";
import {
  AUTH_EMPLOYEE_COLUMNS,
  AUTH_ORGANIZATION_COLUMNS,
  AUTH_PROFILE_COLUMNS,
} from "@/lib/query-projections";

async function loadAuthContext(): Promise<AuthContext | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("profiles").select(AUTH_PROFILE_COLUMNS).eq("id", user.id).maybeSingle<Profile>(),
    supabase
      .from("organization_members")
      .select(`organization_id, status, organizations(${AUTH_ORGANIZATION_COLUMNS})`)
      .eq("profile_id", user.id)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle<{
        organization_id: string;
        status: MembershipStatus;
        organizations: Organization | Organization[] | null;
      }>(),
  ]);

  const profile = profileResult.data;
  if (!profile) {
    return null;
  }

  const membership = membershipResult.data;
  const organization = Array.isArray(membership?.organizations)
    ? membership.organizations[0]
    : membership?.organizations;

  if (!membership || !organization) {
    return null;
  }

  const [employeeResult, roleResult] = await Promise.all([
    supabase
      .from("employees")
      .select(AUTH_EMPLOYEE_COLUMNS)
      .eq("organization_id", organization.id)
      .eq("profile_id", user.id)
      .limit(1)
      .maybeSingle<Employee>(),
    supabase
      .from("user_roles")
      .select("organization_id, scope_type, scope_id, roles(code, is_external, role_permissions(permission_key))")
      .eq("profile_id", user.id)
      .eq("organization_id", organization.id),
  ]);

  if (roleResult.error) {
    logger.error("auth user_roles query failed", { code: roleResult.error.code ?? null });
  }

  const employee = employeeResult.data ?? null;
  const grants = mapUserRoleRowsToGrants(roleResult.data as AuthUserRoleRow[] | null);

  if (profile.is_platform_admin) {
    const { ALL_INTERNAL_PERMISSIONS } = await import("@/lib/permissions/catalog");
    grants.unshift({
      roleCode: "super_admin",
      isExternal: false,
      organizationId: organization.id,
      scopeType: "organization",
      scopeId: null,
      permissions: ALL_INTERNAL_PERMISSIONS,
    });
  }

  const permissions = listGrantedPermissions(grants, {
    organizationId: organization.id,
  }) as PermissionKey[];

  return {
    userId: user.id,
    profile,
    organization,
    employee,
    membershipStatus: membership.status,
    grants,
    permissions,
  };
}

/** Request-scoped only (React cache). Must never be a process-global store. */
export const getAuthContext = cache(loadAuthContext);
