/**
 * Phase 4.4 — Attendance Management E2E
 *
 * Employee check-in/out → Manager team view → HR adjust + verify.
 * Requires LIVE_TEST_ENABLED + migration 057 applied.
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

type AttendanceFixture = {
  runId: string;
  employee: { email: string; password: string; userId: string; employeeId: string };
  manager: { email: string; password: string; userId: string; employeeId: string };
  hr: { email: string; password: string; userId: string; employeeId: string };
  shiftId: string;
};

async function createFixture(runId: string): Promise<AttendanceFixture> {
  const admin = adminClient();
  const prefix = process.env.E2E_PASSWORD ?? "E2eTest1!";
  const runSuffix = `${Date.now().toString(36)}${runId}`;

  await requireData(admin.from("organizations").select("id").eq("id", ORG_ID).single(), "ORG");

  const { data: perm } = await admin
    .from("permissions")
    .select("key")
    .eq("key", "attendance.check_in")
    .maybeSingle();
  if (!perm?.key) {
    throw new Error("Migration 057 required: apply phase4_fix_057.sql");
  }

  async function roleId(code: string) {
    const role = await requireData(
      admin.from("roles").select("id").eq("code", code).is("organization_id", null).single(),
      `role ${code}`,
    );
    return role.id;
  }

  async function provision(tag: "EMP" | "MGR" | "HR", roleCode: string) {
    const email = `e2e44-${tag.toLowerCase()}-${runSuffix}@test.local`;
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
          employee_number: `44${tag}${runSuffix}`.slice(0, 32),
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
  const manager = await provision("MGR", "department_manager");
  const hr = await provision("HR", "hr_manager");

  await admin
    .from("employees")
    .update({ direct_manager_employee_id: manager.employeeId })
    .eq("id", employee.employeeId);

  let { data: shift } = await admin
    .from("attendance_shifts")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("code", "STD_DAY")
    .maybeSingle();

  if (!shift?.id) {
    const { data: policy } = await admin
      .from("attendance_policies")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("code", "DEFAULT")
      .single();
    shift = await requireData(
      admin
        .from("attendance_shifts")
        .insert({
          organization_id: ORG_ID,
          policy_id: policy!.id,
          code: "STD_DAY",
          name_ar: "وردية",
          name_en: "Day",
          start_time: "00:00",
          end_time: "23:59",
          break_minutes: 0,
          crosses_midnight: false,
          working_days: [0, 1, 2, 3, 4, 5, 6],
          is_active: true,
        })
        .select("id")
        .single(),
      "shift",
    );
  } else {
    await admin
      .from("attendance_shifts")
      .update({
        start_time: "00:00",
        end_time: "23:59",
        working_days: [0, 1, 2, 3, 4, 5, 6],
        is_active: true,
      })
      .eq("id", shift.id);
  }

  const today = new Date().toISOString().slice(0, 10);
  await admin.from("employee_shift_assignments").insert({
    organization_id: ORG_ID,
    employee_id: employee.employeeId,
    shift_id: shift.id,
    effective_from: today,
    created_by: hr.userId,
  });

  return { runId: runSuffix, employee, manager, hr, shiftId: shift.id as string };
}

async function cleanup(fx: AttendanceFixture | null) {
  if (!fx) return;
  const admin = adminClient();
  for (const u of [fx.employee, fx.manager, fx.hr]) {
    try {
      await admin.auth.admin.deleteUser(u.userId);
    } catch {
      /* best-effort */
    }
  }
}

test.describe("Phase 4.4 Attendance Management E2E", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(!ENABLED, "LIVE_TEST_ENABLED not set");

  let fx: AttendanceFixture;

  test.beforeAll(async () => {
    fx = await createFixture(crypto.randomUUID().slice(0, 8));
  });

  test.afterAll(async () => {
    await cleanup(fx ?? null);
  });

  test("employee checks in and out", async ({ page }) => {
    await signInViaUI(page, fx.employee.email, fx.employee.password);
    await assertAuthenticatedPage(page);
    await gotoApp(page, "/attendance");
    await expectPageMarker(page, "attendance-dashboard");

    await page.getByTestId("attendance-check-in").click();
    await expect(page.getByTestId("attendance-today-card")).toBeVisible({ timeout: 60_000 });

    // Wait until check-out is available (server action completed)
    await expect(page.getByTestId("attendance-check-out")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("attendance-check-out").click();
    await expect(page.getByTestId("attendance-today-card")).toBeVisible({ timeout: 60_000 });

    const admin = adminClient();
    const today = new Date().toISOString().slice(0, 10);
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("attendance_records")
          .select("check_in_at, check_out_at")
          .eq("employee_id", fx.employee.employeeId)
          .eq("attendance_date", today)
          .maybeSingle();
        return Boolean(data?.check_in_at && data?.check_out_at);
      })
      .toBe(true);
  });

  test("manager views team attendance", async ({ page }) => {
    await signInViaUI(page, fx.manager.email, fx.manager.password);
    await gotoApp(page, "/attendance/team");
    await expectPageMarker(page, "attendance-team");
  });

  test("HR views dashboard and adjusts record", async ({ page }) => {
    await signInViaUI(page, fx.hr.email, fx.hr.password);
    await gotoApp(page, "/hr/attendance");
    await expectPageMarker(page, "attendance-hr-dashboard");

    const admin = adminClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data: rec } = await admin
      .from("attendance_records")
      .select("id, check_in_at, check_out_at")
      .eq("employee_id", fx.employee.employeeId)
      .eq("attendance_date", today)
      .single();

    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await client.auth.signInWithPassword({ email: fx.hr.email, password: fx.hr.password });
    const { error } = await client.rpc("adjust_attendance_record", {
      p_record_id: rec!.id,
      p_check_in: rec!.check_in_at,
      p_check_out: rec!.check_out_at,
      p_status: "present",
      p_notes: "e2e note",
      p_reason: "e2e adjustment",
    });
    expect(error).toBeNull();

    const { data: hist } = await admin
      .from("attendance_adjustments")
      .select("id")
      .eq("attendance_record_id", rec!.id)
      .eq("reason", "e2e adjustment");
    expect((hist ?? []).length).toBeGreaterThanOrEqual(1);

    await gotoApp(page, "/hr/attendance/adjustments");
    await expectPageMarker(page, "attendance-adjustments");
  });
});
