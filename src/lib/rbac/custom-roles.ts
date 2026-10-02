import {
  isNonDelegablePermission,
  isPermissionKey,
  SYSTEM_ROLES,
  type PermissionKey,
} from "@/lib/permissions/catalog";
import { isOperationalAssignableRole, isPrivilegedRoleCode } from "@/lib/hr/roles";

export type AssignableRoleRow = {
  id: string;
  code?: string | null;
  name_ar: string;
  name_en?: string | null;
  is_system?: boolean;
  is_external?: boolean;
  is_active?: boolean;
  organization_id?: string | null;
};

export function normalizeCustomRoleCode(code: string | undefined, nameEn: string): string | null {
  const raw = (code ?? "").trim() || nameEn;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || null;
}

export function isReservedSystemRoleCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return (SYSTEM_ROLES as readonly string[]).includes(code.toLowerCase());
}

export function assertDelegablePermissionSet(input: {
  requested: string[];
  actorHolds: readonly string[];
}): { ok: true; keys: PermissionKey[] } | { ok: false; reason: "empty" | "unknown" | "non_delegable" | "not_held" } {
  const unique = [...new Set(input.requested.map((key) => key.trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, reason: "empty" };
  const held = new Set(input.actorHolds);
  const keys: PermissionKey[] = [];
  for (const key of unique) {
    if (!isPermissionKey(key)) return { ok: false, reason: "unknown" };
    if (isNonDelegablePermission(key)) return { ok: false, reason: "non_delegable" };
    if (!held.has(key)) return { ok: false, reason: "not_held" };
    keys.push(key);
  }
  return { ok: true, keys };
}

export function delegablePermissionKeysForActor(actorHolds: readonly PermissionKey[]): PermissionKey[] {
  return actorHolds.filter((key) => !isNonDelegablePermission(key));
}

export function isActiveCustomRole(role: AssignableRoleRow, organizationId: string): boolean {
  return (
    role.is_system === false &&
    role.is_active === true &&
    role.organization_id === organizationId &&
    role.is_external !== true
  );
}

export function isAssignableToUser(role: AssignableRoleRow, input: {
  organizationId: string;
  allowPrivileged: boolean;
}): boolean {
  if (role.is_external) return false;
  if (!isOperationalAssignableRole({
    code: role.code,
    is_external: role.is_external,
    allowPrivileged: input.allowPrivileged,
  })) {
    return false;
  }
  if (role.is_system) return true;
  return isActiveCustomRole(role, input.organizationId);
}

export function grantsFromInactiveCustomRole(role: {
  is_system?: boolean;
  is_active?: boolean;
}): boolean {
  if (role.is_system === true) return true;
  if (role.is_active === false) return false;
  return true;
}

export function unionPermissions(sets: readonly (readonly PermissionKey[])[]): PermissionKey[] {
  const keys = new Set<PermissionKey>();
  for (const set of sets) {
    for (const key of set) keys.add(key);
  }
  return [...keys];
}

export function assignmentRejectReason(input: {
  role: {
    code?: string | null;
    is_external?: boolean;
    is_system?: boolean;
    is_active?: boolean;
    organization_id?: string | null;
  } | null;
  organizationId: string;
  allowPrivileged: boolean;
}): "missing" | "external" | "privileged" | "inactive" | "cross_org" | null {
  if (!input.role) return "missing";
  if (input.role.is_external) return "external";
  if (isPrivilegedRoleCode(input.role.code) && !input.allowPrivileged) {
    return "privileged";
  }
  const isCustom = input.role.is_system === false || Boolean(input.role.organization_id);
  if (isCustom) {
    if (input.role.organization_id !== input.organizationId) return "cross_org";
    if (input.role.is_active === false) return "inactive";
  }
  return null;
}

export function canUnassignUserRole(input: {
  actorIsPlatformAdmin: boolean;
  targetRoleCode: string | null | undefined;
  remainingRoleCount: number;
}): { ok: true } | { ok: false; reason: "privileged" | "last_role" } {
  if (input.remainingRoleCount <= 1) return { ok: false, reason: "last_role" };
  if (
    (input.targetRoleCode === "super_admin" || input.targetRoleCode === "general_manager") &&
    !input.actorIsPlatformAdmin
  ) {
    return { ok: false, reason: "privileged" };
  }
  return { ok: true };
}

