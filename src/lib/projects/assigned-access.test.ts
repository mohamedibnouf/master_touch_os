import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BASE_EMPLOYEE_PERMISSIONS } from "@/lib/permissions/catalog";
import { employeeRoleLacksCatalogProjectRead, hasCatalogProjectRead } from "./assigned-access";
import { workflowStageFocusId } from "@/lib/notifications/workflow-stage-focus";
import { resolveNotificationHref, workflowStageHref } from "@/lib/notifications/href";
import type { RoleGrant } from "@/lib/permissions/evaluate";

const ORG = "11111111-1111-1111-1111-111111111111";
const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const STEP = "f12521e3-1a80-4a94-b653-f1161646ae61";
const ALI = "e4a8c349-120a-4494-ab4a-95b6c861639a";

function grant(permissions: RoleGrant["permissions"], extras?: Partial<RoleGrant>): RoleGrant {
  return {
    roleCode: extras?.roleCode ?? "employee",
    isExternal: extras?.isExternal ?? false,
    organizationId: extras?.organizationId ?? ORG,
    scopeType: extras?.scopeType ?? "organization",
    scopeId: extras?.scopeId ?? null,
    permissions,
  };
}

describe("assigned project route access (P1–P14)", () => {
  it("P5 P6: employee catalog has no project.read; auth/profile mapping is uid=profile", () => {
    expect(employeeRoleLacksCatalogProjectRead()).toBe(true);
    expect(BASE_EMPLOYEE_PERMISSIONS).not.toContain("project.read");
    const canAccess = readFileSync("supabase/migrations/026_phase2_rls.sql", "utf8");
    expect(canAccess).toMatch(/pm.profile_id = auth.uid\(\)/);
    expect(canAccess).toMatch(/pr.project_manager_id = auth.uid\(\)/);
  });

  it("P1 P3: catalog project.read is not required for assigned members", () => {
    expect(hasCatalogProjectRead([grant(BASE_EMPLOYEE_PERMISSIONS)], ORG, PROJECT)).toBe(false);
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).toMatch(/if \(!ctx\) redirect\("\/login"\)/);
    expect(page).not.toMatch(/hasPermission\(ctx, "project.read"\)\) redirect/);
    expect(page).toMatch(/getProject\(ctx.organization.id, id\)/);
    expect(page).toMatch(/PROJECT_ROUTE_PROJECT_NOT_VISIBLE/);
  });

  it("P2 P4 P10: invisible projects stay notFound; unrelated users are not granted catalog read", () => {
    const outsider = [grant(BASE_EMPLOYEE_PERMISSIONS, { organizationId: "22222222-2222-2222-2222-222222222222" })];
    expect(hasCatalogProjectRead(outsider, ORG, PROJECT)).toBe(false);
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).toMatch(/if \(!project\)/);
    expect(page).toMatch(/notFound\(\)/);
    const sql = readFileSync("supabase/migrations/026_phase2_rls.sql", "utf8");
    expect(sql).toMatch(/can_access_project/);
  });

  it("P7 P11: org context is membership-resolved; authorized members are not sent to Home", () => {
    const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
    expect(layout).toMatch(/if \(!ctx\)/);
    expect(layout).toMatch(/redirect\("\/login"\)/);
    expect(layout).not.toMatch(/redirect\("\/"\)/);
    const list = readFileSync("src/app/(app)/projects/page.tsx", "utf8");
    expect(list).not.toMatch(/redirect\("\/"\)/);
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).not.toMatch(/redirect\("\/"\)/);
    const mw = readFileSync("src/lib/supabase/middleware.ts", "utf8");
    expect(mw).toMatch(/pathname === "\/login"/);
    expect(mw).toMatch(/url.pathname = "\/"/);
  });

  it("P8 P9: stages query params remain on the project page", () => {
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).toMatch(/tab = "overview"/);
    expect(page).toMatch(/stage: stageParam/);
    expect(page).toMatch(/workflowStageFocusId/);
    expect(workflowStageFocusId([STEP], STEP, STEP)).toBe(STEP);
    expect(workflowStageFocusId([STEP], STEP, "not-a-uuid")).toBe(STEP);
  });

  it("P12: notification href is the assigned project stages route", () => {
    expect(
      resolveNotificationHref({
        type: "workflow.step.activated",
        entityType: "project",
        entityId: PROJECT,
        storedHref: `/projects/${PROJECT}?tab=stages`,
        dedupKey: `workflow.step.activated:${STEP}:${ALI}`,
      }),
    ).toBe(workflowStageHref(PROJECT, STEP));
  });

  it("P13 P14: this change does not complete Stage 05 or activate Stage 06", () => {
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).not.toMatch(/completeWorkflowStep/);
    expect(page).not.toMatch(/start_workflow/);
    const detail = readFileSync("src/lib/projects/assigned-access.ts", "utf8");
    expect(detail).not.toMatch(/completeWorkflow/);
  });
});
