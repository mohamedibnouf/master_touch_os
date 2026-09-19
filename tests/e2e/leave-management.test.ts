/**
 * Phase 4.3 — Leave Management E2E
 *
 * Employee request → Manager approve → HR final approve → status/balance UI.
 * Also covers rejection and cancellation.
 *
 * Requires LIVE_TEST_ENABLED + Supabase env + migration 056 applied.
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
import { LEAVE_STATUS_LABELS } from "@/lib/hr/labels";

const ENABLED = process.env.LIVE_TEST_ENABLED === "true" || process.env.LIVE_TEST_ENABLED === "1";

type LeaveFixture = {
  runId: string;
  orgId: string;
  employee: { email: string; password: string; userId: string; employeeId: string };
  manager: { email: string; password: string; userId: string; employeeId: string };
  hr: { email: string; password: string; userId: string; employeeId: string };
  annualTypeId: string;
};

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function statusPattern(status: keyof typeof LEAVE_STATUS_LABELS): RegExp {
  const ar = LEAVE_STATUS_LABELS[status].ar;
  const en = LEAVE_STATUS_LABELS[status].en;
  // Accept labeled AR/EN plus ASCII status code; include undiacriticized AR variants where used.
  const extras =
    status === "submitted"
      ? ["مقدم", "submitted"]
      : status === "approved"
        ? ["approved"]
        : status === "rejected"
          ? ["rejected"]
          : status === "cancelled"
            ? ["cancelled"]
            : [];
  const parts = [ar, en, ...extras].map(escapeRegExp);
  return new RegExp(parts.join("|"), "i");
}

async function createLeaveE2EFixture(runId: string): Promise<LeaveFixture> {
  const admin = adminClient();
  const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
  const runSuffix = `${Date.now().toString(36)}${runId}`;

  await requireData(admin.from("organizations").select("id").eq("id", ORG_ID).single(), "ORG_ID must exist");

  const { data: perm } = await admin.from("permissions").select("key").eq("key", "leave.request").maybeSingle();
  if (!perm?.key) {
    throw new Error("Migration 056 required: leave.request permission missing. Apply phase4_fix_056.sql");
  }

  async function roleId(code: string) {
    const role = await requireData(
      admin.from("roles").select("id").eq("code", code).is("organization_id", null).single(),
      `role ${code}`,
    );
    return role.id;
  }

  async function provision(key: "EMP" | "MGR" | "HR", roleCode: string) {
    const email = `e2e43-${key.toLowerCase()}-${runSuffix}@test.local`;
    const password = `${prefix}${key}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name_ar: `مستخدم E2E ${key}`,
        full_name_en: `E2E ${key}`,
        locale: "ar",
      },
    });
    if (error || !data.user) throw new Error(`createUser ${key}: ${error?.message}`);
    const userId = data.user.id;

    await requireData(
      admin
        .from("organization_members")
        .insert({ organization_id: ORG_ID, profile_id: userId, status: "active" })
        .select("profile_id")
        .single(),
      `org member ${key}`,
    );

    const emp = await requireData(
      admin
        .from("employees")
        .insert({
          organization_id: ORG_ID,
          profile_id: userId,
          employment_status: "active",
          is_active: true,
          employee_number: `43${key}${runSuffix}`.slice(0, 32),
        })
        .select("id")
        .single(),
      `employee ${key}`,
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
      `role ${key}`,
    );

    return { email, password, userId, employeeId: emp.id as string };
  }

  const employee = await provision("EMP", "engineer");
  const manager = await provision("MGR", "department_manager");
  const hr = await provision("HR", "hr_manager");

  await admin
    .from("employees")
    .update({ direct_manager_employee_id: manager.employeeId })
    .eq("id", employee.employeeId);

  let { data: annual } = await admin
    .from("leave_types")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("code", "ANNUAL")
    .maybeSingle();

  if (!annual?.id) {
    annual = await requireData(
      admin
        .from("leave_types")
        .insert({
          organization_id: ORG_ID,
          code: "ANNUAL",
          name_ar: "إجازة سنوية",
          name_en: "Annual Leave",
          is_paid: true,
          annual_entitlement_days: 21,
          requires_attachment: false,
          minimum_notice_days: 0,
          is_active: true,
        })
        .select("id")
        .single(),
      "seed ANNUAL leave type",
    );
  } else {
    await admin.from("leave_types").update({ minimum_notice_days: 0 }).eq("id", annual.id);
  }

  await admin.from("employee_leave_balances").upsert(
    {
      organization_id: ORG_ID,
      employee_id: employee.employeeId,
      leave_type_id: annual.id,
      year: new Date().getUTCFullYear(),
      opening_balance: 0,
      entitled_days: 21,
      carried_forward_days: 0,
      used_days: 0,
      pending_days: 0,
      adjustment_days: 0,
    },
    { onConflict: "employee_id,leave_type_id,year" },
  );

  return {
    runId: runSuffix,
    orgId: ORG_ID,
    employee,
    manager,
    hr,
    annualTypeId: annual.id as string,
  };
}

async function cleanupLeaveFixture(fx: LeaveFixture | null) {
  if (!fx) return;
  const admin = adminClient();
  for (const user of [fx.employee, fx.manager, fx.hr]) {
    try {
      await admin.auth.admin.deleteUser(user.userId);
    } catch {
      /* best-effort */
    }
  }
}

