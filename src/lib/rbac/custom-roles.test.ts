import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_EMPLOYEE_PERMISSIONS,
  NON_DELEGABLE_PERMISSIONS,
  ROLE_PERMISSION_MAP,
  isPermissionKey,
} from "@/lib/permissions/catalog";
import { mapUserRoleRowsToGrants } from "@/lib/auth/auth-grants";
import { evaluatePermission, listGrantedPermissions, type RoleGrant } from "@/lib/permissions/evaluate";
import {
  assertDelegablePermissionSet,
  assignmentRejectReason,
  canUnassignUserRole,
  grantsFromInactiveCustomRole,
  isReservedSystemRoleCode,
  normalizeCustomRoleCode,
  unionPermissions,
} from "@/lib/rbac/custom-roles";
import { groupPermissionKeys, permissionGroupForKey } from "@/lib/rbac/permission-groups";

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EIGHT = [...BASE_EMPLOYEE_PERMISSIONS];

describe("custom role domain security", () => {
  it("normalizes codes and reserves system codes", () => {
    expect(normalizeCustomRoleCode("Maint Supervisor!", "Maint Supervisor!")).toBe("maint_supervisor");
    expect(normalizeCustomRoleCode(" مشرف الصيانة ", "x")).toBeNull();
    expect(isReservedSystemRoleCode("employee")).toBe(true);
    expect(isReservedSystemRoleCode("maintenance_supervisor")).toBe(false);
  });

  it("rejects empty, unknown, non-delegable, and unheld permissions", () => {
    const held = ["leave.view_self", "leave.view_team", "settings.manage", "role.manage"] as const;
    expect(assertDelegablePermissionSet({ requested: [], actorHolds: held }).ok).toBe(false);
    expect(assertDelegablePermissionSet({ requested: ["not.a.key"], actorHolds: held }).ok).toBe(false);
    const nonDelegable = [
      "role.manage",
      "role.assign",
      "settings.manage",
      "user.create",
      "user.disable",
    ];
    for (const key of nonDelegable) {
      const result = assertDelegablePermissionSet({ requested: [key], actorHolds: held });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("non_delegable");
    }
    const unheld = assertDelegablePermissionSet({ requested: ["leave.view_all"], actorHolds: held });
    expect(unheld.ok).toBe(false);
    if (!unheld.ok) expect(unheld.reason).toBe("not_held");
    expect(assertDelegablePermissionSet({ requested: ["leave.view_team"], actorHolds: held }).ok).toBe(true);
  });

  it("rejects cross-org, inactive custom, and privileged assignment", () => {
    expect(
      assignmentRejectReason({
        role: { code: "ops", is_system: false, is_active: true, organization_id: ORG_B, is_external: false },
        organizationId: ORG_A,
        allowPrivileged: false,
      }),
    ).toBe("cross_org");
    expect(
      assignmentRejectReason({
        role: { code: "ops", is_system: false, is_active: false, organization_id: ORG_A, is_external: false },
        organizationId: ORG_A,
        allowPrivileged: true,
      }),
    ).toBe("inactive");
    expect(
      assignmentRejectReason({
        role: { code: "super_admin", is_system: true, is_active: true, organization_id: null, is_external: false },
        organizationId: ORG_A,
        allowPrivileged: false,
      }),
    ).toBe("privileged");
    expect(
      assignmentRejectReason({
        role: { code: "engineer", is_system: true, is_active: true, organization_id: null, is_external: false },
        organizationId: ORG_A,
        allowPrivileged: false,
      }),
    ).toBeNull();
  });

  it("protects last-role and privileged unassign", () => {
    expect(canUnassignUserRole({ actorIsPlatformAdmin: false, targetRoleCode: "engineer", remainingRoleCount: 1 }).ok).toBe(
      false,
    );
    expect(
      canUnassignUserRole({ actorIsPlatformAdmin: false, targetRoleCode: "general_manager", remainingRoleCount: 2 }).ok,
    ).toBe(false);
    expect(
      canUnassignUserRole({ actorIsPlatformAdmin: true, targetRoleCode: "general_manager", remainingRoleCount: 2 }).ok,
    ).toBe(true);
  });
});

