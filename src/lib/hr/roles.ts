export const PRIVILEGED_ROLE_CODES = ["super_admin", "general_manager"] as const;

export const BASE_EMPLOYEE_ROLE_CODE = "employee" as const;

export function isPrivilegedRoleCode(code: string | null | undefined): boolean {
  return Boolean(code && (PRIVILEGED_ROLE_CODES as readonly string[]).includes(code));
}

export function isOperationalAssignableRole(input: {
  code?: string | null;
  is_external?: boolean;
  allowPrivileged: boolean;
}): boolean {
  if (input.is_external) return false;
  if (isPrivilegedRoleCode(input.code) && !input.allowPrivileged) return false;
  return true;
}

export type CreateEmployeeRolePlan =
  | { mode: "none" }
  | { mode: "selected"; roleId: string }
  | { mode: "default_employee" };

/** Login provisioned + empty role_id → base employee. Never trusts a client-supplied role code. */
export function resolveCreateEmployeeRolePlan(input: {
  selectedRoleId: string | undefined;
  loginProvisioned: boolean;
}): CreateEmployeeRolePlan {
  if (input.selectedRoleId) return { mode: "selected", roleId: input.selectedRoleId };
  if (input.loginProvisioned) return { mode: "default_employee" };
  return { mode: "none" };
}

export function isTrustedBaseEmployeeRole(row: {
  id: string;
  code: string;
  is_external: boolean;
} | null): row is { id: string; code: typeof BASE_EMPLOYEE_ROLE_CODE; is_external: false } {
  return Boolean(row && row.code === BASE_EMPLOYEE_ROLE_CODE && row.is_external === false && row.id);
}
