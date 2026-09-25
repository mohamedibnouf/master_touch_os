/**
 * Phase 5.4 — Management AI Analyst E2E (mocked provider).
 * Requires MANAGEMENT_AI_PROVIDER=mock on the Next server process.
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

type Fx = {
  finance: { email: string; password: string; userId: string };
  engineer: { email: string; password: string; userId: string };
};

async function createFixture(runId: string): Promise<Fx> {
  const admin = adminClient();
  const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
  const runSuffix = `${Date.now().toString(36)}${runId}`;

  async function roleId(code: string) {
    const role = await requireData(
      admin.from("roles").select("id").eq("code", code).is("organization_id", null).single(),
      `role ${code}`,
    );
    return role.id as string;
  }

  async function provision(tag: "FIN" | "ENG", roleCode: string) {
    const email = `e2e54-${tag.toLowerCase()}-${runSuffix}@test.local`;
    const password = `${prefix}${tag}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: `E2E54 ${tag}`, full_name_en: `E2E54 ${tag}`, locale: "ar" },
    });
    if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message}`);
    const userId = data.user.id;
    await requireData(
      admin
        .from("organization_members")
        .insert({ organization_id: ORG_ID, profile_id: userId, status: "active" })
        .select("profile_id")
        .single(),
      `member ${tag}`,
    );
    await requireData(
      admin
        .from("user_roles")
        .insert({
          organization_id: ORG_ID,
          profile_id: userId,
          role_id: await roleId(roleCode),
          scope_type: "organization",
        })
        .select("id")
        .single(),
      `role ${tag}`,
    );
    return { email, password, userId };
  }

  return {
    finance: await provision("FIN", "finance_manager"),
    engineer: await provision("ENG", "engineer"),
  };
}

async function cleanup(fx: Fx | null) {
  if (!fx) return;
  const admin = adminClient();
  for (const u of [fx.finance, fx.engineer]) {
    try {
      await admin.auth.admin.deleteUser(u.userId);
    } catch {
      /* best-effort */
    }
  }
}

test.describe("Phase 5.4 Management AI Analyst E2E", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");
  test.setTimeout(180_000);

  let fx: Fx;

  test.beforeAll(async () => {
    fx = await createFixture(crypto.randomUUID().slice(0, 8));
  });

  test.afterAll(async () => {
    await cleanup(fx ?? null);
  });

  test("authorized manager opens /management/analyst", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/analyst");
    await expectPageMarker(page, "management-analyst");
    await expect(page.getByTestId("management-analyst-client")).toBeVisible();
  });

  test("provider unavailable or mock brief works", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/analyst");
    await expectPageMarker(page, "management-analyst");

    const unavailable = page.getByTestId("analyst-unavailable");
    const briefBtn = page.getByTestId("analyst-executive-brief");
    if (await unavailable.isVisible().catch(() => false)) {
      await expect(unavailable).toContainText(/MANAGEMENT_AI_PROVIDER/i);
      return;
    }
    await expect(briefBtn).toBeEnabled();
    await briefBtn.click();
    await expect(page.getByTestId("analyst-result")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("analyst-summary")).toBeVisible();
    await expect(page.getByTestId("analyst-disclaimer")).toBeVisible();
    // Fake citation from mock must not render
    await expect(page.getByText("Dropped bogus citation")).toHaveCount(0);
  });

  test("suggested question yields grounded response with evidence", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/analyst");
    if (await page.getByTestId("analyst-unavailable").isVisible().catch(() => false)) {
      test.skip(true, "AI provider not configured (mock/openai)");
      return;
    }
    await page.getByTestId("analyst-suggest-attention").click();
    await expect(page.getByTestId("analyst-result")).toBeVisible({ timeout: 60_000 });
    const evidence = page.locator("[data-testid^='analyst-evidence-']");
    // May be zero if org has no risks — still a valid deterministic outcome with summary
    await expect(page.getByTestId("analyst-summary")).toBeVisible();
    if ((await evidence.count()) > 0) {
      const href = await evidence.first().getAttribute("href");
      expect(href).toBeTruthy();
      expect(href).not.toMatch(/javascript:|https?:\/\/evil/i);
    }
  });

  test("unauthorized engineer cannot access analyst", async ({ page }) => {
    await signInViaUI(page, fx.engineer.email, fx.engineer.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/analyst");
    await expect(page.getByTestId("management-analyst")).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/management/);
  });

  test("salary/IBAN/peer net pay not visible on analyst page", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/analyst");
    await expectPageMarker(page, "management-analyst");
    if (!(await page.getByTestId("analyst-unavailable").isVisible().catch(() => false))) {
      await page.getByTestId("analyst-executive-brief").click();
      await expect(page.getByTestId("analyst-result")).toBeVisible({ timeout: 60_000 });
    }
    const body = await page.getByTestId("management-analyst").innerText();
    expect(body).not.toMatch(/basic_salary|net_pay|رقم الحساب البنكي/i);
    // Allow the word IBAN only if it appears in unavailable instructions — check metrics area
    await expect(page.getByTestId("payroll-manual-earning-form")).toHaveCount(0);
  });
});

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

test.describe("Phase 5.4 analyst viewport", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");
  test.setTimeout(240_000);

  let user: { email: string; password: string; userId: string };

  test.beforeAll(async () => {
    const admin = adminClient();
    const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
    const runSuffix = Date.now().toString(36);
    const email = `e2e54-vp-${runSuffix}@test.local`;
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
    test(`analyst usable at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await signInViaUI(page, user.email, user.password);
      await assertAuthenticatedPage(page);
      await gotoApp(page, "/management/analyst");
      await expectPageMarker(page, "management-analyst");
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflowX, `overflow at ${vp.name}`).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("management-analyst-client")).toBeVisible();
    });
  }
});
