import "server-only";

import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PermissionKey } from "@/lib/permissions/catalog";
import { listGrantedPermissions } from "@/lib/permissions/evaluate";
import type { AuthUserRoleRow } from "@/lib/auth/auth-grants";
import { logger } from "@/lib/logger";
import type { AuthContext, Employee, Organization, Profile } from "@/types/models";
import type { MembershipStatus } from "@/types/enums";
import { resolveAuthFromBundle } from "@/lib/auth/resolve-auth-bundle";
import {
  AUTH_EMPLOYEE_COLUMNS,
  AUTH_ORGANIZATION_COLUMNS,
  AUTH_PROFILE_COLUMNS,
} from "@/lib/query-projections";
import { startPerf } from "@/lib/perf/server-timing";

type AuthBundle = Profile & {
  organization_members:
    | Array<{
        organization_id: string;
        status: MembershipStatus;
        joined_at: string | null;
        organizations: Organization | Organization[] | null;
      }>
    | null;
  employees: Employee[] | Employee | null;
  user_roles: AuthUserRoleRow[] | null;
};

async function loadAuthContext(): Promise<AuthContext | null> {
  const done = startPerf("auth_context");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    done();
    return null;
  }

  const doneBundle = startPerf("auth_context_bundle");
  const { data: bundle, error: bundleError } = await supabase
    .from("profiles")
    .select(
      `${AUTH_PROFILE_COLUMNS}, organization_members(organization_id, status, joined_at, organizations(${AUTH_ORGANIZATION_COLUMNS})), employees(${AUTH_EMPLOYEE_COLUMNS}), user_roles(organization_id, scope_type, scope_id, roles(code, is_external, is_system, is_active, role_permissions(permission_key)))`,
    )
    .eq("id", user.id)
    .maybeSingle<AuthBundle>();
  doneBundle();

  if (bundleError) {
    logger.error("auth context bundle query failed", { code: bundleError.code ?? null });
  }

  if (!bundle) {
    done();
    return null;
  }

  const profile: Profile = {
    id: bundle.id,
    full_name_ar: bundle.full_name_ar,
    full_name_en: bundle.full_name_en,
    phone: bundle.phone,
    locale: bundle.locale,
    is_active: bundle.is_active,
    is_platform_admin: bundle.is_platform_admin,
    avatar_path: bundle.avatar_path,
    last_seen_at: bundle.last_seen_at,
    created_at: bundle.created_at,
    updated_at: bundle.updated_at,
  };

  const resolved = resolveAuthFromBundle({
    profile,
    memberships: bundle.organization_members,
    employees: bundle.employees,
    roleRows: bundle.user_roles,
  });
  if (!resolved) {
    done();
    return null;
  }

  const grants = [...resolved.grants];
  if (resolved.profile.is_platform_admin) {
    const { ALL_INTERNAL_PERMISSIONS } = await import("@/lib/permissions/catalog");
    grants.unshift({
      roleCode: "super_admin",
      isExternal: false,
      organizationId: resolved.organization.id,
      scopeType: "organization",
      scopeId: null,
      permissions: ALL_INTERNAL_PERMISSIONS,
    });
  }

  const permissions = listGrantedPermissions(grants, {
    organizationId: resolved.organization.id,
  }) as PermissionKey[];

  done();
  return {
    userId: user.id,
    profile: resolved.profile,
    organization: resolved.organization,
    employee: resolved.employee,
    membershipStatus: resolved.membershipStatus,
    grants,
    permissions,
  };
}

/** Request-scoped only (React cache). Must never be a process-global store. */
export const getAuthContext = cache(loadAuthContext);
