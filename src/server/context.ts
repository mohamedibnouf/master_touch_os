import "server-only";

import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isPermissionKey, type PermissionKey } from "@/lib/permissions/catalog";
import { listGrantedPermissions, type RoleGrant, type RoleScopeType } from "@/lib/permissions/evaluate";
import type { AuthContext, Employee, Organization, Profile } from "@/types/models";
import type { MembershipStatus } from "@/types/enums";
import {
  AUTH_EMPLOYEE_COLUMNS,
  AUTH_ORGANIZATION_COLUMNS,
  AUTH_PROFILE_COLUMNS,
} from "@/lib/query-projections";

type RoleRow = {
  organization_id: string;
  scope_type: RoleScopeType;
  scope_id: string | null;
  roles: {
    code: string;
    is_external: boolean;
    role_permissions: Array<{ permission_key: string }>;
  } | null;
};

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
      .maybeSingle<Employee>(),
    supabase
      .from("user_roles")
      .select("organization_id, scope_type, scope_id, roles(code, is_external, role_permissions(permission_key))")
      .eq("profile_id", user.id)
      .eq("organization_id", organization.id),
  ]);

  const employee = employeeResult.data;
  const roleRows = roleResult.data;

  const grants: RoleGrant[] = (roleRows ?? []).flatMap((raw) => {
    const row = raw as unknown as RoleRow & {
      roles: RoleRow["roles"] | Array<NonNullable<RoleRow["roles"]>>;
    };
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    if (!role) {
      return [];
    }
    return [
      {
        roleCode: role.code,
        isExternal: role.is_external,
        organizationId: row.organization_id,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        permissions: role.role_permissions
          .map((item) => item.permission_key)
          .filter(isPermissionKey),
      },
    ];
  });

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
