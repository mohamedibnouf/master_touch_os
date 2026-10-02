import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseError } from "@/lib/errors";
import { logger } from "@/lib/logger";

function fail(error: { message?: string; code?: string } | null): never {
  logger.error("role query failed", { code: error?.code ?? null });
  throw new DatabaseError(error);
}

export type RoleRecord = {
  id: string;
  organization_id: string | null;
  code: string;
  name_ar: string;
  name_en: string;
  is_system: boolean;
  is_external: boolean;
  is_active: boolean;
  department_id: string | null;
  created_at: string;
};

export type RolePermissionRow = { role_id: string; permission_key: string };

export type UserRoleGrantRow = {
  id: string;
  organization_id: string;
  profile_id: string;
  role_id: string;
  scope_type: string;
  granted_at: string;
  roles: Pick<RoleRecord, "id" | "code" | "name_ar" | "name_en" | "is_system" | "is_external" | "is_active"> | null;
};

const ROLE_COLUMNS =
  "id, organization_id, code, name_ar, name_en, is_system, is_external, is_active, department_id, created_at";

export class RoleRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listSystemRoles(): Promise<RoleRecord[]> {
    const { data, error } = await this.supabase
      .from("roles")
      .select(ROLE_COLUMNS)
      .eq("is_system", true)
      .is("organization_id", null)
      .order("name_ar");
    if (error) fail(error);
    return (data ?? []) as RoleRecord[];
  }

  async listCustomRoles(organizationId: string): Promise<RoleRecord[]> {
    const { data, error } = await this.supabase
      .from("roles")
      .select(ROLE_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("is_system", false)
      .order("name_ar");
    if (error) fail(error);
    return (data ?? []) as RoleRecord[];
  }

  async getById(roleId: string): Promise<RoleRecord | null> {
    const { data, error } = await this.supabase.from("roles").select(ROLE_COLUMNS).eq("id", roleId).maybeSingle();
    if (error) fail(error);
    return (data as RoleRecord | null) ?? null;
  }

  async listPermissions(roleIds: string[]): Promise<RolePermissionRow[]> {
    if (roleIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from("role_permissions")
      .select("role_id, permission_key")
      .in("role_id", roleIds);
    if (error) fail(error);
    return (data ?? []) as RolePermissionRow[];
  }

  async countAssignments(organizationId: string, roleIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (roleIds.length === 0) return counts;
    const { data, error } = await this.supabase
      .from("user_roles")
      .select("role_id")
      .eq("organization_id", organizationId)
      .in("role_id", roleIds);
    if (error) fail(error);
    for (const row of data ?? []) {
      const id = (row as { role_id: string }).role_id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  async listGrantsForProfile(organizationId: string, profileId: string): Promise<UserRoleGrantRow[]> {
    const { data, error } = await this.supabase
      .from("user_roles")
      .select(
        "id, organization_id, profile_id, role_id, scope_type, granted_at, roles(id, code, name_ar, name_en, is_system, is_external, is_active)",
      )
      .eq("organization_id", organizationId)
      .eq("profile_id", profileId)
      .order("granted_at");
    if (error) fail(error);
    return (data ?? []).map((row) => {
      const typed = row as Omit<UserRoleGrantRow, "roles"> & {
        roles: UserRoleGrantRow["roles"] | UserRoleGrantRow["roles"][] | null;
      };
      const role = Array.isArray(typed.roles) ? typed.roles[0] ?? null : typed.roles;
      return { ...typed, roles: role };
    });
  }

  async createCustomRole(input: {
    organizationId: string;
    nameAr: string;
    nameEn: string;
    code: string | null;
    departmentId: string | null;
    permissionKeys: string[];
  }): Promise<string> {
    const { data, error } = await this.supabase.rpc("create_organization_role", {
      p_organization_id: input.organizationId,
      p_name_ar: input.nameAr,
      p_name_en: input.nameEn,
      p_code: input.code,
      p_department_id: input.departmentId,
      p_permission_keys: input.permissionKeys,
    });
    if (error) fail(error);
    return String(data);
  }

  async updateCustomRole(input: {
    organizationId: string;
    roleId: string;
    nameAr: string;
    nameEn: string;
    departmentId: string | null;
    permissionKeys: string[];
  }): Promise<void> {
    const { error } = await this.supabase.rpc("update_organization_role", {
      p_organization_id: input.organizationId,
      p_role_id: input.roleId,
      p_name_ar: input.nameAr,
      p_name_en: input.nameEn,
      p_department_id: input.departmentId,
      p_permission_keys: input.permissionKeys,
    });
    if (error) fail(error);
  }

  async setCustomRoleActive(organizationId: string, roleId: string, isActive: boolean): Promise<void> {
    const { error } = await this.supabase.rpc("set_organization_role_active", {
      p_organization_id: organizationId,
      p_role_id: roleId,
      p_is_active: isActive,
    });
    if (error) fail(error);
  }
}
