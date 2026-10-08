import type { Employee, Organization, Profile } from "@/types/models";
import type { MembershipStatus } from "@/types/enums";
import { mapUserRoleRowsToGrants, type AuthUserRoleRow } from "@/lib/auth/auth-grants";

export type AuthMembershipEmbed = {
  organization_id: string;
  status: MembershipStatus;
  joined_at: string | null;
  organizations: Organization | Organization[] | null;
};

export type ResolvedAuthIdentity = {
  profile: Profile;
  organization: Organization;
  employee: Employee | null;
  membershipStatus: MembershipStatus;
  grants: ReturnType<typeof mapUserRoleRowsToGrants>;
};

function asOrg(value: Organization | Organization[] | null | undefined): Organization | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Pure mapping of the auth embed. Request-scoped only — callers must not cache across users. */
export function resolveAuthFromBundle(input: {
  profile: Profile;
  memberships: AuthMembershipEmbed[] | null | undefined;
  employees: Employee[] | Employee | null | undefined;
  roleRows: AuthUserRoleRow[] | null | undefined;
}): ResolvedAuthIdentity | null {
  const memberships = [...(input.memberships ?? [])]
    .filter((row) => row.status === "active")
    .sort((a, b) => String(a.joined_at ?? "").localeCompare(String(b.joined_at ?? "")));
  const membership = memberships[0];
  const organization = asOrg(membership?.organizations);
  if (!membership || !organization) return null;

  const employeeRows = Array.isArray(input.employees)
    ? input.employees
    : input.employees
      ? [input.employees]
      : [];
  const employee = employeeRows.find((row) => row.organization_id === organization.id) ?? null;

  const roleRows = (input.roleRows ?? []).filter((row) => row.organization_id === organization.id);
  const grants = mapUserRoleRowsToGrants(roleRows);

  return {
    profile: input.profile,
    organization,
    employee,
    membershipStatus: membership.status,
    grants,
  };
}
