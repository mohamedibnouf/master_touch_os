export const PRIVILEGED_ROLE_CODES = ["super_admin", "general_manager"] as const;

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
