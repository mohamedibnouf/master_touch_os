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

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

/** Compact unique employee_number (org unique; keep ≤32 chars). */
function uniqueEmployeeNumber(tag: string, runSuffix: string): string {
  return `43${tag}${runSuffix}`.slice(0, 32);
}

describe.skipIf(!configured)("live Phase 4.3 leave management", () => {
  let fx: LiveFixture;
  let phase43Ready = false;
  let admin: SupabaseClient;
  let hrClient: SupabaseClient;
  let mgrClient: SupabaseClient;
  let empClient: SupabaseClient;
  let peerClient: SupabaseClient;

  let hrEmployeeId = "";
  let mgrEmployeeId = "";
  let empEmployeeId = "";
  let peerEmployeeId = "";
  let annualTypeId = "";
  let unpaidTypeId = "";

  const createdUserIds: string[] = [];
  const createdEmails: string[] = [];
  const runSuffix = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

  beforeAll(async () => {
    admin = adminClient();

    const { error: typesErr } = await admin.from("leave_types").select("id").limit(1);
    const { error: reqErr } = await admin.from("leave_requests").select("id").limit(1);
    const { error: balErr } = await admin.from("employee_leave_balances").select("id").limit(1);
    phase43Ready = !typesErr && !reqErr && !balErr;

    if (!phase43Ready) {
      console.warn(
        "[live-test] Phase 4.3 requires migration 056 (supabase/phase4_fix_056.sql). Skipping until applied.",
      );
      throw new Error(
        "Phase 4.3 live suite blocked: apply supabase/phase4_fix_056.sql in Supabase SQL Editor, then re-run.",
      );
    }

    fx = await provisionLiveFixture();
    const prefix = process.env.LIVE_TEST_PASSWORD_PREFIX ?? "MtTest1!";

    async function createWithRole(
      email: string,
      password: string,
      roleCode: string,
      empTag: "HR" | "MGR" | "EMP" | "PEER",
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
      createdEmails.push(email);

      await admin.from("organization_members").upsert({
        organization_id: fx.orgAId,
        profile_id: userId,
        status: "active",
      });

      const employeeNumber = uniqueEmployeeNumber(empTag, runSuffix);
      const { data: emp, error: empErr } = await admin
        .from("employees")
        .upsert(
          {
            organization_id: fx.orgAId,
            profile_id: userId,
            employment_status: "active",
            is_active: true,
            employee_number: employeeNumber,
          },
          { onConflict: "organization_id,profile_id" },
        )
        .select("id")
        .single<{ id: string }>();
      if (empErr) throw new Error(`emp ${email} (${employeeNumber}): ${empErr.message}`);

      const { data: role } = await admin
        .from("roles")
        .select("id")
        .eq("code", roleCode)
        .is("organization_id", null)
        .maybeSingle();
      if (role?.id) {
        await admin.from("user_roles").insert({
          organization_id: fx.orgAId,
          profile_id: userId,
          role_id: role.id,
          scope_type: "organization",
        });
      }
      return { userId, employeeId: emp.id };
    }

    const hrEmail = `mt-live-hr43-${runSuffix}@test.local`;
    const mgrEmail = `mt-live-mgr43-${runSuffix}@test.local`;
    const empEmail = `mt-live-emp43-${runSuffix}@test.local`;
    const peerEmail = `mt-live-peer43-${runSuffix}@test.local`;

    const hr = await createWithRole(hrEmail, `${prefix}hr43`, "hr_manager", "HR");
    const mgr = await createWithRole(mgrEmail, `${prefix}mgr43`, "department_manager", "MGR");
    const emp = await createWithRole(empEmail, `${prefix}emp43`, "engineer", "EMP");
    const peer = await createWithRole(peerEmail, `${prefix}peer43`, "engineer", "PEER");

    hrEmployeeId = hr.employeeId;
    mgrEmployeeId = mgr.employeeId;
    empEmployeeId = emp.employeeId;
    peerEmployeeId = peer.employeeId;

    await admin
      .from("employees")
      .update({ direct_manager_employee_id: mgrEmployeeId })
      .eq("id", empEmployeeId);

    const { data: types } = await admin
      .from("leave_types")
      .select("id, code")
      .eq("organization_id", fx.orgAId);
    annualTypeId = types?.find((t) => t.code === "ANNUAL")?.id ?? "";
    unpaidTypeId = types?.find((t) => t.code === "UNPAID")?.id ?? "";
    if (!annualTypeId) {
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
      annualTypeId = inserted?.id ?? "";
    }

    await admin.from("employee_leave_balances").upsert(
      {
        organization_id: fx.orgAId,
        employee_id: empEmployeeId,
        leave_type_id: annualTypeId,
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

    hrClient = await signInAs(hrEmail, `${prefix}hr43`);
    mgrClient = await signInAs(mgrEmail, `${prefix}mgr43`);
    empClient = await signInAs(empEmail, `${prefix}emp43`);
    peerClient = await signInAs(peerEmail, `${prefix}peer43`);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    // Only delete auth users created by this run (cascades memberships/employees where FKs allow).
    for (const userId of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        /* best-effort */
      }
    }
    // Fallback by email if id delete missed
    for (const email of createdEmails) {
      try {
        const { data: listed } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const match = listed?.users.find((u) => u.email === email);
        if (match) await admin.auth.admin.deleteUser(match.id);
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

  it("01 — confirms leave tables and permissions", async () => {
    expect(phase43Ready, "Apply supabase/phase4_fix_056.sql before live Phase 4.3 gates").toBe(true);
    expect(annualTypeId).toBeTruthy();
    const { data: perms } = await admin.from("permissions").select("key").like("key", "leave.%");
    expect((perms ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it("02 — employee submits leave; peer cannot read; manager and HR can", async () => {
    expect(phase43Ready).toBe(true);

    const start = futureDate(14);
    const end = futureDate(16);

    const { data: submitted, error } = await empClient.rpc("submit_leave_request", {
      p_leave_type_id: annualTypeId,
      p_start_date: start,
      p_end_date: end,
      p_reason: "live test leave",
      p_attachment_document_id: null,
      p_request_id: null,
    });
    expect(error).toBeNull();
    expect(submitted?.status).toBe("submitted");
    expect(submitted?.approval_stage).toBe("manager");
    expect(Number(submitted?.total_days)).toBe(3);

    const requestId = submitted.id as string;

    const { data: peerRows } = await peerClient
      .from("leave_requests")
      .select("id")
      .eq("id", requestId);
    expect(peerRows?.length ?? 0).toBe(0);

    const { data: mgrRows } = await mgrClient.from("leave_requests").select("id, status").eq("id", requestId);
    expect(mgrRows?.length).toBe(1);

    const { data: hrRows } = await hrClient.from("leave_requests").select("id").eq("id", requestId);
    expect(hrRows?.length).toBe(1);

    (globalThis as { __leave43RequestId?: string }).__leave43RequestId = requestId;
  });

  it("03 — overlap and balance reservation; manager then HR approve", async () => {
    expect(phase43Ready).toBe(true);
    const requestId = (globalThis as { __leave43RequestId?: string }).__leave43RequestId;
    expect(requestId).toBeTruthy();

    const { data: bal } = await admin
      .from("employee_leave_balances")
      .select("pending_days, used_days, available_days")
      .eq("employee_id", empEmployeeId)
      .eq("leave_type_id", annualTypeId)
      .eq("year", new Date().getUTCFullYear())
      .single();
    expect(Number(bal?.pending_days)).toBeGreaterThanOrEqual(3);

    const start = futureDate(14);
    const end = futureDate(15);
    const { error: overlapErr } = await empClient.rpc("submit_leave_request", {
      p_leave_type_id: annualTypeId,
      p_start_date: start,
      p_end_date: end,
      p_reason: "overlap",
      p_attachment_document_id: null,
      p_request_id: null,
    });
    expect(overlapErr).toBeTruthy();

    const { data: afterMgr, error: mgrErr } = await mgrClient.rpc("decide_leave_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_comment: "mgr ok",
    });
    expect(mgrErr).toBeNull();
    expect(afterMgr?.status).toBe("submitted");
    expect(afterMgr?.approval_stage).toBe("hr");

    const { data: afterHr, error: hrErr } = await hrClient.rpc("decide_leave_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_comment: "hr ok",
    });
    expect(hrErr).toBeNull();
    expect(afterHr?.status).toBe("approved");

    const { data: bal2 } = await admin
      .from("employee_leave_balances")
      .select("pending_days, used_days")
      .eq("employee_id", empEmployeeId)
      .eq("leave_type_id", annualTypeId)
      .eq("year", new Date().getUTCFullYear())
      .single();
    expect(Number(bal2?.used_days)).toBeGreaterThanOrEqual(3);
    expect(Number(bal2?.pending_days)).toBe(0);
  });

  it("04 — reject releases pending; cancel works; adjust_balance audits", async () => {
    expect(phase43Ready).toBe(true);

    const start = futureDate(30);
    const end = futureDate(31);
    const { data: submitted, error } = await empClient.rpc("submit_leave_request", {
      p_leave_type_id: annualTypeId,
      p_start_date: start,
      p_end_date: end,
      p_reason: "to reject",
      p_attachment_document_id: null,
      p_request_id: null,
    });
    expect(error).toBeNull();

    const { data: rejected, error: rejErr } = await mgrClient.rpc("decide_leave_request", {
      p_request_id: submitted.id,
      p_decision: "rejected",
      p_comment: "no",
    });
    expect(rejErr).toBeNull();
    expect(rejected?.status).toBe("rejected");

    const { data: cancelable, error: sub2Err } = await empClient.rpc("submit_leave_request", {
      p_leave_type_id: annualTypeId,
      p_start_date: futureDate(40),
      p_end_date: futureDate(40),
      p_reason: "to cancel",
      p_attachment_document_id: null,
      p_request_id: null,
    });
    expect(sub2Err).toBeNull();

    const { data: cancelled, error: cancelErr } = await empClient.rpc("cancel_leave_request", {
      p_request_id: cancelable.id,
    });
    expect(cancelErr).toBeNull();
    expect(cancelled?.status).toBe("cancelled");

    const { error: adjErr } = await hrClient.rpc("adjust_leave_balance", {
      p_employee_id: empEmployeeId,
      p_leave_type_id: annualTypeId,
      p_year: new Date().getUTCFullYear(),
      p_adjustment_days: 1,
      p_reason: "live test adjustment",
    });
    expect(adjErr).toBeNull();

    const { data: adj } = await admin
      .from("leave_balance_adjustments")
      .select("id, adjustment_days")
      .eq("employee_id", empEmployeeId)
      .eq("reason", "live test adjustment")
      .maybeSingle();
    expect(adj?.id).toBeTruthy();
    expect(Number(adj?.adjustment_days)).toBe(1);

    void unpaidTypeId;
    void hrEmployeeId;
    void peerEmployeeId;
  });

  it("05 — concurrent submit cannot overspend balance", async () => {
    expect(phase43Ready).toBe(true);

    const year = new Date().getUTCFullYear();
    await admin.from("employee_leave_balances").upsert(
      {
        organization_id: fx.orgAId,
        employee_id: empEmployeeId,
        leave_type_id: annualTypeId,
        year,
        opening_balance: 0,
        entitled_days: 2,
        carried_forward_days: 0,
        used_days: 0,
        pending_days: 0,
        adjustment_days: 0,
      },
      { onConflict: "employee_id,leave_type_id,year" },
    );

    const aStart = futureDate(50);
    const bStart = futureDate(60);
    const [r1, r2] = await Promise.all([
      empClient.rpc("submit_leave_request", {
        p_leave_type_id: annualTypeId,
        p_start_date: aStart,
        p_end_date: aStart,
        p_reason: "race-a",
        p_attachment_document_id: null,
        p_request_id: null,
      }),
      empClient.rpc("submit_leave_request", {
        p_leave_type_id: annualTypeId,
        p_start_date: bStart,
        p_end_date: futureDate(61),
        p_reason: "race-b",
        p_attachment_document_id: null,
        p_request_id: null,
      }),
    ]);

    const okCount = [r1, r2].filter((r) => !r.error && r.data).length;
    const failCount = [r1, r2].filter((r) => r.error).length;
    expect(okCount).toBe(1);
    expect(failCount).toBe(1);
  });
});
