/**
 * Authenticated route smoke — detects generic error-boundary copy on key screens.
 * Requires LIVE_TEST_ENABLED. Does not mutate Production business data.
 */
import { test, expect } from "@playwright/test";
import { adminClient, gotoApp, ORG_ID, requireData, signInViaUI } from "./helpers";

const ENABLED = process.env.LIVE_TEST_ENABLED === "true" || process.env.LIVE_TEST_ENABLED === "1";

const ROUTES = [
  "/",
  "/projects",
  "/employees",
  "/departments",
  "/hr/attendance",
  "/hr/attendance/locations",
  "/hr/leave",
  "/payroll",
  "/documents",
  "/notifications",
  "/management",
  "/settings",
];

test.describe("Authenticated route smoke", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");
  test.setTimeout(240_000);

  let user: { email: string; password: string };

  test.beforeAll(async () => {
    const admin = adminClient();
    const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
    const runSuffix = Date.now().toString(36);
    const email = `e2e-smoke-${runSuffix}@test.local`;
    const password = `${prefix}SMOKE`;
    const role = await requireData(
      admin.from("roles").select("id").eq("code", "general_manager").is("organization_id", null).single(),
      "role gm",
    );
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: "تجربة دخان", full_name_en: "Smoke", locale: "ar" },
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
    user = { email, password };
  });

  test("key routes do not render the generic load-failure boundary", async ({ page }) => {
    await signInViaUI(page, user.email, user.password, "تجربة دخان");
    for (const route of ROUTES) {
      await gotoApp(page, route);
      await expect(page.getByRole("heading", { name: "تعذّر تحميل هذه الشاشة" })).toHaveCount(0);
      await expect(page).not.toHaveURL(/\/login/);
    }
  });
});
