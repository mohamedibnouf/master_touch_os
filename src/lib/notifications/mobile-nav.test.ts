import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { safeNotificationHref } from "@/modules/notifications/safety";
import { buildNotificationEmailHref } from "@/modules/notifications/app-url";
import { notificationEntityHref, resolveNotificationHref, workflowStageHref } from "./href";
import {
  markNotificationReadBestEffort,
  NOTIFICATION_READ_PATH,
  parseNotificationReadId,
  planActionableNotificationTap,
  notificationTapDestination,
} from "./tap";
import { workflowStageFocusId } from "./workflow-stage-focus";

const PROJECT_ID = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const STEP_ID = "f12521e3-1a80-4a94-b653-f1161646ae61";
const USER_ID = "e4a8c349-0000-0000-0000-000000000001";
const STAGE_HREF = `/projects/${PROJECT_ID}?tab=stages&stage=${STEP_ID}`;

describe("notification mobile navigation v2 (R1–R15)", () => {
  it("R1: Stage 05 resolver and header mapping emit the stages+stage href", () => {
    expect(
      resolveNotificationHref({
        type: "workflow.step.activated",
        entityType: "project",
        entityId: PROJECT_ID,
        storedHref: `/projects/${PROJECT_ID}?tab=stages`,
        dedupKey: `workflow.step.activated:${STEP_ID}:${USER_ID}`,
      }),
    ).toBe(STAGE_HREF);
    const repo = readFileSync("src/server/repositories/core.repository.ts", "utf8");
    expect(repo).toMatch(/resolveNotificationHref/);
    const nav = readFileSync("src/components/notifications/notification-nav-link.tsx", "utf8");
    expect(nav).toMatch(/href=\{plan\.href\}/);
    expect(nav).toMatch(/data-notification-href=\{plan\.href\}/);
  });

  it("R2 R7 R11: actionable tap uses a real anchor and does not preventDefault", () => {
    const plan = planActionableNotificationTap({ href: STAGE_HREF, unread: true });
    expect(plan.href).toBe(STAGE_HREF);
    expect(plan.preventDefault).toBe(false);
    const nav = readFileSync("src/components/notifications/notification-nav-link.tsx", "utf8");
    expect(nav).toMatch(/<a/);
    expect(nav).not.toMatch(/from "next\/link"/);
    expect(nav).not.toMatch(/preventDefault/);
    expect(nav).not.toMatch(/stopPropagation/);
    expect(nav).not.toMatch(/onTouchStart/);
    expect(nav).not.toMatch(/onPointerDown/);
  });

  it("R3 R4 R5: mark-read is fire-and-forget fetch, never awaited, never a server action", () => {
    const plan = planActionableNotificationTap({ href: STAGE_HREF, unread: true });
    expect(plan.markRead).toBe(true);
    expect(plan.awaitMarkRead).toBe(false);
    expect(plan.usesServerAction).toBe(false);
    const nav = readFileSync("src/components/notifications/notification-nav-link.tsx", "utf8");
    expect(nav).toMatch(/markNotificationReadBestEffort\(id\)/);
    expect(nav).not.toMatch(/await markNotificationRead/);
    expect(nav).not.toMatch(/markNotificationReadAction/);
    const tap = readFileSync("src/lib/notifications/tap.ts", "utf8");
    expect(tap).toMatch(/keepalive: true/);
    expect(tap).toMatch(/NOTIFICATION_READ_PATH/);
    expect(tap).toMatch(/\.catch\(\(\) => undefined\)/);
    expect(notificationTapDestination(STAGE_HREF, false)).toBe(STAGE_HREF);
  });

  it("R6: header popover close is not bound to the item tap", () => {
    const header = readFileSync("src/components/layout/header-notifications.tsx", "utf8");
    expect(header).not.toMatch(/<details/);
    expect(header).not.toMatch(/role="dialog"/);
    const itemBlock = header.slice(header.indexOf("{items.map"), header.indexOf("<Link"));
    expect(itemBlock).not.toMatch(/setOpen\(false\)/);
    expect(itemBlock).not.toMatch(/preventDefault/);
  });

  it("R8: unsafe href is not navigated", () => {
    expect(planActionableNotificationTap({ href: "javascript:alert(1)", unread: true }).href).toBeNull();
    expect(planActionableNotificationTap({ href: "https://evil.test", unread: true }).href).toBeNull();
    expect(planActionableNotificationTap({ href: "//evil.test", unread: true }).href).toBeNull();
    expect(safeNotificationHref("javascript:alert(1)")).toBeNull();
  });

  it("R9: project stages URL is not rewritten to Home", () => {
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).toMatch(/if \(!ctx\) redirect\("\/login"\)/);
    expect(page).not.toMatch(/hasPermission\(ctx, "project.read"\)\) redirect/);
    expect(page).toMatch(/if \(!project\) \{/);
    expect(page).toMatch(/notFound\(\)/);
    expect(page).not.toMatch(/redirect\("\/"\)/);
    const mw = readFileSync("src/lib/supabase/middleware.ts", "utf8");
    expect(mw).toMatch(/url.pathname = "\/login"/);
  });

  it("R10: unknown stage falls back to the current node", () => {
    expect(workflowStageFocusId([STEP_ID], STEP_ID, "00000000-0000-0000-0000-000000000000")).toBe(STEP_ID);
    expect(workflowStageFocusId([STEP_ID], STEP_ID, "not-a-uuid")).toBe(STEP_ID);
    expect(workflowStageFocusId([STEP_ID], STEP_ID, STEP_ID)).toBe(STEP_ID);
  });

  it("R12: mark-read paths do not revalidate or redirect Home", () => {
    const api = readFileSync("src/app/api/notifications/read/route.ts", "utf8");
    expect(api).not.toMatch(/revalidatePath/);
    expect(api).not.toMatch(/redirect\(/);
    expect(api).toMatch(/markOwnedNotificationRead/);
    const owned = readFileSync("src/server/use-cases/notification-read.ts", "utf8");
    expect(owned).toMatch(/eq\("recipient_profile_id", ctx\.userId\)/);
    expect(owned).not.toMatch(/revalidatePath/);
    const markSrc = readFileSync("src/server/use-cases/platform.ts", "utf8");
    const markFn = markSrc.slice(
      markSrc.indexOf("export async function markNotificationReadAction"),
      markSrc.indexOf("export async function createUserAction"),
    );
    expect(markFn).not.toMatch(/revalidatePath\("\/"\)/);
    expect(markFn).not.toMatch(/redirect\("\/"\)/);
    expect(markFn).toMatch(/revalidatePath\("\/notifications"\)/);
  });

  it("R13: informational notification without href remains non-actionable", () => {
    const plan = planActionableNotificationTap({ href: null, unread: true });
    expect(plan.href).toBeNull();
    expect(plan.markRead).toBe(false);
  });

  it("R14: approval notification navigation still works", () => {
    expect(
      planActionableNotificationTap({
        href: resolveNotificationHref({
          type: "approval.created",
          entityType: "approval_request",
          entityId: STEP_ID,
          storedHref: "/approvals",
        }),
        unread: true,
      }).href,
    ).toBe("/approvals");
    expect(notificationEntityHref("approval_request", STEP_ID)).toBe("/approvals");
  });

  it("R15: workflow activation email href remains the canonical stages path", () => {
    const base = new URL("https://app.mastertouch-ksa.com");
    const path = workflowStageHref(PROJECT_ID, STEP_ID);
    expect(path).toBe(STAGE_HREF);
    expect(buildNotificationEmailHref(base, path)).toBe(`https://app.mastertouch-ksa.com${STAGE_HREF}`);
  });

  it("rejects non-uuid mark-read bodies", () => {
    expect(parseNotificationReadId({ id: STEP_ID })).toBe(STEP_ID);
    expect(parseNotificationReadId({ id: "nope" })).toBeNull();
    expect(NOTIFICATION_READ_PATH).toBe("/api/notifications/read");
    expect(typeof markNotificationReadBestEffort).toBe("function");
  });
});
