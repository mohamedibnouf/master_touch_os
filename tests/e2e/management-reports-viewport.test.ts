/**
 * Phase 5.3 — actual viewport verification for management reports.
 * Run: LIVE_TEST_ENABLED=true npx playwright test tests/e2e/management-reports-viewport.test.ts
 */
import { test, expect } from "@playwright/test";
import {
  adminClient,
  assertAuthenticatedPage,
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

test.describe("Phase 5.3 report viewport verification", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");
  test.setTimeout(240_000);

  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    const admin = adminClient();
    const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
    const runSuffix = Date.now().toString(36);
    const email = `e2e53-vp-${runSuffix}@test.local`;
    const password = `${prefix}VP`;
    const role = await requireData(
      admin.from("roles").select("id").eq("code", "finance_manager").is("organization_id", null).single(),
      "role",
    );
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: "VP", full_name_en: "VP", locale: "ar" },
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

  for (const vp of VIEWPORTS) {
    test(`executive report usable at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await signInViaUI(page, user.email, user.password);
      await assertAuthenticatedPage(page);
      await gotoApp(page, "/management/reports/executive");
      await expectPageMarker(page, "management-report-executive");

      const overflowX = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflowX, `document horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(1);

      await expect(page.getByTestId("report-header")).toBeVisible();
      await expect(page.getByTestId("decision-brief")).toBeVisible();
      await expect(page.getByTestId("report-print-button")).toBeVisible();

      const headingBox = await page.getByTestId("report-header").locator("h1").boundingBox();
      expect(headingBox?.width ?? 0).toBeGreaterThan(40);
      expect((headingBox?.x ?? 0) + (headingBox?.width ?? 0)).toBeLessThanOrEqual(vp.width + 2);
    });
  }
});
