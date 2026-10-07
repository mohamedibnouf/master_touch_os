import { BASE_EMPLOYEE_PERMISSIONS } from "@/lib/permissions/catalog";
import { can, type RoleGrant } from "@/lib/permissions/evaluate";

/** Org catalog project.read is for ops/management. Assigned members use RLS. */
export function hasCatalogProjectRead(
  grants: readonly RoleGrant[],
  organizationId: string,
  projectId?: string | null,
): boolean {
  const context = { organizationId, projectId: projectId ?? null };
  return can(grants, "project.read", context) || can(grants, "project.read_all", context);
}

export function employeeRoleLacksCatalogProjectRead(): boolean {
  return !BASE_EMPLOYEE_PERMISSIONS.includes("project.read")
    && !BASE_EMPLOYEE_PERMISSIONS.includes("project.read_all");
}
