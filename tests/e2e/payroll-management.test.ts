/**
 * Phase 4.5 — Payroll Management E2E
 *
 * HR create/calculate/adjust/submit → Finance review/approve/lock/pay → Employee payslip.
 * Unauthorized peer cannot open another employee's payslip.
 *
 * Requires LIVE_TEST_ENABLED + migration 059 applied.
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

type PayrollFixture = {
  runId: string;
  year: number;
  month: number;
  periodLabel: string;
  employee: { email: string; password: string; userId: string; employeeId: string };
  peer: { email: string; password: string; userId: string; employeeId: string };
  hr: { email: string; password: string; userId: string; employeeId: string };
  finance: { email: string; password: string; userId: string; employeeId: string };
  periodId: string;
  empEntryId: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function periodFromRun(runSuffix: string): { year: number; month: number } {
  let h = 0;
  for (let i = 0; i < runSuffix.length; i++) h = (h * 31 + runSuffix.charCodeAt(i)) >>> 0;
  const thirtyDay = [4, 6, 9, 11] as const;
  // Keep within production year check (2000–2100) and fixture band used by live suite.
  return { year: 2090 + (h % 10), month: thirtyDay[(h >>> 3) % 4] };
}

async function allocateE2ePeriodSlot(
  admin: ReturnType<typeof adminClient>,
  runSuffix: string,
): Promise<{ year: number; month: number }> {
  const preferred = periodFromRun(runSuffix);
  const thirtyDay = [4, 6, 9, 11] as const;
  const yearMin = 2090;
  const yearMax = 2099;
  const slotCount = (yearMax - yearMin + 1) * thirtyDay.length;
  let h = 0;
  for (let i = 0; i < runSuffix.length; i++) h = (h * 31 + runSuffix.charCodeAt(i)) >>> 0;

  for (let i = 0; i < slotCount; i++) {
    const idx = (h + i) % slotCount;
    const year = yearMin + Math.floor(idx / thirtyDay.length);
    const month = thirtyDay[idx % thirtyDay.length];
    const { data: existing } = await admin
      .from("payroll_periods")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("year", year)
      .eq("month", month)
      .neq("status", "cancelled")
      .maybeSingle();
    if (!existing) return { year, month };
  }
  // Fall back to preferred; create may still CONFLICT if band is exhausted.
  return preferred;
}

async function createFixture(runId: string): Promise<PayrollFixture> {
  const admin = adminClient();
  const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
  const runSuffix = `${Date.now().toString(36)}${runId}`;
  const { year, month } = await allocateE2ePeriodSlot(admin, runSuffix);
  const joinDate = `${year - 1}-01-01`;
  const compFrom = `${year}-${pad2(month)}-01`;

  await requireData(admin.from("organizations").select("id").eq("id", ORG_ID).single(), "ORG");

  const { data: perm } = await admin
    .from("permissions")
    .select("key")
    .eq("key", "payroll.prepare")
    .maybeSingle();
  if (!perm?.key) {
    throw new Error("Migration 059 required: apply supabase/phase4_fix_059.sql");
  }

  const { error: tableErr } = await admin.from("payroll_periods").select("id").limit(1);
  if (tableErr) {
    throw new Error("Migration 059 required: payroll_periods missing — apply phase4_fix_059.sql");
  }

  async function roleId(code: string) {
    const role = await requireData(
      admin.from("roles").select("id").eq("code", code).is("organization_id", null).single(),
      `role ${code}`,
    );
    return role.id;
  }

  async function provision(tag: "EMP" | "PEER" | "HR" | "FIN", roleCode: string) {
    const email = `e2e45-${tag.toLowerCase()}-${runSuffix}@test.local`;
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

    const emp = await requireData(
      admin
        .from("employees")
        .insert({
          organization_id: ORG_ID,
          profile_id: userId,
          employment_status: "active",
          is_active: true,
          employee_number: `45${tag}${runSuffix}`.slice(0, 32),
          joining_date: joinDate,
        })
        .select("id")
        .single(),
      `emp ${tag}`,
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

    return { email, password, userId, employeeId: emp.id as string };
  }

  const employee = await provision("EMP", "engineer");
  const peer = await provision("PEER", "engineer");
  const hr = await provision("HR", "hr_manager");
  const finance = await provision("FIN", "finance_manager");

  await requireData(
    admin
      .from("employee_contracts")
      .insert({
        organization_id: ORG_ID,
        employee_id: employee.employeeId,
        contract_number: `E2E45-${runSuffix}`.slice(0, 40),
        contract_type: "permanent",
        status: "active",
        start_date: joinDate,
        is_current: true,
        created_by: hr.userId,
        initial_basic_salary: 10000,
      })
      .select("id")
      .single(),
    "contract",
  );

  await requireData(
    admin
      .from("employee_compensation_versions")
      .insert({
        organization_id: ORG_ID,
        employee_id: employee.employeeId,
        effective_from: compFrom,
        currency: "SAR",
        basic_salary: 10000,
        housing_allowance: 2500,
        transport_allowance: 500,
        other_allowances: 0,
        status: "active",
        created_by: hr.userId,
        change_reason: "e2e45 fixture",
      })
      .select("id")
      .single(),
    "compensation",
  );

  await admin.from("employee_bank_accounts").insert({
    organization_id: ORG_ID,
    employee_id: employee.employeeId,
    bank_name: "Al Rajhi",
    iban: `SA0380000000608010${runSuffix.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`.slice(0, 24).padEnd(24, "0"),
    account_name: "E2E Employee",
    is_primary: true,
    is_active: true,
    created_by: hr.userId,
  });

  return {
    runId: runSuffix,
    year,
    month,
    periodLabel: `${year}/${pad2(month)}`,
    employee,
    peer,
    hr,
    finance,
    periodId: "",
    empEntryId: "",
  };
}

async function cleanup(fx: PayrollFixture | null) {
  if (!fx) return;
  const admin = adminClient();
  for (const u of [fx.employee, fx.peer, fx.hr, fx.finance]) {
    try {
      await admin.auth.admin.deleteUser(u.userId);
    } catch {
      /* best-effort */
    }
  }
}

