/**
 * Phase 5.6 E2E — hub DB scenarios are blocked until 062 is applied.
 * Always covers preferences/digest/push UX routes that degrade without 062.
 */
import { test, expect } from "@playwright/test";
import {
  adminClient,
  expectPageMarker,
  gotoApp,
  ORG_ID,
  requireData,
  signInViaUI,
} from "./helpers";

const ENABLED = process.env.LIVE_TEST_ENABLED === "true" || process.env.LIVE_TEST_ENABLED === "1";

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

test.describe("Phase 5.6 notification hub UX", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");
  test.setTimeout(240_000);

  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    const admin = adminClient();
    const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
    const runSuffix = Date.now().toString(36);
    const email = `e2e56-${runSuffix}@test.local`;
    const password = `${prefix}HUB`;
    const role = await requireData(
      admin.from("roles").select("id").eq("code", "general_manager").is("organization_id", null).single(),
      "role gm",
    );
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: "تجربة تنبيه", full_name_en: "Hub", locale: "ar" },
    });
    if (error || !data.user) throw new Error(error?.message ?? "user");
    await requireData(
      admin
        .from("organization_members")
        .insert({ organization_id: ORG_ID, profile_id: data.user.id, status: "active" })
        .select("profile_id")
        .single(),
      "member",
    );
    await requireData(
      admin
        .from("user_roles")
        .insert({
          organization_id: ORG_ID,
          profile_id: data.user.id,
          role_id: role.id,
          scope_type: "organization",
        })
        .select("id")
        .single(),
      "role",
    );
    user = { email, password, userId: data.user.id };
  });

  test.afterAll(async () => {
    if (!user) return;
    try {
      await adminClient().auth.admin.deleteUser(user.userId);
    } catch {
      /* best-effort */
    }
  });

  test("notifications, preferences, digest, push control, no salary in copy", async ({ page }) => {
    await signInViaUI(page, user.email, user.password, "تجربة تنبيه");
    await gotoApp(page, "/notifications");
    await expectPageMarker(page, "notifications-page");
    await expect(page.locator("body")).not.toContainText(/IBAN|صافي الراتب/i);

    await gotoApp(page, "/notifications/preferences");
    await expectPageMarker(page, "notification-preferences");
    await expect(page.getByTestId("push-opt-in")).toBeVisible();

    await gotoApp(page, "/management/digest");
    await expectPageMarker(page, "management-digest");
  });

  test("viewports — notifications + preferences", async ({ page }) => {
    test.setTimeout(180_000);
    await signInViaUI(page, user.email, user.password, "تجربة تنبيه");
    const routes = ["/notifications", "/notifications/preferences"];
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of routes) {
        await gotoApp(page, route);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} @ ${vp.name}`).toBeLessThanOrEqual(1);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, "/management/digest");
    await expectPageMarker(page, "management-digest");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "/management/digest @ 390x844").toBeLessThanOrEqual(1);
  });

  test("blocked: multi-channel delivery/reminder/escalation DB E2E until 062", async () => {
    const { error } = await adminClient().from("notification_preferences").select("id").limit(1);
    test.skip(Boolean(error), "062 unapplied — do not fake delivery/preference/push DB E2E");
  });
});
