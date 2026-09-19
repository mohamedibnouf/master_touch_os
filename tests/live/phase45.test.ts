import "../setup-env";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  liveTestConfigured,
  provisionLiveFixture,
  signInAs,
  type LiveFixture,
} from "./helpers";

const configured = liveTestConfigured();

function uniqueEmployeeNumber(tag: string, runSuffix: string): string {
  return `45${tag}${runSuffix}`.slice(0, 32);
}

/** Production check: year >= 2000 AND year <= 2100. Stay in far-future fixture band. */
const FIXTURE_YEAR_MIN = 2085;
const FIXTURE_YEAR_MAX = 2099;
const THIRTY_DAY_MONTHS = [4, 6, 9, 11] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string | null | undefined, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error(`${label} missing or invalid UUID (got ${JSON.stringify(value)})`);
  }
  return value;
}

function hashSuffix(runSuffix: string): number {
  let h = 0;
  for (let i = 0; i < runSuffix.length; i++) h = (h * 31 + runSuffix.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Pick year/month inside production constraint, preferring free (org, year, month)
 * slots so reruns do not collide with locked leftovers. Never widens DB checks.
 */
async function allocateFixturePeriodSlot(
  admin: SupabaseClient,
  orgId: string,
  runSuffix: string,
): Promise<{ year: number; month: number; hash: number }> {
  const h = hashSuffix(runSuffix);
  const yearSpan = FIXTURE_YEAR_MAX - FIXTURE_YEAR_MIN + 1;
  const slotCount = yearSpan * THIRTY_DAY_MONTHS.length;

  for (let i = 0; i < slotCount; i++) {
    const idx = (h + i) % slotCount;
    const year = FIXTURE_YEAR_MIN + Math.floor(idx / THIRTY_DAY_MONTHS.length);
    const month = THIRTY_DAY_MONTHS[idx % THIRTY_DAY_MONTHS.length];
    const { data: existing, error } = await admin
      .from("payroll_periods")
      .select("id")
      .eq("organization_id", orgId)
      .eq("year", year)
      .eq("month", month)
      .neq("status", "cancelled")
      .maybeSingle();
    if (error) {
      throw new Error(`allocateFixturePeriodSlot query failed: ${error.message}`);
    }
    if (!existing) return { year, month, hash: h };
  }

  throw new Error(
    `No free payroll period slot in fixture band ${FIXTURE_YEAR_MIN}-${FIXTURE_YEAR_MAX} (months ${THIRTY_DAY_MONTHS.join(",")}).`,
  );
}

async function cleanupTrackedPayrollPeriods(admin: SupabaseClient, periodIds: string[]) {
  for (const id of periodIds) {
    if (!UUID_RE.test(id)) continue;
    try {
      const { data: period } = await admin
        .from("payroll_periods")
        .select("id, status")
        .eq("id", id)
        .maybeSingle();
      if (!period) continue;

      // Prefer cancel for draft/calculated (immutable trigger blocks delete when locked/paid).
      if (period.status === "draft" || period.status === "calculated") {
        await admin
          .from("payroll_periods")
          .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
          .eq("id", id);
        continue;
      }

      // Locked/paid fixture rows cannot be deleted by immutability triggers — leave them;
      // allocateFixturePeriodSlot skips occupied slots on the next run.
    } catch {
      /* best-effort */
    }
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

const BASE_SALARY = 10_000;
const HOUSING = 2_500;
const TRANSPORT = 500;

describe.skipIf(!configured)("live Phase 4.5 payroll management", () => {
  let fx: LiveFixture;
  let phase45Ready = false;
  let admin: SupabaseClient;
  let hrClient: SupabaseClient;
  let finClient: SupabaseClient;
  let empClient: SupabaseClient;
  let peerClient: SupabaseClient;
  let crossClient: SupabaseClient;

  let hrUserId = "";
  let empEmployeeId = "";
  let peerEmployeeId = "";
  let crossEmployeeId = "";
  let periodId = "";
  let empEntryId = "";
  let peerEntryId = "";
  let manualEarningId = "";
  let annualLeaveTypeId = "";
  let unpaidLeaveTypeId = "";
  let periodYear = 2090;
  let periodMonth = 4;
  let periodHash = 0;

  const createdUserIds: string[] = [];
  const createdPeriodIds: string[] = [];
  const runSuffix = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

  async function refreshPayrollEntryIds(label: string) {
    const pid = requireUuid(periodId, `periodId (${label})`);
    const { data: empEntry, error: empErr } = await admin
      .from("payroll_entries")
      .select("id")
      .eq("payroll_period_id", pid)
      .eq("employee_id", empEmployeeId)
      .maybeSingle();
    if (empErr) throw new Error(`refresh emp entry (${label}): ${empErr.message}`);
    empEntryId = requireUuid(empEntry?.id, `empEntryId after ${label}`);

    const { data: peerEntry, error: peerErr } = await admin
      .from("payroll_entries")
      .select("id")
      .eq("payroll_period_id", pid)
      .eq("employee_id", peerEmployeeId)
      .maybeSingle();
    if (peerErr) throw new Error(`refresh peer entry (${label}): ${peerErr.message}`);
    peerEntryId = requireUuid(peerEntry?.id, `peerEntryId after ${label}`);
  }

  beforeAll(async () => {
    admin = adminClient();

    const { error: periodErr } = await admin.from("payroll_periods").select("id").limit(1);
    const { data: prepPerm } = await admin
      .from("permissions")
      .select("key")
      .eq("key", "payroll.prepare")
      .maybeSingle();
    phase45Ready = !periodErr && Boolean(prepPerm?.key);

    if (!phase45Ready) {
      throw new Error(
        "Phase 4.5 live suite blocked: apply supabase/phase4_fix_059.sql in Supabase SQL Editor, then re-run.",
      );
    }

    fx = await provisionLiveFixture();
    const prefix = process.env.LIVE_TEST_PASSWORD_PREFIX ?? "MtTest1!";
    const period = await allocateFixturePeriodSlot(admin, fx.orgAId, runSuffix);
    periodYear = period.year;
    periodMonth = period.month;
    periodHash = period.hash;
    if (periodYear < 2000 || periodYear > 2100) {
      throw new Error(`Fixture year ${periodYear} violates payroll_periods_year_check (2000..2100)`);
    }
    const joinDate = ymd(periodYear - 1, 1, 1);
    const compFrom = ymd(periodYear, periodMonth, 1);

    async function createWithRole(
      email: string,
      password: string,
      roleCode: string,
      empTag: "HR" | "FIN" | "EMP" | "PEER",
      orgId: string,
    ) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name_ar: roleCode, full_name_en: roleCode, locale: "ar" },
      });
      if (error || !created.user) throw new Error(`createUser ${email}: ${error?.message}`);
      const userId = created.user.id;
      createdUserIds.push(userId);

      await admin.from("organization_members").upsert({
        organization_id: orgId,
        profile_id: userId,
        status: "active",
      });

      const { data: emp, error: empErr } = await admin
        .from("employees")
        .upsert(
          {
            organization_id: orgId,
            profile_id: userId,
            employment_status: "active",
            is_active: true,
            employee_number: uniqueEmployeeNumber(empTag, runSuffix),
            joining_date: joinDate,
          },
          { onConflict: "organization_id,profile_id" },
        )
        .select("id")
        .single<{ id: string }>();
      if (empErr || !emp) throw new Error(`emp ${email}: ${empErr?.message}`);

      const { data: role } = await admin
        .from("roles")
        .select("id")
        .eq("code", roleCode)
        .is("organization_id", null)
        .maybeSingle();
      if (role?.id) {
        await admin.from("user_roles").insert({
          organization_id: orgId,
          profile_id: userId,
          role_id: role.id,
          scope_type: "organization",
        });
      }
      return { userId, employeeId: emp.id };
    }

    const hr = await createWithRole(
      `mt-live-hr45-${runSuffix}@test.local`,
      `${prefix}hr45`,
      "hr_manager",
      "HR",
      fx.orgAId,
    );
    const fin = await createWithRole(
      `mt-live-fin45-${runSuffix}@test.local`,
      `${prefix}fin45`,
      "finance_manager",
      "FIN",
      fx.orgAId,
    );
    const emp = await createWithRole(
      `mt-live-emp45-${runSuffix}@test.local`,
      `${prefix}emp45`,
      "engineer",
      "EMP",
      fx.orgAId,
    );
    const peer = await createWithRole(
      `mt-live-peer45-${runSuffix}@test.local`,
      `${prefix}peer45`,
      "engineer",
      "PEER",
      fx.orgAId,
    );

    // Cross-org user (org B only)
    const { data: crossCreated, error: crossErr } = await admin.auth.admin.createUser({
      email: `mt-live-xorg45-${runSuffix}@test.local`,
      password: `${prefix}xorg45`,
      email_confirm: true,
      user_metadata: { full_name_ar: "cross", full_name_en: "cross", locale: "ar" },
    });
    if (crossErr || !crossCreated.user) throw new Error(`cross user: ${crossErr?.message}`);
    createdUserIds.push(crossCreated.user.id);
    await admin.from("organization_members").upsert({
      organization_id: fx.orgBId,
      profile_id: crossCreated.user.id,
      status: "active",
    });
    const { data: crossEmp, error: crossEmpErr } = await admin
      .from("employees")
      .insert({
        organization_id: fx.orgBId,
        profile_id: crossCreated.user.id,
        employment_status: "active",
        is_active: true,
        employee_number: uniqueEmployeeNumber("XORG", runSuffix),
        joining_date: joinDate,
      })
      .select("id")
      .single<{ id: string }>();
    if (crossEmpErr || !crossEmp) throw new Error(`cross emp: ${crossEmpErr?.message}`);
    crossEmployeeId = crossEmp.id;

    const { data: engRole } = await admin
      .from("roles")
      .select("id")
      .eq("code", "engineer")
      .is("organization_id", null)
      .maybeSingle();
    if (engRole?.id) {
      await admin.from("user_roles").insert({
        organization_id: fx.orgBId,
        profile_id: crossCreated.user.id,
        role_id: engRole.id,
        scope_type: "organization",
      });
    }

    hrUserId = hr.userId;
    empEmployeeId = emp.employeeId;
    peerEmployeeId = peer.employeeId;

    async function seedPayrollEmployee(employeeId: string, basic: number) {
      const { error: cErr } = await admin.from("employee_contracts").insert({
        organization_id: fx.orgAId,
        employee_id: employeeId,
        contract_number: `CTR45-${employeeId.slice(0, 8)}-${runSuffix}`.slice(0, 40),
        contract_type: "permanent",
        status: "active",
        start_date: joinDate,
        is_current: true,
        created_by: hrUserId,
        initial_basic_salary: basic,
      });
      if (cErr) throw new Error(`contract ${employeeId}: ${cErr.message}`);

      const { error: vErr } = await admin.from("employee_compensation_versions").insert({
        organization_id: fx.orgAId,
        employee_id: employeeId,
        effective_from: compFrom,
        effective_to: null,
        currency: "SAR",
        basic_salary: basic,
        housing_allowance: HOUSING,
        transport_allowance: TRANSPORT,
        other_allowances: 0,
        status: "active",
        created_by: hrUserId,
        change_reason: "phase45 fixture",
      });
      if (vErr) throw new Error(`comp ${employeeId}: ${vErr.message}`);

      const { error: bErr } = await admin.from("employee_bank_accounts").insert({
        organization_id: fx.orgAId,
        employee_id: employeeId,
        bank_name: "Al Rajhi",
        iban: `SA0380000000608010${employeeId.replace(/-/g, "").slice(0, 8)}`.slice(0, 24).padEnd(24, "0"),
        account_name: "Phase45 Employee",
        is_primary: true,
        is_active: true,
        created_by: hrUserId,
      });
      if (bErr) throw new Error(`bank ${employeeId}: ${bErr.message}`);
    }

    await seedPayrollEmployee(empEmployeeId, BASE_SALARY);
    await seedPayrollEmployee(peerEmployeeId, 8_000);

    // Cross-org compensation (must not appear in orgA payroll)
    await admin.from("employee_compensation_versions").insert({
      organization_id: fx.orgBId,
      employee_id: crossEmployeeId,
      effective_from: compFrom,
      currency: "SAR",
      basic_salary: 9_000,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
      status: "active",
      created_by: crossCreated.user.id,
    });

    let { data: annual } = await admin
      .from("leave_types")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("code", "ANNUAL")
      .maybeSingle();
    if (!annual?.id) {
      const { data: inserted } = await admin
        .from("leave_types")
        .insert({
          organization_id: fx.orgAId,
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
        .single();
      annual = inserted;
    }
    annualLeaveTypeId = annual?.id ?? "";

    let { data: unpaid } = await admin
      .from("leave_types")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("code", "UNPAID")
      .maybeSingle();
    if (!unpaid?.id) {
      const { data: inserted } = await admin
        .from("leave_types")
        .insert({
          organization_id: fx.orgAId,
          code: "UNPAID",
          name_ar: "إجازة بدون راتب",
          name_en: "Unpaid Leave",
          is_paid: false,
          annual_entitlement_days: 0,
          requires_attachment: false,
          minimum_notice_days: 0,
          is_active: true,
        })
        .select("id")
        .single();
      unpaid = inserted;
    } else {
      await admin.from("leave_types").update({ is_paid: false }).eq("id", unpaid.id);
    }
    unpaidLeaveTypeId = unpaid?.id ?? "";

    hrClient = await signInAs(`mt-live-hr45-${runSuffix}@test.local`, `${prefix}hr45`);
    finClient = await signInAs(`mt-live-fin45-${runSuffix}@test.local`, `${prefix}fin45`);
    empClient = await signInAs(`mt-live-emp45-${runSuffix}@test.local`, `${prefix}emp45`);
    peerClient = await signInAs(`mt-live-peer45-${runSuffix}@test.local`, `${prefix}peer45`);
    crossClient = await signInAs(`mt-live-xorg45-${runSuffix}@test.local`, `${prefix}xorg45`);

    // Ensure unpaid-leave deduction setting is on for this org
    await hrClient.rpc("update_payroll_settings", {
      p_organization_id: fx.orgAId,
      p_deduct_unpaid_leave: true,
    });
  }, 180_000);

  afterAll(async () => {
    if (!admin) return;
    await cleanupTrackedPayrollPeriods(admin, createdPeriodIds);
    for (const userId of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        /* best-effort */
      }
    }
    if (fx?.cleanup) {
      try {
        await fx.cleanup();
      } catch {
        /* best-effort */
      }
    }
  }, 60_000);

  it("01 — schema + permissions exist", async () => {
    expect(phase45Ready).toBe(true);
    const { data: perms } = await admin.from("permissions").select("key").like("key", "payroll.%");
    const keys = (perms ?? []).map((p) => p.key);
    for (const k of [
      "payroll.view_self",
      "payroll.view_all",
      "payroll.prepare",
      "payroll.calculate",
      "payroll.review",
      "payroll.approve",
      "payroll.lock",
      "payroll.adjust",
      "payroll.record_payment",
      "payroll.manage_settings",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("02 — create payroll period", async () => {
    let { data, error } = await hrClient.rpc("create_payroll_period", {
      p_organization_id: fx.orgAId,
      p_year: periodYear,
      p_month: periodMonth,
    });

    // Cancel a leftover draft/calculated period for this year/month, then retry once.
    if (error && /CONFLICT/i.test(error.message ?? "")) {
      const { data: existing } = await admin
        .from("payroll_periods")
        .select("id, status")
        .eq("organization_id", fx.orgAId)
        .eq("year", periodYear)
        .eq("month", periodMonth)
        .neq("status", "cancelled")
        .maybeSingle();
      if (existing && (existing.status === "draft" || existing.status === "calculated")) {
        await hrClient.rpc("cancel_payroll_period", {
          p_period_id: existing.id,
          p_reason: "phase45 reclaim slot",
        });
        ({ data, error } = await hrClient.rpc("create_payroll_period", {
          p_organization_id: fx.orgAId,
          p_year: periodYear,
          p_month: periodMonth,
        }));
      }
    }

    if (error || !data?.id) {
      throw new Error(
        `create_payroll_period failed: ${error?.message ?? "no id returned"} ` +
          `(code=${error?.code ?? "n/a"}) year=${periodYear} month=${periodMonth}`,
      );
    }

    expect(data.status).toBe("draft");
    expect(data.year).toBe(periodYear);
    expect(data.month).toBe(periodMonth);
    periodId = requireUuid(data.id as string, "periodId");
    createdPeriodIds.push(periodId);
  });

  it("03 — employee eligibility (calculate includes compensated employee)", async () => {
    const pid = requireUuid(periodId, "periodId — test 02 must succeed first");
    const { data, error } = await hrClient.rpc("calculate_payroll_period", {
      p_period_id: pid,
    });
    if (error) {
      throw new Error(`calculate_payroll_period failed: ${error.message} (code=${error.code})`);
    }
    expect(data?.status).toBe("calculated");

    const { data: entry } = await admin
      .from("payroll_entries")
      .select("id, employee_id, base_salary, net_pay")
      .eq("payroll_period_id", pid)
      .eq("employee_id", empEmployeeId)
      .maybeSingle();
    if (!entry?.id) {
      throw new Error("calculate produced no payroll_entries row for empEmployeeId");
    }
    empEntryId = requireUuid(entry.id as string, "empEntryId");

    const { data: peerEntry } = await admin
      .from("payroll_entries")
      .select("id")
      .eq("payroll_period_id", pid)
      .eq("employee_id", peerEmployeeId)
      .maybeSingle();
    if (!peerEntry?.id) {
      throw new Error("calculate produced no payroll_entries row for peerEmployeeId");
    }
    peerEntryId = requireUuid(peerEntry.id as string, "peerEntryId");
  });

  it("04 — compensation snapshot (entry base_salary matches)", async () => {
    const { data: entry } = await admin
      .from("payroll_entries")
      .select("base_salary, housing_allowance, transport_allowance, primary_compensation_version_id")
      .eq("id", empEntryId)
      .single();

    const { data: seg } = await admin
      .from("payroll_entry_segments")
      .select("basic_salary, housing_allowance, transport_allowance")
      .eq("payroll_entry_id", empEntryId)
      .order("segment_start")
      .limit(1)
      .maybeSingle();

    expect(Number(seg?.basic_salary)).toBe(BASE_SALARY);
    expect(Number(seg?.housing_allowance)).toBe(HOUSING);
    expect(Number(seg?.transport_allowance)).toBe(TRANSPORT);
    // 30-day month + standard_payable_days=30 → prorated base equals monthly basic
    expect(Number(entry?.base_salary)).toBe(BASE_SALARY);
  });

  it("05 — mid-period compensation yields >=2 segments", async () => {
    const midFrom = ymd(periodYear, periodMonth, 15);
    const { error: v2Err } = await hrClient.rpc("create_employee_compensation_version", {
      p_organization_id: fx.orgAId,
      p_employee_id: empEmployeeId,
      p_effective_from: midFrom,
      p_currency: "SAR",
      p_basic_salary: BASE_SALARY + 2_000,
      p_housing_allowance: HOUSING,
      p_transport_allowance: TRANSPORT,
      p_other_allowances: 0,
      p_change_reason: "mid-period raise phase45",
    });
    expect(v2Err).toBeNull();

    const { error } = await hrClient.rpc("calculate_payroll_period", { p_period_id: periodId });
    expect(error).toBeNull();
    await refreshPayrollEntryIds("05 mid-period calculate");

    const { data: segments } = await admin
      .from("payroll_entry_segments")
      .select("id")
      .eq("payroll_entry_id", empEntryId);
    expect((segments ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("06 — paid leave does not create UNPAID_LEAVE deduction", async () => {
    if (!annualLeaveTypeId) return;

    const leaveDay = ymd(periodYear, periodMonth, 2);
    await admin.from("leave_requests").insert({
      organization_id: fx.orgAId,
      employee_id: empEmployeeId,
      leave_type_id: annualLeaveTypeId,
      start_date: leaveDay,
      end_date: leaveDay,
      total_days: 1,
      status: "approved",
      approval_stage: "complete",
      reason: "phase45 paid leave",
      submitted_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      created_by: hrUserId,
    });

    const { error } = await hrClient.rpc("calculate_payroll_period", { p_period_id: periodId });
    expect(error).toBeNull();
    await refreshPayrollEntryIds("06 paid leave calculate");

    const { data: unpaidDed } = await admin
      .from("payroll_deductions")
      .select("id")
      .eq("payroll_entry_id", empEntryId)
      .eq("code", "UNPAID_LEAVE");
    expect((unpaidDed ?? []).length).toBe(0);
  });

  it("07 — unpaid leave creates UNPAID_LEAVE deduction", async () => {
    if (!unpaidLeaveTypeId) return;

    await hrClient.rpc("update_payroll_settings", {
      p_organization_id: fx.orgAId,
      p_deduct_unpaid_leave: true,
    });

    const start = ymd(periodYear, periodMonth, 5);
    const end = ymd(periodYear, periodMonth, 6);
    await admin.from("leave_requests").insert({
      organization_id: fx.orgAId,
      employee_id: empEmployeeId,
      leave_type_id: unpaidLeaveTypeId,
      start_date: start,
      end_date: end,
      total_days: 2,
      status: "approved",
      approval_stage: "complete",
      reason: "phase45 unpaid leave",
      submitted_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      created_by: hrUserId,
    });

    const { error } = await hrClient.rpc("calculate_payroll_period", { p_period_id: periodId });
    expect(error).toBeNull();
    await refreshPayrollEntryIds("07 unpaid leave calculate");

    const { data: unpaidDed } = await admin
      .from("payroll_deductions")
      .select("id, amount")
      .eq("payroll_entry_id", empEntryId)
      .eq("code", "UNPAID_LEAVE");
    expect((unpaidDed ?? []).length).toBeGreaterThanOrEqual(1);
    expect(Number(unpaidDed![0].amount)).toBeGreaterThan(0);
  });

  it("08 — attendance input snapped on entry", async () => {
    await refreshPayrollEntryIds("08 precondition");
    const { data: entry } = await admin
      .from("payroll_entries")
      .select("present_days, absent_days, leave_days, unpaid_leave_days")
      .eq("id", empEntryId)
      .single();
    expect(entry).toBeTruthy();
    expect(Number(entry!.present_days)).toBeGreaterThanOrEqual(0);
    expect(Number(entry!.absent_days)).toBeGreaterThanOrEqual(0);
    expect(Number(entry!.unpaid_leave_days)).toBeGreaterThanOrEqual(0);
  });

  it("09 — manual earning and deduction", async () => {
    await refreshPayrollEntryIds("09 precondition");
    const { data: earning, error: eErr } = await hrClient.rpc("add_payroll_manual_earning", {
      p_entry_id: empEntryId,
      p_code: "BONUS",
      p_description_ar: "مكافأة",
      p_description_en: "Bonus",
      p_amount: 500,
      p_reason: "phase45 manual earning",
    });
    expect(eErr).toBeNull();
    expect(earning?.id).toBeTruthy();
    expect(earning?.is_manual).toBe(true);
    manualEarningId = requireUuid(earning!.id as string, "manualEarningId");

    const { data: deduction, error: dErr } = await hrClient.rpc("add_payroll_manual_deduction", {
      p_entry_id: empEntryId,
      p_code: "ADVANCE",
      p_description_ar: "سلفة",
      p_description_en: "Advance",
      p_amount: 100,
      p_reason: "phase45 manual deduction",
    });
    expect(dErr).toBeNull();
    expect(deduction?.id).toBeTruthy();
    expect(deduction?.is_manual).toBe(true);
  });

  it("10 — recalculation before lock preserves manual lines", async () => {
    const { error: first } = await hrClient.rpc("calculate_payroll_period", { p_period_id: periodId });
    expect(first).toBeNull();
    const { error: second } = await hrClient.rpc("calculate_payroll_period", { p_period_id: periodId });
    expect(second).toBeNull();
    await refreshPayrollEntryIds("10 double recalculate");

    const { data: earning } = await admin
      .from("payroll_earnings")
      .select("id, amount, is_manual")
      .eq("id", manualEarningId)
      .maybeSingle();
    expect(earning?.id).toBe(manualEarningId);
    expect(earning?.is_manual).toBe(true);
    expect(Number(earning?.amount)).toBe(500);

    const { data: manualEarnings } = await admin
      .from("payroll_earnings")
      .select("id, amount")
      .eq("payroll_entry_id", empEntryId)
      .eq("is_manual", true);
    expect(manualEarnings).toHaveLength(1);
    expect(Number(manualEarnings![0].amount)).toBe(500);

    const { data: deductions } = await admin
      .from("payroll_deductions")
      .select("id, amount")
      .eq("payroll_entry_id", empEntryId)
      .eq("code", "ADVANCE")
      .eq("is_manual", true);
    expect(deductions).toHaveLength(1);
    expect(Number(deductions![0].amount)).toBe(100);

    const { data: baseRows } = await admin
      .from("payroll_earnings")
      .select("id")
      .eq("payroll_entry_id", empEntryId)
      .eq("code", "BASE_SALARY")
      .eq("is_manual", false);
    expect((baseRows ?? []).length).toBe(1);
  });

  it("11 — unauthorized: engineer cannot select peer entry / cannot create period", async () => {
    const { data: rows } = await empClient
      .from("payroll_entries")
      .select("id")
      .eq("id", peerEntryId);
    expect(rows?.length ?? 0).toBe(0);

    const { error } = await empClient.rpc("create_payroll_period", {
      p_organization_id: fx.orgAId,
      p_year: periodYear,
      p_month: ((periodMonth % 12) + 1) as number,
    });
    expect(error).toBeTruthy();
  });

  it("12 — employee cannot see own draft/calculated entry via view_self before lock", async () => {
    const { data: before } = await empClient
      .from("payroll_entries")
      .select("id")
      .eq("id", empEntryId);
    expect(before?.length ?? 0).toBe(0);

    const { data: periodRows } = await empClient
      .from("payroll_periods")
      .select("id, status")
      .eq("id", periodId);
    expect(periodRows?.length ?? 0).toBe(0);
  });

  it("13 — cross-org isolation", async () => {
    const { data: periods } = await crossClient
      .from("payroll_periods")
      .select("id")
      .eq("id", periodId);
    expect(periods?.length ?? 0).toBe(0);

    const { data: entries } = await crossClient
      .from("payroll_entries")
      .select("id")
      .eq("id", empEntryId);
    expect(entries?.length ?? 0).toBe(0);

    const { data: orgAEntries } = await admin
      .from("payroll_entries")
      .select("id")
      .eq("payroll_period_id", periodId)
      .eq("employee_id", crossEmployeeId);
    expect(orgAEntries?.length ?? 0).toBe(0);
  });

  it("14 — approval/lock flow: submit → review → approve → lock", async () => {
    await refreshPayrollEntryIds("14 precondition");
    const { data: submitted, error: sErr } = await hrClient.rpc("submit_payroll_for_review", {
      p_period_id: periodId,
    });
    expect(sErr).toBeNull();
    expect(submitted?.status).toBe("under_review");

    const { error: rErr } = await finClient.rpc("mark_payroll_reviewed", {
      p_period_id: periodId,
    });
    expect(rErr).toBeNull();

    const { data: approved, error: aErr } = await finClient.rpc("approve_payroll_period", {
      p_period_id: periodId,
    });
    expect(aErr).toBeNull();
    expect(approved?.status).toBe("approved");

    const { data: locked, error: lErr } = await finClient.rpc("lock_payroll_period", {
      p_period_id: periodId,
    });
    expect(lErr).toBeNull();
    expect(locked?.status).toBe("locked");

    // After lock, employee can see own entry
    const { data: own } = await empClient
      .from("payroll_entries")
      .select("id, net_pay")
      .eq("id", empEntryId);
    expect((own ?? []).length).toBe(1);
    expect(Number(own![0].net_pay)).toBeGreaterThan(0);

    // Peer still cannot see employee's entry
    const { data: peerView } = await peerClient
      .from("payroll_entries")
      .select("id")
      .eq("id", empEntryId);
    expect(peerView?.length ?? 0).toBe(0);
  });

  it("15 — locked immutability", async () => {
    const { data: before } = await admin
      .from("payroll_entries")
      .select("net_pay")
      .eq("id", empEntryId)
      .single();
    const netBefore = Number(before!.net_pay);

    const { error: calcErr } = await hrClient.rpc("calculate_payroll_period", {
      p_period_id: periodId,
    });
    expect(calcErr).toBeTruthy();

    // Direct update via authenticated client (RLS write=false) or admin trigger
    const { data: mutRows, error: mutErr } = await hrClient
      .from("payroll_entries")
      .update({ net_pay: 1 })
      .eq("id", empEntryId)
      .select("id, net_pay");
    const updateBlocked = Boolean(mutErr) || (mutRows?.length ?? 0) === 0;
    expect(updateBlocked).toBe(true);

    // Service-role update should hit IMMUTABLE_PAYROLL trigger
    const { error: adminMutErr } = await admin
      .from("payroll_entries")
      .update({ net_pay: 1 })
      .eq("id", empEntryId);
    expect(adminMutErr).toBeTruthy();

    const { data: after } = await admin
      .from("payroll_entries")
      .select("net_pay")
      .eq("id", empEntryId)
      .single();
    expect(Number(after!.net_pay)).toBe(netBefore);

    if (manualEarningId) {
      const { data: earnBefore } = await admin
        .from("payroll_earnings")
        .select("reason, amount")
        .eq("id", manualEarningId)
        .single();
      const { data: earnMut, error: earnErr } = await hrClient
        .from("payroll_earnings")
        .update({ reason: "tamper", amount: 99999 })
        .eq("id", manualEarningId)
        .select("id");
      const earnBlocked = Boolean(earnErr) || (earnMut?.length ?? 0) === 0;
      expect(earnBlocked).toBe(true);
      const { data: earnAfter } = await admin
        .from("payroll_earnings")
        .select("reason, amount")
        .eq("id", manualEarningId)
        .single();
      expect(earnAfter?.reason).toBe(earnBefore?.reason);
      expect(Number(earnAfter?.amount)).toBe(Number(earnBefore?.amount));
    }

    const { error: adjErr } = await hrClient.rpc("add_payroll_manual_earning", {
      p_entry_id: empEntryId,
      p_code: "LATE_ADJ",
      p_description_ar: "تعديل",
      p_description_en: "Adjust",
      p_amount: 10,
      p_reason: "should fail when locked",
    });
    expect(adjErr).toBeTruthy();
  });

  it("16 — payment recording; duplicate fails", async () => {
    const { data: entry } = await admin
      .from("payroll_entries")
      .select("net_pay")
      .eq("id", empEntryId)
      .single();

    const { data: pay, error } = await finClient.rpc("record_payroll_payment", {
      p_entry_id: empEntryId,
      p_payment_date: ymd(periodYear, periodMonth, 28),
      p_method: "bank_transfer",
      p_reference: `REF45-${runSuffix}`,
      p_amount: Number(entry!.net_pay),
      p_notes: "phase45 payment",
    });
    expect(error).toBeNull();
    expect(pay?.id).toBeTruthy();

    const { error: dupErr } = await finClient.rpc("record_payroll_payment", {
      p_entry_id: empEntryId,
      p_payment_date: ymd(periodYear, periodMonth, 28),
      p_method: "bank_transfer",
      p_reference: `REF45-DUP-${runSuffix}`,
      p_amount: Number(entry!.net_pay),
      p_notes: "duplicate",
    });
    expect(dupErr).toBeTruthy();
  });

  it("17 — concurrent calculate does not duplicate entries", async () => {
    const slot = await allocateFixturePeriodSlot(admin, fx.orgAId, `${runSuffix}-concurrent`);
    const altYear = slot.year;
    const altMonth = slot.month;

    let { data: altPeriod, error: cErr } = await hrClient.rpc("create_payroll_period", {
      p_organization_id: fx.orgAId,
      p_year: altYear,
      p_month: altMonth,
    });
    if (cErr && /CONFLICT/i.test(cErr.message ?? "")) {
      const { data: existing } = await admin
        .from("payroll_periods")
        .select("id, status")
        .eq("organization_id", fx.orgAId)
        .eq("year", altYear)
        .eq("month", altMonth)
        .neq("status", "cancelled")
        .maybeSingle();
      if (existing && (existing.status === "draft" || existing.status === "calculated")) {
        await hrClient.rpc("cancel_payroll_period", {
          p_period_id: existing.id,
          p_reason: "phase45 reclaim concurrent slot",
        });
        ({ data: altPeriod, error: cErr } = await hrClient.rpc("create_payroll_period", {
          p_organization_id: fx.orgAId,
          p_year: altYear,
          p_month: altMonth,
        }));
      }
    }
    if (cErr || !altPeriod?.id) {
      throw new Error(
        `concurrent create_payroll_period failed: ${cErr?.message ?? "no id"} ` +
          `(code=${cErr?.code ?? "n/a"}) year=${altYear} month=${altMonth}`,
      );
    }
    const altId = requireUuid(altPeriod.id as string, "altPeriodId");
    createdPeriodIds.push(altId);

    const altStart = ymd(altYear, altMonth, 1);
    const altEnd = ymd(altYear, altMonth, 30);

    for (const employeeId of [empEmployeeId, peerEmployeeId]) {
      const { data: covering } = await admin
        .from("employee_compensation_versions")
        .select("id")
        .eq("employee_id", employeeId)
        .eq("organization_id", fx.orgAId)
        .in("status", ["active", "superseded"])
        .lte("effective_from", altEnd)
        .or(`effective_to.is.null,effective_to.gte.${altStart}`)
        .limit(1)
        .maybeSingle();

      if (!covering?.id) {
        const { error: covErr } = await admin.from("employee_compensation_versions").insert({
          organization_id: fx.orgAId,
          employee_id: employeeId,
          effective_from: altStart,
          effective_to: altEnd,
          currency: "SAR",
          basic_salary: BASE_SALARY,
          housing_allowance: 0,
          transport_allowance: 0,
          other_allowances: 0,
          status: "superseded",
          created_by: hrUserId,
          change_reason: "phase45 concurrent calc coverage",
        });
        if (covErr) {
          throw new Error(`concurrent compensation seed failed: ${covErr.message}`);
        }
      }
    }

    const [c1, c2] = await Promise.all([
      hrClient.rpc("calculate_payroll_period", { p_period_id: altId }),
      hrClient.rpc("calculate_payroll_period", { p_period_id: altId }),
    ]);
    if (c1.error && c2.error) {
      throw new Error(`concurrent calculate both failed: ${c1.error.message} / ${c2.error.message}`);
    }

    const { data: empRows } = await admin
      .from("payroll_entries")
      .select("id")
      .eq("payroll_period_id", altId)
      .eq("employee_id", empEmployeeId);
    expect(empRows?.length).toBe(1);

    const { data: peerRows } = await admin
      .from("payroll_entries")
      .select("id")
      .eq("payroll_period_id", altId)
      .eq("employee_id", peerEmployeeId);
    expect(peerRows?.length).toBe(1);
  });

  it("18 — concurrent payment recording is safe", async () => {
    const { data: entry } = await admin
      .from("payroll_entries")
      .select("net_pay, payment_status")
      .eq("id", peerEntryId)
      .single();
    expect(entry?.payment_status).toBe("unpaid");

    const [r1, r2] = await Promise.all([
      finClient.rpc("record_payroll_payment", {
        p_entry_id: peerEntryId,
        p_payment_date: ymd(periodYear, periodMonth, 28),
        p_method: "bank_transfer",
        p_reference: `REF45-PEER-A-${runSuffix}`,
        p_amount: Number(entry!.net_pay),
        p_notes: "concurrent A",
      }),
      finClient.rpc("record_payroll_payment", {
        p_entry_id: peerEntryId,
        p_payment_date: ymd(periodYear, periodMonth, 28),
        p_method: "bank_transfer",
        p_reference: `REF45-PEER-B-${runSuffix}`,
        p_amount: Number(entry!.net_pay),
        p_notes: "concurrent B",
      }),
    ]);

    const successes = [r1, r2].filter((r) => !r.error);
    const failures = [r1, r2].filter((r) => r.error);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const { data: payments } = await admin
      .from("payroll_payments")
      .select("id")
      .eq("payroll_entry_id", peerEntryId);
    expect(payments?.length).toBe(1);
  });
});