describe("inactive custom roles do not grant", () => {
  it("mapUserRoleRowsToGrants skips inactive custom roles and keeps system roles", () => {
    const grants = mapUserRoleRowsToGrants([
      {
        organization_id: ORG_A,
        scope_type: "organization",
        scope_id: null,
        roles: {
          code: "ops_custom",
          is_external: false,
          is_system: false,
          is_active: false,
          role_permissions: [{ permission_key: "leave.view_team" }],
        },
      },
      {
        organization_id: ORG_A,
        scope_type: "organization",
        scope_id: null,
        roles: {
          code: "employee",
          is_external: false,
          is_system: true,
          is_active: true,
          role_permissions: [{ permission_key: "leave.view_self" }],
        },
      },
    ]);
    expect(grants.map((g) => g.roleCode)).toEqual(["employee"]);
    expect(evaluatePermission(grants, "leave.view_team", { organizationId: ORG_A })).toBe(false);
    expect(evaluatePermission(grants, "leave.view_self", { organizationId: ORG_A })).toBe(true);
  });

  it("grantsFromInactiveCustomRole matches SQL preference", () => {
    expect(grantsFromInactiveCustomRole({ is_system: false, is_active: false })).toBe(false);
    expect(grantsFromInactiveCustomRole({ is_system: true, is_active: false })).toBe(true);
  });
});

describe("multiple active roles union", () => {
  it("combines X + Y and does not subtract", () => {
    const a: RoleGrant = {
      roleCode: "custom_a",
      isExternal: false,
      organizationId: ORG_A,
      scopeType: "organization",
      scopeId: null,
      permissions: ["leave.view_self"],
    };
    const b: RoleGrant = {
      roleCode: "custom_b",
      isExternal: false,
      organizationId: ORG_A,
      scopeType: "organization",
      scopeId: null,
      permissions: ["attendance.view_self"],
    };
    const grants = [a, b];
    expect(evaluatePermission(grants, "leave.view_self", { organizationId: ORG_A })).toBe(true);
    expect(evaluatePermission(grants, "attendance.view_self", { organizationId: ORG_A })).toBe(true);
    expect(listGrantedPermissions(grants, { organizationId: ORG_A }).sort()).toEqual(
      unionPermissions([a.permissions, b.permissions]).sort(),
    );
  });
});

describe("catalog denylist and grouping", () => {
  it("every denylist key exists in the certified catalog", () => {
    for (const key of NON_DELEGABLE_PERMISSIONS) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });

  it("viewer TypeScript contract excludes role.read", () => {
    expect(ROLE_PERMISSION_MAP.viewer).not.toContain("role.read");
    expect(ROLE_PERMISSION_MAP.viewer).toEqual([
      "organization.read",
      "department.read",
      "project.read",
      "document.read",
      "notification.read",
    ]);
  });

  it("system roles may hold denylist keys; employee does not", () => {
    expect(ROLE_PERMISSION_MAP.super_admin).toContain("role.manage");
    expect(ROLE_PERMISSION_MAP.general_manager).toContain("role.manage");
    expect(ROLE_PERMISSION_MAP.hr_manager).not.toContain("role.manage");
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("role.manage");
    expect([...ROLE_PERMISSION_MAP.employee].sort()).toEqual([...EIGHT].sort());
  });

  it("groups actual catalog prefixes without inventing keys", () => {
    expect(permissionGroupForKey("attendance.view_self")).toBe("attendance");
    expect(permissionGroupForKey("leave.request")).toBe("leave");
    expect(groupPermissionKeys(["project.read", "leave.request"]).map((g) => g.id).sort()).toEqual(
      ["leave", "project"].sort(),
    );
  });
});