test.describe("Phase 4.3 Leave Management E2E", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");

  let fx: LeaveFixture;
  let requestPath = "";
  let requestId = "";

  test.beforeAll(async () => {
    const runId = crypto.randomUUID().slice(0, 8);
    fx = await createLeaveE2EFixture(runId);
  });

  test.afterAll(async () => {
    await cleanupLeaveFixture(fx ?? null);
  });

  test("employee requests leave", async ({ page }) => {
    await signInViaUI(page, fx.employee.email, fx.employee.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/leave");
    await expectPageMarker(page, "leave-dashboard");
    await page.getByTestId("leave-request-cta").click();
    await expectPageMarker(page, "leave-request-form");

    await page.getByTestId("leave-type").selectOption({ value: fx.annualTypeId });
    const start = futureDate(10);
    const end = futureDate(11);
    await page.getByTestId("leave-start").fill(start);
    await page.getByTestId("leave-end").fill(end);
    await page.getByTestId("leave-reason").fill("E2E leave request");
    await page.getByTestId("leave-submit").click();

    await expectPageMarker(page, "leave-detail");
    await expect(page.getByTestId("leave-status")).toContainText(statusPattern("submitted"));
    requestPath = page.url();
    requestId = requestPath.split("/leave/")[1]?.split(/[?#]/)[0] ?? "";
    expect(requestId).toBeTruthy();

    // Verify manager in-app notification created for this request
    const admin = adminClient();
    const { data: mgrNotifs } = await admin
      .from("notifications")
      .select("id, type, recipient_profile_id")
      .eq("entity_id", requestId)
      .eq("recipient_profile_id", fx.manager.userId)
      .eq("type", "leave_request.submitted");
    expect((mgrNotifs ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test("manager approves leave", async ({ page }) => {
    expect(requestPath).toBeTruthy();
    const admin = adminClient();
    await signInViaUI(page, fx.manager.email, fx.manager.password);
    await gotoApp(page, requestPath.replace(/^https?:\/\/[^/]+/, "") || "/leave");
    await expectPageMarker(page, "leave-detail");
    await expect(page.getByTestId("leave-approve")).toBeVisible();
    await page.getByTestId("leave-approve").click();

    // Primary success signal: DB stage (UI refresh can lag under full-suite load).
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("leave_requests")
            .select("approval_stage, status")
            .eq("id", requestId)
            .maybeSingle();
          return `${data?.status}:${data?.approval_stage}`;
        },
        { timeout: 90_000 },
      )
      .toBe("submitted:hr");

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("notifications")
            .select("id")
            .eq("entity_id", requestId)
            .eq("recipient_profile_id", fx.hr.userId)
            .eq("type", "leave_request.manager_approved");
          return data?.length ?? 0;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(1);
  });

  test("HR final approves leave", async ({ page }) => {
    await signInViaUI(page, fx.hr.email, fx.hr.password);
    await gotoApp(page, "/hr/leave");
    await expectPageMarker(page, "leave-hr-dashboard");
    await gotoApp(page, requestPath.replace(/^https?:\/\/[^/]+/, "") || "/leave");
    await expectPageMarker(page, "leave-detail");
    await page.getByTestId("leave-approve").click();
    await expect(page.getByTestId("leave-status")).toContainText(statusPattern("approved"), {
      timeout: 60_000,
    });

    const admin = adminClient();
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("notifications")
            .select("id")
            .eq("entity_id", requestId)
            .eq("recipient_profile_id", fx.employee.userId)
            .eq("type", "leave_request.approved");
          return data?.length ?? 0;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThanOrEqual(1);
  });

  test("employee sees approved status on dashboard", async ({ page }) => {
    await signInViaUI(page, fx.employee.email, fx.employee.password);
    await gotoApp(page, "/leave");
    await expectPageMarker(page, "leave-dashboard");
    await expect(page.locator("body")).toContainText(statusPattern("approved"));
  });

  test("rejection and cancellation flows", async ({ page }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    await client.auth.signInWithPassword({ email: fx.employee.email, password: fx.employee.password });

    const { data: toReject, error: rejSubErr } = await client.rpc("submit_leave_request", {
      p_leave_type_id: fx.annualTypeId,
      p_start_date: futureDate(20),
      p_end_date: futureDate(20),
      p_reason: "e2e reject",
      p_attachment_document_id: null,
      p_request_id: null,
    });
    expect(rejSubErr).toBeNull();

    await signInViaUI(page, fx.manager.email, fx.manager.password);
    await gotoApp(page, `/leave/${toReject.id}`);
    await expectPageMarker(page, "leave-detail");
    await page.getByTestId("leave-reject").click();
    await expect(page.getByTestId("leave-status")).toContainText(statusPattern("rejected"));

    await client.auth.signInWithPassword({ email: fx.employee.email, password: fx.employee.password });
    const { data: toCancel, error: cancelSubErr } = await client.rpc("submit_leave_request", {
      p_leave_type_id: fx.annualTypeId,
      p_start_date: futureDate(25),
      p_end_date: futureDate(25),
      p_reason: "e2e cancel",
      p_attachment_document_id: null,
      p_request_id: null,
    });
    expect(cancelSubErr).toBeNull();

    await signInViaUI(page, fx.employee.email, fx.employee.password);
    await gotoApp(page, `/leave/${toCancel.id}`);
    await expectPageMarker(page, "leave-detail");
    await page.getByTestId("leave-cancel").click();
    await expect(page.getByTestId("leave-status")).toContainText(statusPattern("cancelled"));
  });
});
