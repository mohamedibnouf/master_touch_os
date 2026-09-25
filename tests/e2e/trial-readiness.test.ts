/**
 * Phase 5.5.1 — trial-critical smoke (login, home, attendance, leave, notifications, overflow).
 * Requires LIVE_TEST_ENABLED. Does not start Phase 5.6.
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

test.describe("Phase 5.5.1 trial readiness", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");
  test.setTimeout(240_000);

  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    const admin = adminClient();
    const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
    const runSuffix = Date.now().toString(36);
    const email = `e2e551-${runSuffix}@test.local`;
    const password = `${prefix}EMP`;
    const role = await requireData(
      admin.from("roles").select("id").eq("code", "engineer").is("organization_id", null).single(),
      "role engineer",
    );
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: "تجربة موظف", full_name_en: "Trial Emp", locale: "ar" },
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
      "role assign",
    );
    await requireData(
      admin
        .from("employees")
        .insert({
          organization_id: ORG_ID,
          profile_id: data.user.id,
          employment_status: "active",
          is_active: true,
          job_title_ar: "مهندس تجربة",
          employee_number: `551${runSuffix}`.slice(0, 32),
        })
        .select("id")
        .single(),
      "employee",
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

  test("login, home, my-work routes, PWA manifest, no finance leak", async ({ page }) => {
    await signInViaUI(page, user.email, user.password, "تجربة موظف");
    await expectPageMarker(page, "employee-home");
    await expect(page.getByTestId("header-notifications")).toBeVisible();
    await expect(page.getByRole("link", { name: "المالية" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "مركز القيادة" })).toHaveCount(0);

    const manifestRes = await page.request.get("/manifest.webmanifest");
    expect(manifestRes.ok()).toBeTruthy();
    const manifest = await manifestRes.json();
    expect(manifest.name).toBe("Master Touch OS");
    expect(manifest.display).toBe("standalone");

    await gotoApp(page, "/attendance");
    await expectPageMarker(page, "attendance-dashboard");
    await gotoApp(page, "/leave");
    await expectPageMarker(page, "leave-dashboard");
    await gotoApp(page, "/notifications");
    await expectPageMarker(page, "notifications-page");
    await gotoApp(page, "/projects");
    await expectPageMarker(page, "projects-page");
  });

  test("trial-critical viewports — no document horizontal overflow", async ({ page }) => {
    await signInViaUI(page, user.email, user.password, "تجربة موظف");
    const authed = ["/", "/attendance", "/leave", "/notifications", "/projects"];
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of authed) {
        await gotoApp(page, route);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} @ ${vp.name}`).toBeLessThanOrEqual(1);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "خروج" }).click();
    await gotoApp(page, "/login");
    await expectPageMarker(page, "login-page");
    const loginOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(loginOverflow).toBeLessThanOrEqual(1);
  });
});
