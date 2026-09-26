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

const GEO_PUNCH = { p_latitude: 24.7136, p_longitude: 46.6753, p_accuracy_meters: 12 };

async function rpcAttendancePunch(
  client: SupabaseClient,
  fn: "attendance_check_in" | "attendance_check_out",
) {
  const withGeo = await client.rpc(fn, GEO_PUNCH);
  if (!withGeo.error && withGeo.data && typeof withGeo.data === "object") {
    const p = withGeo.data as { accepted?: boolean; reason_code?: string; attendance_record?: unknown };
    if (typeof p.accepted === "boolean") {
      if (!p.accepted) return { data: null, error: { message: p.reason_code ?? "GEOFENCE_REJECTED" } };
      return { data: p.attendance_record, error: null };
    }
  }
  if (withGeo.error) {
    const msg = withGeo.error.message ?? "";
    if (/could not find the function|does not exist|PGRST202|schema cache/i.test(msg)) {
      return client.rpc(fn);
    }
  }
  return withGeo;
}

function uniqueEmployeeNumber(tag: string, runSuffix: string): string {
  return `44${tag}${runSuffix}`.slice(0, 32);
}

describe.skipIf(!configured)("live Phase 4.4 attendance management", () => {
  let fx: LiveFixture;
  let phase44Ready = false;
  let admin: SupabaseClient;
  let hrClient: SupabaseClient;
  let mgrClient: SupabaseClient;
  let empClient: SupabaseClient;
  let peerClient: SupabaseClient;

  let hrEmployeeId = "";
  let mgrEmployeeId = "";
  let empEmployeeId = "";
  let peerEmployeeId = "";
  let shiftId = "";
  let annualLeaveTypeId = "";

  const createdUserIds: string[] = [];
  const createdEmails: string[] = [];
  const runSuffix = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

  beforeAll(async () => {
    admin = adminClient();

    const { error: polErr } = await admin.from("attendance_policies").select("id").limit(1);
    const { error: recErr } = await admin.from("attendance_records").select("id").limit(1);
    const { error: shErr } = await admin.from("attendance_shifts").select("id").limit(1);
    phase44Ready = !polErr && !recErr && !shErr;

    if (!phase44Ready) {
      throw new Error(
        "Phase 4.4 live suite blocked: apply supabase/phase4_fix_057.sql in Supabase SQL Editor, then re-run.",
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

      const { data: emp, error: empErr } = await admin
        .from("employees")
        .upsert(
          {
            organization_id: fx.orgAId,
            profile_id: userId,
            employment_status: "active",
            is_active: true,
            employee_number: uniqueEmployeeNumber(empTag, runSuffix),
          },
          { onConflict: "organization_id,profile_id" },
        )
        .select("id")
        .single<{ id: string }>();
      if (empErr) throw new Error(`emp ${email}: ${empErr.message}`);

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

    const hr = await createWithRole(`mt-live-hr44-${runSuffix}@test.local`, `${prefix}hr44`, "hr_manager", "HR");
    const mgr = await createWithRole(
      `mt-live-mgr44-${runSuffix}@test.local`,
      `${prefix}mgr44`,
      "department_manager",
      "MGR",
    );
    const emp = await createWithRole(
      `mt-live-emp44-${runSuffix}@test.local`,
      `${prefix}emp44`,
      "engineer",
      "EMP",
    );
    const peer = await createWithRole(
      `mt-live-peer44-${runSuffix}@test.local`,
      `${prefix}peer44`,
      "engineer",
      "PEER",
    );

    hrEmployeeId = hr.employeeId;
    mgrEmployeeId = mgr.employeeId;
    empEmployeeId = emp.employeeId;
    peerEmployeeId = peer.employeeId;

    await admin
      .from("employees")
      .update({ direct_manager_employee_id: mgrEmployeeId })
      .eq("id", empEmployeeId);

    let { data: shift } = await admin
      .from("attendance_shifts")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("code", "STD_DAY")
      .maybeSingle();

    if (!shift?.id) {
      const { data: policy } = await admin
        .from("attendance_policies")
        .select("id")
        .eq("organization_id", fx.orgAId)
        .eq("code", "DEFAULT")
        .maybeSingle();
      const { data: inserted } = await admin
        .from("attendance_shifts")
        .insert({
          organization_id: fx.orgAId,
          policy_id: policy!.id,
          code: "STD_DAY",
          name_ar: "وردية نهارية",
          name_en: "Standard Day",
          start_time: "00:00",
          end_time: "23:59",
          break_minutes: 0,
          crosses_midnight: false,
          working_days: [0, 1, 2, 3, 4, 5, 6],
          is_active: true,
        })
        .select("id")
        .single();
      shift = inserted;
    } else {
      // Make shift always-on for live tests (any DOW, all-day window)
      await admin
        .from("attendance_shifts")
        .update({
          start_time: "00:00",
          end_time: "23:59",
          working_days: [0, 1, 2, 3, 4, 5, 6],
          crosses_midnight: false,
          is_active: true,
        })
        .eq("id", shift.id);
    }
    shiftId = shift!.id as string;

    // Ensure shift assignment for employee (admin insert — no auth.uid needed)
    const today = new Date().toISOString().slice(0, 10);
    const { data: existingAssign } = await admin
      .from("employee_shift_assignments")
      .select("id")
      .eq("employee_id", empEmployeeId)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .limit(1);
    if (!existingAssign?.length) {
      const { error: aErr } = await admin.from("employee_shift_assignments").insert({
        organization_id: fx.orgAId,
        employee_id: empEmployeeId,
        shift_id: shiftId,
        effective_from: today,
        created_by: hr.userId,
      });
      if (aErr) throw new Error(`assign emp: ${aErr.message}`);
    }

    const { error: geoProbe } = await admin.from("workplace_locations").select("id").limit(1);
    if (!geoProbe) {
      const { data: wp } = await admin
        .from("workplace_locations")
        .insert({
          organization_id: fx.orgAId,
          name: `P44-GEO-${runSuffix}`,
          code: `P44G${runSuffix}`.slice(0, 32),
          latitude: 24.7136,
          longitude: 46.6753,
          allowed_radius_meters: 150,
          max_accuracy_meters: 100,
          is_active: true,
          is_primary: false,
        })
        .select("id")
        .maybeSingle();
      if (wp?.id) {
        await admin.from("employee_workplace_assignments").insert({
          organization_id: fx.orgAId,
          employee_id: empEmployeeId,
          workplace_location_id: wp.id,
          effective_from: today,
        });
        await admin.from("employee_workplace_assignments").insert({
          organization_id: fx.orgAId,
          employee_id: peerEmployeeId,
          workplace_location_id: wp.id,
          effective_from: today,
        });
      }
    }

    const { data: leaveType } = await admin
      .from("leave_types")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("code", "ANNUAL")
      .maybeSingle();
    annualLeaveTypeId = leaveType?.id ?? "";

    hrClient = await signInAs(`mt-live-hr44-${runSuffix}@test.local`, `${prefix}hr44`);
    mgrClient = await signInAs(`mt-live-mgr44-${runSuffix}@test.local`, `${prefix}mgr44`);
    empClient = await signInAs(`mt-live-emp44-${runSuffix}@test.local`, `${prefix}emp44`);
    peerClient = await signInAs(`mt-live-peer44-${runSuffix}@test.local`, `${prefix}peer44`);
  }, 180_000);

  afterAll(async () => {
    if (!admin) return;
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
    expect(phase44Ready).toBe(true);
    expect(shiftId).toBeTruthy();
    const { data: perms } = await admin.from("permissions").select("key").like("key", "attendance.%");
    expect((perms ?? []).length).toBeGreaterThanOrEqual(9);
  });

  it("02 — employee check-in then check-out", async () => {
    const { data: cin, error: inErr } = await rpcAttendancePunch(empClient, "attendance_check_in");
    expect(inErr).toBeNull();
    expect(cin?.check_in_at).toBeTruthy();
    expect(cin?.employee_id).toBe(empEmployeeId);

    const { data: cout, error: outErr } = await rpcAttendancePunch(empClient, "attendance_check_out");
    expect(outErr).toBeNull();
    expect(cout?.check_out_at).toBeTruthy();
    expect(Number(cout?.worked_minutes)).toBeGreaterThanOrEqual(0);
  });

  it("03 — peer cannot read employee attendance", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await peerClient
      .from("attendance_records")
      .select("id")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today);
    expect(rows?.length ?? 0).toBe(0);
  });

  it("04 — manager sees team attendance; HR sees org", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: mgrRows } = await mgrClient
      .from("attendance_records")
      .select("id, employee_id")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today);
    expect((mgrRows ?? []).length).toBeGreaterThanOrEqual(1);

    const { data: hrRows } = await hrClient
      .from("attendance_records")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("attendance_date", today)
      .limit(10);
    expect((hrRows ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("05 — approved leave resolves ON_LEAVE via reconcile", async () => {
    if (!annualLeaveTypeId) return;

    const leaveDay = new Date();
    leaveDay.setUTCDate(leaveDay.getUTCDate() + 3);
    const d = leaveDay.toISOString().slice(0, 10);

    await admin.from("leave_requests").insert({
      organization_id: fx.orgAId,
      employee_id: empEmployeeId,
      leave_type_id: annualLeaveTypeId,
      start_date: d,
      end_date: d,
      total_days: 1,
      status: "approved",
      approval_stage: "complete",
      submitted_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
    });

    const { error } = await hrClient.rpc("reconcile_attendance_for_date", {
      p_organization_id: fx.orgAId,
      p_date: d,
    });
    expect(error).toBeNull();

    const { data: rec } = await admin
      .from("attendance_records")
      .select("attendance_status")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", d)
      .maybeSingle();
    expect(rec?.attendance_status).toBe("on_leave");
  });

  it("06 — concurrent double check-in does not duplicate", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await admin
      .from("employee_shift_assignments")
      .select("id")
      .eq("employee_id", peerEmployeeId)
      .limit(1);
    if (!existing?.length) {
      await admin.from("employee_shift_assignments").insert({
        organization_id: fx.orgAId,
        employee_id: peerEmployeeId,
        shift_id: shiftId,
        effective_from: today,
      });
    }

    await Promise.all([
      rpcAttendancePunch(peerClient, "attendance_check_in"),
      rpcAttendancePunch(peerClient, "attendance_check_in"),
    ]);

    const { data: rows } = await admin
      .from("attendance_records")
      .select("id")
      .eq("employee_id", peerEmployeeId)
      .eq("attendance_date", today);
    expect(rows?.length).toBe(1);
  });

  it("07 — cross-org isolation", async () => {
    const cross = await signInAs(fx.users.restricted.email, fx.users.restricted.password);
    const { data } = await cross
      .from("attendance_records")
      .select("id")
      .eq("employee_id", empEmployeeId);
    expect(data?.length ?? 0).toBe(0);
  });

  it("08 — adjustment creates immutable history", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: rec } = await admin
      .from("attendance_records")
      .select("id, check_in_at, check_out_at")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today)
      .single();

    const originalReason = "live test adjustment";
    const { data: adjusted, error } = await hrClient.rpc("adjust_attendance_record", {
      p_record_id: rec!.id,
      p_check_in: rec!.check_in_at,
      p_check_out: rec!.check_out_at,
      p_status: "present",
      p_notes: "live adjust",
      p_reason: originalReason,
    });
    expect(error).toBeNull();
    expect(adjusted?.id).toBe(rec!.id);

    const { data: hist } = await admin
      .from("attendance_adjustments")
      .select("id, reason")
      .eq("attendance_record_id", rec!.id)
      .eq("reason", originalReason);
    expect((hist ?? []).length).toBeGreaterThanOrEqual(1);
    const histId = hist![0].id;
    expect(hist![0].reason).toBe(originalReason);

    // Authenticated UPDATE: RLS write policy using(false) yields 0 rows / no error,
    // or an explicit error. Either way the persisted row must remain unchanged.
    const { data: mutRows, error: mutErr } = await hrClient
      .from("attendance_adjustments")
      .update({ reason: "tamper" })
      .eq("id", histId)
      .select("id, reason");
    const updateBlocked = Boolean(mutErr) || (mutRows?.length ?? 0) === 0;
    expect(updateBlocked).toBe(true);

    const { data: afterUpdate } = await admin
      .from("attendance_adjustments")
      .select("id, reason")
      .eq("id", histId)
      .single();
    expect(afterUpdate?.reason).toBe(originalReason);

    // Authenticated DELETE must likewise leave the history row intact.
    const { data: delRows, error: delErr } = await hrClient
      .from("attendance_adjustments")
      .delete()
      .eq("id", histId)
      .select("id");
    const deleteBlocked = Boolean(delErr) || (delRows?.length ?? 0) === 0;
    expect(deleteBlocked).toBe(true);

    const { data: afterDelete } = await admin
      .from("attendance_adjustments")
      .select("id, reason")
      .eq("id", histId)
      .maybeSingle();
    expect(afterDelete?.id).toBe(histId);
    expect(afterDelete?.reason).toBe(originalReason);
  });

  it("09 — monthly summary returns employee row", async () => {
    const now = new Date();
    const { data, error } = await hrClient.rpc("attendance_monthly_summary", {
      p_organization_id: fx.orgAId,
      p_year: now.getUTCFullYear(),
      p_month: now.getUTCMonth() + 1,
    });
    expect(error).toBeNull();
    const mine = (data ?? []).find((r: { employee_id: string }) => r.employee_id === empEmployeeId);
    expect(mine).toBeTruthy();
  });

  it("10 — HR can manage; engineer cannot adjust", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: rec } = await admin
      .from("attendance_records")
      .select("id")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today)
      .single();

    const { error } = await empClient.rpc("adjust_attendance_record", {
      p_record_id: rec!.id,
      p_check_in: null,
      p_check_out: null,
      p_status: "absent",
      p_notes: null,
      p_reason: "should fail",
    });
    expect(error).toBeTruthy();
    void hrEmployeeId;
    void createdEmails;
  });
});
