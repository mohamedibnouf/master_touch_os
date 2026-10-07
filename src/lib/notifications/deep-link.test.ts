import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isPostgresUuid } from "@/lib/postgres-uuid";
import { safeNotificationHref } from "@/modules/notifications/safety";
import { buildNotificationEmailHref } from "@/modules/notifications/app-url";
import {
  isActionableNotificationType,
  notificationEntityHref,
  resolveNotificationHref,
  workflowActivationStepIdFromDedup,
  workflowStageHref,
} from "./href";
import { notificationTapDestination } from "./tap";
import { workflowStageFocusId } from "./workflow-stage-focus";

const PROJECT_ID = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const STEP_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID = "e4a8c349-0000-0000-0000-000000000001";

describe("workflow notification deep-link (N1–N14)", () => {
  it("N1 N2 N3: activation href uses project stages and instance step id", () => {
    const href = workflowStageHref(PROJECT_ID, STEP_ID);
    expect(href).toBe(`/projects/${PROJECT_ID}?tab=stages&stage=${STEP_ID}`);
    expect(href).toContain(PROJECT_ID);
    expect(href).toContain(STEP_ID);
    const worker = readFileSync("src/server/services/notification-delivery-worker.ts", "utf8");
    expect(worker).toMatch(/workflowStageHref\(input\.projectId, row\.id\)/);
    expect(worker).toMatch(/type: "workflow\.step\.activated"/);
  });

  it("N4 N11: tap uses the resolved href; header is not details", () => {
    const dest = notificationTapDestination(
      `/projects/${PROJECT_ID}?tab=stages&stage=${STEP_ID}`,
      true,
    );
    expect(dest).toBe(`/projects/${PROJECT_ID}?tab=stages&stage=${STEP_ID}`);
    const header = readFileSync("src/components/layout/header-notifications.tsx", "utf8");
    expect(header).not.toMatch(/<details/);
    expect(header).toMatch(/NotificationNavLink/);
    const nav = readFileSync("src/components/notifications/notification-nav-link.tsx", "utf8");
    expect(nav).toMatch(/href=\{plan\.href\}/);
    expect(nav).toMatch(/<a/);
    expect(nav).not.toMatch(/markNotificationReadAction/);
    expect(nav).toMatch(/markNotificationReadBestEffort/);
    const owned = readFileSync("src/server/use-cases/notification-read.ts", "utf8");
    expect(owned).toMatch(/eq\("recipient_profile_id", ctx\.userId\)/);
    const markSrc = readFileSync("src/server/use-cases/platform.ts", "utf8");
    const markFn = markSrc.slice(
      markSrc.indexOf("export async function markNotificationReadAction"),
      markSrc.indexOf("export async function createUserAction"),
    );
    expect(markFn).not.toMatch(/revalidatePath\("\/"\)/);
    const home = readFileSync("src/components/home/home-ops-panels.tsx", "utf8");
    expect(home).toMatch(/resolveNotificationHref/);
    expect(home).toMatch(/NotificationNavLink/);
  });

  it("N5 N6: mark-read outcome does not change or invent navigation", () => {
    const href = `/projects/${PROJECT_ID}?tab=stages`;
    expect(notificationTapDestination(href, true)).toBe(href);
    expect(notificationTapDestination(href, false)).toBe(href);
    expect(notificationTapDestination(null, false)).toBeNull();
    expect(notificationTapDestination("https://evil.test", true)).toBeNull();
  });

  it("N7 N8: rejects arbitrary external and javascript hrefs", () => {
    expect(safeNotificationHref("https://evil.test/phish")).toBeNull();
    expect(safeNotificationHref("//evil.test")).toBeNull();
    expect(safeNotificationHref("javascript:alert(1)")).toBeNull();
    expect(safeNotificationHref("/projects/x?tab=javascript:alert(1)")).toBeNull();
    expect(
      resolveNotificationHref({
        type: "workflow.step.activated",
        entityType: "project",
        entityId: PROJECT_ID,
        storedHref: "https://evil.test",
        dedupKey: `workflow.step.activated:${STEP_ID}:${USER_ID}`,
      }),
    ).toBe(`/projects/${PROJECT_ID}?tab=stages&stage=${STEP_ID}`);
  });

  it("N9: project page still notFound when getProject misses; href is not authorization", () => {
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).toMatch(/if \(!project\) notFound\(\)/);
    expect(page).toMatch(/hasPermission\(ctx, "project.read"\)/);
    expect(page).toMatch(/workflowStageFocusId/);
  });

  it("N10: stages tab honors stage query for a member-visible node", () => {
    expect(workflowStageFocusId([STEP_ID, "other"], STEP_ID, STEP_ID)).toBe(STEP_ID);
    expect(isPostgresUuid(PROJECT_ID)).toBe(true);
  });

  it("N12: approval notifications keep /approvals or project stages", () => {
    expect(
      resolveNotificationHref({
        type: "approval.created",
        entityType: "approval_request",
        entityId: STEP_ID,
        storedHref: "/approvals",
      }),
    ).toBe("/approvals");
    expect(
      resolveNotificationHref({
        type: "approval.created",
        entityType: "approval_request",
        entityId: STEP_ID,
        storedHref: `/projects/${PROJECT_ID}?tab=stages`,
      }),
    ).toBe(`/projects/${PROJECT_ID}?tab=stages`);
    expect(notificationEntityHref("approval_request", STEP_ID)).toBe("/approvals");
    expect(isActionableNotificationType("approval.created")).toBe(true);
  });

  it("N13: informational types without href stay null", () => {
    expect(isActionableNotificationType("digest.daily")).toBe(false);
    expect(
      resolveNotificationHref({
        type: "digest.daily",
        entityType: null,
        entityId: null,
        storedHref: null,
      }),
    ).toBeNull();
    expect(notificationTapDestination(null, true)).toBeNull();
  });

  it("N14: email CTA uses the same canonical stages path", () => {
    const base = new URL("https://app.mastertouch-ksa.com");
    const path = workflowStageHref(PROJECT_ID, STEP_ID);
    expect(buildNotificationEmailHref(base, path)).toBe(`https://app.mastertouch-ksa.com${path}`);
    expect(buildNotificationEmailHref(base, "https://evil.test")).toBe("https://app.mastertouch-ksa.com/");
  });

  it("rebuilds stages href from stored project metadata when UI previously dropped the query", () => {
    expect(
      resolveNotificationHref({
        type: "workflow.step.activated",
        entityType: "project",
        entityId: PROJECT_ID,
        storedHref: `/projects/${PROJECT_ID}`,
        dedupKey: `workflow.step.activated:${STEP_ID}:${USER_ID}`,
      }),
    ).toBe(`/projects/${PROJECT_ID}?tab=stages&stage=${STEP_ID}`);
    expect(workflowActivationStepIdFromDedup(`workflow.step.activated:${STEP_ID}:${USER_ID}`)).toBe(STEP_ID);
  });
});