test.describe("Phase 4.5 Payroll Management E2E", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");
  test.setTimeout(300_000);

  let fx: PayrollFixture;

  test.beforeAll(async () => {
    fx = await createFixture(crypto.randomUUID().slice(0, 8));
  });

  test.afterAll(async () => {
    await cleanup(fx ?? null);
  });

  test("HR creates period, calculates, adds manual earning, submits review", async ({ page }) => {
    await signInViaUI(page, fx.hr.email, fx.hr.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/payroll");
    await expectPageMarker(page, "payroll-dashboard");

    await page.locator('[data-testid="payroll-create-form"] [name="year"]').fill(String(fx.year));
    await page.locator('[data-testid="payroll-create-form"] [name="month"]').selectOption(String(fx.month));
    await expect(page.locator('[data-testid="payroll-create-form"] [name="year"]')).toHaveValue(String(fx.year));
    await page.getByTestId("payroll-create-submit").click();

    // Resolve the new draft by id. A cancelled sibling may share year/month
    // (partial unique index); do not rely on Arabic status spelling in the list.
    await expect
      .poll(
        async () => {
          const admin = adminClient();
          const { data } = await admin
            .from("payroll_periods")
            .select("id, status")
            .eq("organization_id", ORG_ID)
            .eq("year", fx.year)
            .eq("month", fx.month)
            .eq("status", "draft")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data?.id) fx.periodId = data.id as string;
          return data?.id ?? "";
        },
        { timeout: 60_000 },
      )
      .not.toBe("");

    const periodRow = page
      .getByTestId("payroll-period-row")
      .filter({ hasText: fx.periodLabel })
      .filter({ has: page.locator(`a[href="/payroll/${fx.periodId}"]`) });
    await expect(periodRow).toBeVisible({ timeout: 60_000 });

    await gotoApp(page, `/payroll/${fx.periodId}`);
    await expectPageMarker(page, "payroll-period-detail");
    await expect(page.getByTestId("payroll-calculate-btn")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("payroll-calculate-btn").click();
    await expect(page.getByTestId("payroll-period-status")).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(
        async () => {
          const admin = adminClient();
          const { data } = await admin.from("payroll_periods").select("status").eq("id", fx.periodId).single();
          return data?.status ?? "";
        },
        { timeout: 90_000 },
      )
      .toBe("calculated");

    await page.getByTestId("payroll-employees-link").click();
    await expectPageMarker(page, "payroll-employees");

    await expect
      .poll(async () => {
        const admin = adminClient();
        const { data } = await admin
          .from("payroll_entries")
          .select("id")
          .eq("payroll_period_id", fx.periodId)
          .eq("employee_id", fx.employee.employeeId)
          .maybeSingle();
        if (data?.id) fx.empEntryId = data.id as string;
        return Boolean(data?.id);
      })
      .toBe(true);

    await expect(page.getByTestId("payroll-manual-earning-form")).toBeVisible();
    await page.locator('[data-testid="payroll-manual-earning-form"] [name="entryId"]').selectOption(fx.empEntryId);
    await page.locator('[data-testid="payroll-manual-earning-form"] [name="code"]').fill("BONUS");
    await page.locator('[data-testid="payroll-manual-earning-form"] [name="descriptionAr"]').fill("مكافأة");
    await page.locator('[data-testid="payroll-manual-earning-form"] [name="descriptionEn"]').fill("Bonus");
    await page.locator('[data-testid="payroll-manual-earning-form"] [name="amount"]').fill("250");
    await page.locator('[data-testid="payroll-manual-earning-form"] [name="reason"]').fill("e2e manual bonus");
    await page.locator('[data-testid="payroll-manual-earning-form"] button[type="submit"]').click();

    await expect
      .poll(async () => {
        const admin = adminClient();
        const { data } = await admin
          .from("payroll_earnings")
          .select("id")
          .eq("payroll_entry_id", fx.empEntryId)
          .eq("code", "BONUS")
          .eq("is_manual", true);
        return (data ?? []).length;
      })
      .toBeGreaterThanOrEqual(1);

    await gotoApp(page, `/payroll/${fx.periodId}`);
    await expectPageMarker(page, "payroll-period-detail");
    await page.getByTestId("payroll-submit-btn").click();
    await expect
      .poll(async () => {
        const admin = adminClient();
        const { data } = await admin.from("payroll_periods").select("status").eq("id", fx.periodId).single();
        return data?.status ?? "";
      })
      .toBe("under_review");
  });

  test("Finance reviews, approves, locks, and records payment", async ({ page }) => {
    expect(fx.periodId).toBeTruthy();
    expect(fx.empEntryId).toBeTruthy();

    await signInViaUI(page, fx.finance.email, fx.finance.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, `/payroll/${fx.periodId}/review`);
    await expectPageMarker(page, "payroll-review");

    // Wait for RPC commit, then reload so the next form post is not queued behind a
    // still-running server action (notification fan-out).
    await page.getByTestId("payroll-review-action").click();
    await expect
      .poll(
        async () => {
          const admin = adminClient();
          const { data } = await admin
            .from("payroll_periods")
            .select("reviewed_at")
            .eq("id", fx.periodId)
            .single();
          return data?.reviewed_at ?? null;
        },
        { timeout: 60_000 },
      )
      .not.toBeNull();

    await gotoApp(page, `/payroll/${fx.periodId}/review`);
    await expectPageMarker(page, "payroll-review");
    await page.getByTestId("payroll-approve-action").click();
    await expect
      .poll(
        async () => {
          const admin = adminClient();
          const { data } = await admin.from("payroll_periods").select("status").eq("id", fx.periodId).single();
          return data?.status ?? "";
        },
        { timeout: 60_000 },
      )
      .toBe("approved");

    await gotoApp(page, `/payroll/${fx.periodId}/review`);
    await expectPageMarker(page, "payroll-review");
    await expect(page.getByTestId("payroll-lock-action")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("payroll-lock-action").click();
    await expect
      .poll(
        async () => {
          const admin = adminClient();
          const { data } = await admin.from("payroll_periods").select("status").eq("id", fx.periodId).single();
          return data?.status ?? "";
        },
        { timeout: 90_000 },
      )
      .toBe("locked");

    await gotoApp(page, `/payroll/payslips/${fx.empEntryId}`);
    await expectPageMarker(page, "payroll-payslip");
    await expect(page.getByTestId("payroll-payslip-net")).toBeVisible();

    const { data: entrySnap } = await adminClient()
      .from("payroll_entries")
      .select("net_pay, payment_status")
      .eq("id", fx.empEntryId)
      .single();
    expect(entrySnap?.payment_status).toBe("unpaid");
    const netPay = Number(entrySnap?.net_pay);
    expect(netPay).toBeGreaterThan(0);

    await expect(page.getByTestId("payroll-payment-form")).toBeVisible();
    await page.locator('[data-testid="payroll-payment-form"] [name="paymentDate"]').fill(
      new Date().toISOString().slice(0, 10),
    );
    await page.locator('[data-testid="payroll-payment-form"] [name="amount"]').fill(netPay.toFixed(2));
    await page.locator('[data-testid="payroll-payment-form"] [name="paymentReference"]').fill(`E2E45-${fx.runId}`);
    await page.getByTestId("payroll-record-payment").click();

    await expect
      .poll(
        async () => {
          const admin = adminClient();
          const { data } = await admin
            .from("payroll_entries")
            .select("payment_status")
            .eq("id", fx.empEntryId)
            .single();
          return data?.payment_status ?? "";
        },
        { timeout: 60_000 },
      )
      .toBe("paid");
  });

  test("Employee views own payslip net pay", async ({ page }) => {
    await signInViaUI(page, fx.employee.email, fx.employee.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/my/payslips");
    await expectPageMarker(page, "my-payslips");

    await expect(page.getByTestId("my-payslip-row").first()).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("my-payslip-row").first().locator("a").click();
    await expectPageMarker(page, "my-payslip-detail");
    await expect(page.getByTestId("my-payslip-net")).toBeVisible();
    const netText = await page.getByTestId("my-payslip-net").innerText();
    // UI formats with ar-SA numerals (e.g. ١٣٬٢٥٠٫٠٠) — accept Arabic-Indic or ASCII digits.
    expect(netText).toMatch(/[\d٠-٩]/);
    expect(netText).toMatch(/SAR/i);
  });

  test("Peer cannot open other employee payslip", async ({ page }) => {
    expect(fx.empEntryId).toBeTruthy();
    await signInViaUI(page, fx.peer.email, fx.peer.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, `/my/payslips/${fx.empEntryId}`);

    // Denial may be redirect to list OR 404 when RLS hides the foreign entry.
    await expect
      .poll(
        async () => {
          const url = page.url();
          const hasForeignNet =
            (await page.getByTestId("my-payslip-detail").isVisible().catch(() => false)) &&
            (await page.getByTestId("my-payslip-net").isVisible().catch(() => false)) &&
            url.includes(fx.empEntryId);
          if (hasForeignNet) return "leaked";
          const onList = await page.getByTestId("my-payslips").isVisible().catch(() => false);
          const is404 = await page.getByText("This page could not be found").isVisible().catch(() => false);
          if (onList || is404 || !url.includes(fx.empEntryId) || url.includes("/login")) return "blocked";
          return "pending";
        },
        { timeout: 60_000 },
      )
      .toBe("blocked");
  });
});