describe("migration 069 safety", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/069_organization_custom_roles.sql"), "utf8");
  const sql067 = readFileSync(join(process.cwd(), "supabase/migrations/067_base_employee_role.sql"), "utf8");
  const sql068 = readFileSync(join(process.cwd(), "supabase/migrations/068_job_titles.sql"), "utf8");

  it("is additive custom-role lifecycle without hard delete or 067/068 edits", () => {
    expect(sql).toContain("069");
    expect(sql).toContain("add column if not exists is_active");
    expect(sql).toContain("add column if not exists created_by");
    expect(sql).toContain("add column if not exists department_id");
    expect(sql).toContain("role.manage");
    expect(sql).toContain("create_organization_role");
    expect(sql).toContain("SYSTEM_ROLE_IMMUTABLE");
    expect(sql).toContain("current_user <> 'postgres'");
    expect(sql).toContain("current_user not like 'postgres.%'");
    expect(sql).toContain("revoke all on function public.system_role_ddl_allowed()");
    expect(sql).toContain("ROLE_PERMISSION_NOT_HELD");
    expect(sql).toContain("ROLE_PERMISSION_NON_DELEGABLE");
    expect(sql).toContain("r.is_system = true or r.is_active = true");
    expect(sql).toContain("Metadata only");
    expect(sql).not.toMatch(/drop table|truncate/i);
    expect(sql).not.toMatch(/delete from public\.user_roles/i);
    expect(sql).not.toMatch(/delete from public\.roles/i);
    expect(sql).toContain("delete from public.role_permissions where role_id = p_role_id");
    expect(sql).not.toContain("insert into public.user_roles");
    expect(sql).not.toMatch(/r\.code = 'employee'/);
    expect(sql).not.toMatch(/r\.code = 'hr_manager'/);
    expect(sql).not.toMatch(/raise exception '[^']+'[\s\S]{0,40}message\s*=/i);
  });

  it("does not rewrite 067 employee eight or 068 job titles", () => {
    for (const key of EIGHT) {
      expect(sql067).toContain(`'${key}'`);
    }
    expect(sql068).not.toContain("role.manage");
    expect(sql).not.toContain("job_titles");
  });

  it("forward-only viewer role.read removal; 013 untouched; no other viewer grants rewritten", () => {
    const sql013 = readFileSync(join(process.cwd(), "supabase/migrations/013_seed_system.sql"), "utf8");
    expect(sql013).toContain("where r.code = 'viewer'");
    expect(sql013).toContain("p.key like '%.read'");
    expect(sql).toMatch(
      /delete from public\.role_permissions rp\s+using public\.roles r\s+where rp\.role_id = r\.id\s+and r\.organization_id is null\s+and r\.is_system = true\s+and r\.code = 'viewer'\s+and rp\.permission_key = 'role\.read';/,
    );
    expect(sql).not.toContain("p.key like '%.read'");
    expect(sql.match(/r\.code = 'viewer'/g)?.length).toBe(1);
  });

  it("cannot mutate system roles through custom RPCs (static contract)", () => {
    expect(sql).toContain("if v_role.is_system or v_role.organization_id is null");
    expect(sql).toContain("grant execute on function public.create_organization_role");
    expect(sql).toContain("revoke all on function public.replace_custom_role_permissions");
  });

  it("custom-role RPCs write a single audit event per mutation; app actions do not double-log", () => {
    expect(sql.match(/perform public\.log_audit\([\s\S]*?'role\.created'/g)?.length).toBe(1);
    expect(sql.match(/perform public\.log_audit\([\s\S]*?'role\.updated'/g)?.length).toBe(1);
    expect(sql).not.toContain("role.permissions_changed");
    expect(sql).toContain("'role.deactivated'");
    expect(sql).toContain("'role.reactivated'");
    const rolesTs = readFileSync(join(process.cwd(), "src/server/use-cases/roles.ts"), "utf8");
    expect(rolesTs).not.toContain("AuditService");
    const platform = readFileSync(join(process.cwd(), "src/server/use-cases/platform.ts"), "utf8");
    expect(platform).toContain('action: "role.assigned"');
    expect(platform).toContain('action: "role.unassigned"');
    expect(platform.match(/action: "role\.assigned"/g)?.length).toBe(1);
    expect(platform.match(/action: "role\.unassigned"/g)?.length).toBe(1);
  });
});

describe("migration 070 execute hardening", () => {
  const sql070 = readFileSync(
    join(process.cwd(), "supabase/migrations/070_custom_role_rpc_execute_hardening.sql"),
    "utf8",
  );
  const sql069 = readFileSync(
    join(process.cwd(), "supabase/migrations/069_organization_custom_roles.sql"),
    "utf8",
  );

  it("is ACL-only and does not rewrite 069 or business data", () => {
    expect(sql070).toContain("070");
    expect(sql070).not.toMatch(/create or replace function/i);
    expect(sql070).not.toMatch(/insert into|update public\.|delete from public\./i);
    expect(sql070).not.toMatch(/drop table|truncate|drop column/i);
    expect(sql070).not.toContain("role.manage");
    expect(sql070).not.toContain("job_titles");
    expect(sql070).not.toMatch(/r\.code = 'employee'/);
    expect(sql070).not.toMatch(/r\.code = 'viewer'/);
    expect(sql069).toContain("add column if not exists is_active");
  });

  it("revokes internal helpers from public, anon, authenticated, and service_role", () => {
    const helpers = [
      "public.assert_can_manage_custom_roles(uuid)",
      "public.assert_custom_role_permission_set(uuid, text[])",
      "public.replace_custom_role_permissions(uuid, text[])",
      "public.current_effective_permission_keys(uuid)",
      "public.non_delegable_permission_keys()",
      "public.normalize_custom_role_code(text, text)",
      "public.system_role_ddl_allowed()",
      "public.roles_custom_org_guard()",
      "public.roles_protect_system()",
      "public.role_permissions_protect_system()",
    ];
    for (const sig of helpers) {
      expect(sql070).toMatch(
        new RegExp(
          `revoke all on function ${sig.replace(/[()[\]]/g, "\\$&")}\\s+from public, anon, authenticated, service_role;`,
        ),
      );
    }
  });

  it("allows authenticated execute on public mutation RPCs and denies anon", () => {
    const rpcs = [
      "public.create_organization_role(uuid, text, text, text, uuid, text[])",
      "public.update_organization_role(uuid, uuid, text, text, uuid, text[])",
      "public.set_organization_role_active(uuid, uuid, boolean)",
    ];
    for (const sig of rpcs) {
      expect(sql070).toContain(`revoke all on function ${sig}`);
      expect(sql070).toContain(`grant execute on function ${sig}`);
    }
    expect(sql070).toContain("070_RPC_ANON_EXECUTE");
    expect(sql070).toContain("070_RPC_AUTHENTICATED_MISSING");
    expect(sql070).toContain("070_OWNER_HELPER_EXECUTE_MISSING");
    expect(sql070).toContain("070_HELPER_EXECUTE_EXPOSED");
    expect(sql070).toContain("070_ASSERT_EXECUTE_EXPOSED");
  });

  it("keeps has_permission executable by authenticated and not by anon", () => {
    expect(sql070).toContain(
      "revoke all on function public.has_permission(text, uuid, public.role_scope_type, uuid)",
    );
    expect(sql070).toContain(
      "grant execute on function public.has_permission(text, uuid, public.role_scope_type, uuid)",
    );
    expect(sql070).toContain("070_HAS_PERMISSION_ACL");
    expect(sql070).not.toMatch(/has_permission[\s\S]{0,220}from public, anon, authenticated, service_role/);
  });

  it("does not weaken system-role DDL bypass semantics", () => {
    expect(sql070).not.toContain("allow_system_role_ddl");
    expect(sql069).toContain("current_user <> 'postgres'");
    expect(sql070).toContain("070_DDL_BYPASS_EXECUTE_EXPOSED");
  });
});
