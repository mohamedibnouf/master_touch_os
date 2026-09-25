/**
 * Phase 5.1 / 5.2 — Executive Command Center + Deterministic Risk Engine E2E
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
  projectId: string;
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
    const email = `e2e52-${tag.toLowerCase()}-${runSuffix}@test.local`;
    const password = `${prefix}${tag}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: `E2E ${tag}`, full_name_en: `E2E ${tag}`, locale: "ar" },
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

  const finance = await provision("FIN", "finance_manager");
  const engineer = await provision("ENG", "engineer");

  // Deterministic overdue project for risk engine (planned_end in the past, still active).
  const project = await requireData(
    admin
      .from("projects")
      .insert({
        organization_id: ORG_ID,
        project_code: `E2E52-${runSuffix}`.slice(0, 32),
        name_ar: "مشروع مخاطر حتمية",
        name_en: "Deterministic risk project",
        status: "active",
        priority: "medium",
        progress_percentage: 0,
        risk_level: "medium",
        planned_end_date: "2020-01-01",
        created_by: finance.userId,
      })
      .select("id")
      .single(),
    "risk project",
  );

  return { finance, engineer, projectId: project.id as string };
}

async function cleanup(fx: Fx | null) {
  if (!fx) return;
  const admin = adminClient();
  try {
    await admin.from("projects").delete().eq("id", fx.projectId);
  } catch {
    /* best-effort */
  }
  for (const u of [fx.finance, fx.engineer]) {
    try {
      await admin.auth.admin.deleteUser(u.userId);
    } catch {
      /* best-effort */
    }
  }
}

test.describe("Phase 5.2 Deterministic Risk Engine E2E", () => {
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

  test("authorized management user opens /management/risks", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/risks");
    await expectPageMarker(page, "management-risks");
    await expect(page.getByTestId("management-risks-filters")).toBeVisible();
    await expect(page.getByTestId("management-risks-totals")).toBeVisible();
  });

  test("deterministic finding shows explanation and drill-down", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/risks?category=PROJECT_DELAY");
    await expectPageMarker(page, "management-risks");

    const item = page.locator(
      `[data-testid="management-risk-item"][data-rule-id="PROJECT_PLANNED_END_OVERDUE"]`,
    );
    await expect(item.first()).toBeVisible({ timeout: 60_000 });
    await expect(item.first().getByTestId("management-risk-explanation")).toContainText(/مخطط|planned|تجاوز/i);
    const link = item.first().locator(`[data-testid="management-risk-link-PROJECT_PLANNED_END_OVERDUE"]`);
    await expect(link).toHaveAttribute("href", new RegExp(`/projects/${fx.projectId}`));
  });

  test("severity and category filters work", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);

    await gotoApp(page, "/management/risks?severity=HIGH");
    await expectPageMarker(page, "management-risks");
    await expect(page).toHaveURL(/severity=HIGH/);
    const highItems = page.getByTestId("management-risk-item");
    const highCount = await highItems.count();
    for (let i = 0; i < Math.min(highCount, 5); i++) {
      await expect(highItems.nth(i)).toHaveAttribute("data-severity", "HIGH");
    }

    await gotoApp(page, "/management/risks?category=PROJECT_DELAY");
    await expectPageMarker(page, "management-risks");
    await expect(page).toHaveURL(/category=PROJECT_DELAY/);
    const items = page.getByTestId("management-risk-item");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(items.nth(i)).toHaveAttribute("data-category", "PROJECT_DELAY");
    }

    await expect(page.getByTestId("filter-severity-all")).toBeVisible();
    await expect(page.getByTestId("filter-category-PROJECT_DELAY")).toBeVisible();
  });

  test("unauthorized engineer cannot access management risks", async ({ page }) => {
    await signInViaUI(page, fx.engineer.email, fx.engineer.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/risks");
    await expect(page.getByTestId("management-risks")).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/management/);
  });

  test("sensitive salary/banking data does not appear on risks page", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/risks");
    await expectPageMarker(page, "management-risks");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/IBAN|iban|رقم الحساب|صافي الراتب|net_pay|basic_salary/i);
    await expect(page.getByTestId("payroll-manual-earning-form")).toHaveCount(0);
  });

  test("ECC attention consumes canonical risk findings", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management");
    await expectPageMarker(page, "management-overview");
    await expect(page.getByTestId("management-attention")).toBeVisible();
    const link = page.getByTestId("management-attention-link-PROJECT_PLANNED_END_OVERDUE");
    await expect(link).toBeVisible({ timeout: 60_000 });
  });
});
