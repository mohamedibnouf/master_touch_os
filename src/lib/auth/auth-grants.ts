import { isPermissionKey } from "@/lib/permissions/catalog";
import type { RoleGrant, RoleScopeType } from "@/lib/permissions/evaluate";

export type AuthRolePermissionRow = { permission_key: string };

export type AuthRoleEmbed = {
  code: string;
  is_external: boolean;
  is_system?: boolean;
  is_active?: boolean;
  role_permissions?: AuthRolePermissionRow[] | null;
};

export type AuthUserRoleRow = {
  organization_id: string;
  scope_type: RoleScopeType;
  scope_id: string | null;
  roles: AuthRoleEmbed | AuthRoleEmbed[] | null;
};

/**
 * Map PostgREST user_roles + nested roles/role_permissions into grants.
 * Nested to-many embeds may be null after a partial session; never throw.
 */
export function mapUserRoleRowsToGrants(rows: AuthUserRoleRow[] | null | undefined): RoleGrant[] {
  return (rows ?? []).flatMap((raw) => {
    const role = Array.isArray(raw.roles) ? raw.roles[0] : raw.roles;
    if (!role?.code) {
      return [];
    }
    if (role.is_system !== true && role.is_active === false) {
      return [];
    }
    const permissionRows = Array.isArray(role.role_permissions) ? role.role_permissions : [];
    return [
      {
        roleCode: role.code,
        isExternal: role.is_external,
        organizationId: raw.organization_id,
        scopeType: raw.scope_type,
        scopeId: raw.scope_id,
        permissions: permissionRows.map((item) => item.permission_key).filter(isPermissionKey),
      },
    ];
  });
}
