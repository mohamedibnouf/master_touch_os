/**
 * Phase 5.3 — Management Reports E2E
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
    const email = `e2e53-${tag.toLowerCase()}-${runSuffix}@test.local`;
    const password = `${prefix}${tag}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: `E2E53 ${tag}`, full_name_en: `E2E53 ${tag}`, locale: "ar" },
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

  const project = await requireData(
    admin
      .from("projects")
      .insert({
        organization_id: ORG_ID,
        project_code: `E2E53-${runSuffix}`.slice(0, 32),
        name_ar: "مشروع تقرير إداري",
        name_en: "Management report project",
        status: "active",
        priority: "medium",
        progress_percentage: 0,
        risk_level: "medium",
        planned_end_date: "2020-01-01",
        created_by: finance.userId,
      })
      .select("id")
      .single(),
    "report project",
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

test.describe("Phase 5.3 Management Reports E2E", () => {
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

  test("authorized user opens reports index", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports");
    await expectPageMarker(page, "management-reports-index");
    await expect(page.getByTestId("report-card-executive")).toBeVisible();
  });

  test("executive report renders with decision brief and as-of", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports/executive");
    await expectPageMarker(page, "management-report-executive");
    await expect(page.getByTestId("report-as-of")).toBeVisible();
    await expect(page.getByTestId("decision-brief")).toBeVisible();
    await expect(page.getByTestId("report-print-button")).toBeVisible();
  });

  test("deterministic risk attention and source drill-down", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports/risks");
    await expectPageMarker(page, "management-report-risks");
    const item = page.locator(
      `[data-testid="management-risk-item"][data-rule-id="PROJECT_PLANNED_END_OVERDUE"]`,
    );
    await expect(item.first()).toBeVisible({ timeout: 60_000 });
    const link = item.first().locator(`[data-testid="management-risk-link-PROJECT_PLANNED_END_OVERDUE"]`);
    await expect(link).toHaveAttribute("href", new RegExp(`/projects/${fx.projectId}`));
  });

  test("project report renders", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports/projects");
    await expectPageMarker(page, "management-report-projects");
    await expect(page.getByTestId("report-metrics")).toBeVisible();
    await expect(page.getByTestId("report-csv-download")).toBeVisible();
  });

  test("finance report respects permission boundary (counts, redaction note)", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports/finance");
    await expectPageMarker(page, "management-report-finance");
    await expect(page.getByTestId("finance-redaction-note")).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/IBAN|iban|رقم الحساب البنكي/i);
  });

  test("people report contains no salary/IBAN", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports/people");
    await expectPageMarker(page, "management-report-people");
    await expect(page.getByTestId("people-privacy-note")).toBeVisible();
    const metrics = await page.getByTestId("report-metrics").innerText();
    expect(metrics).not.toMatch(/basic_salary|net_pay|IBAN|iban|رقم الحساب/i);
    await expect(page.getByTestId("payroll-manual-earning-form")).toHaveCount(0);
  });

  test("payroll report contains no peer net pay", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports/payroll");
    await expectPageMarker(page, "management-report-payroll");
    await expect(page.getByTestId("payroll-manual-earning-form")).toHaveCount(0);
    const metrics = await page.getByTestId("report-metrics").innerText();
    expect(metrics).not.toMatch(/IBAN|iban|راتب الموظف|peer/i);
  });

  test("unauthorized engineer cannot access reports", async ({ page }) => {
    await signInViaUI(page, fx.engineer.email, fx.engineer.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports");
    await expect(page.getByTestId("management-reports-index")).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/management/);
  });

  test("print chrome is present on executive report", async ({ page }) => {
    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/management/reports/executive");
    await expectPageMarker(page, "management-report-executive");
    await expect(page.getByTestId("report-header")).toBeVisible();
    await expect(page.getByTestId("report-print-button")).toBeVisible();
  });
});
