import { describe, expect, it } from "vitest";
import { resolveAuthFromBundle } from "./resolve-auth-bundle";
import type { Employee, Organization, Profile } from "@/types/models";
import type { AuthUserRoleRow } from "@/lib/auth/auth-grants";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";

const profile = (active = true): Profile => ({
  id: "user-1",
  full_name_ar: "أ",
  full_name_en: "A",
  phone: null,
  locale: "ar",
  is_active: active,
  is_platform_admin: false,
  avatar_path: null,
  last_seen_at: null,
  created_at: "",
  updated_at: "",
});

const org = (id: string): Organization => ({
  id,
  name_ar: "منظمة",
  name_en: "Org",
  legal_name: null,
  commercial_registration: null,
  vat_number: null,
  logo_path: null,
  country: "SA",
  timezone: "Asia/Riyadh",
  default_currency: "SAR",
  status: "active",
  created_at: "",
  updated_at: "",
});

const employee = (organizationId: string, active: boolean): Employee =>
  ({
    id: `e-${organizationId}`,
    organization_id: organizationId,
    profile_id: "user-1",
    employee_number: "1",
    is_active: active,
  }) as Employee;

const role = (organizationId: string, permission: string): AuthUserRoleRow => ({
  organization_id: organizationId,
  scope_type: "organization",
  scope_id: null,
  roles: {
    code: "employee",
    is_external: false,
    is_system: true,
    is_active: true,
    role_permissions: [{ permission_key: permission }],
  },
});

describe("resolveAuthFromBundle", () => {
  it("rejects revoked / inactive membership", () => {
    expect(
      resolveAuthFromBundle({
        profile: profile(),
        memberships: [{ organization_id: ORG_A, status: "removed", joined_at: "2020-01-01", organizations: org(ORG_A) }],
        employees: [],
        roleRows: [role(ORG_A, "project.read")],
      }),
    ).toBeNull();
  });

  it("does not attach another organization's employee or permissions", () => {
    const resolved = resolveAuthFromBundle({
      profile: profile(),
      memberships: [{ organization_id: ORG_A, status: "active", joined_at: "2020-01-01", organizations: org(ORG_A) }],
      employees: [employee(ORG_B, false)],
      roleRows: [role(ORG_B, "payroll.approve"), role(ORG_A, "leave.view_self")],
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.organization.id).toBe(ORG_A);
    expect(resolved?.employee).toBeNull();
    expect(resolved?.grants.every((g) => g.organizationId === ORG_A)).toBe(true);
    expect(resolved?.grants.flatMap((g) => g.permissions)).toEqual(["leave.view_self"]);
  });

  it("keeps same-org inactive employee on the identity so the interactive gate can block", () => {
    const resolved = resolveAuthFromBundle({
      profile: profile(),
      memberships: [{ organization_id: ORG_A, status: "active", joined_at: "2020-01-01", organizations: org(ORG_A) }],
      employees: [employee(ORG_A, false)],
      roleRows: [role(ORG_A, "leave.view_self")],
    });
    expect(resolved?.employee?.is_active).toBe(false);
  });
});
