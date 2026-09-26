/**
 * Phase 5.7 live A–T. Runs only when LIVE_TEST_ENABLED and migration 063 exists.
 * Does not apply 063. Cleans only this run's fixtures.
 */
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
import { parseAttendancePunchRpc } from "@/modules/attendance/geofence";

const configured = liveTestConfigured();
const HQ = { p_latitude: 24.7136, p_longitude: 46.6753, p_accuracy_meters: 12 };

function north(meters: number) {
  return HQ.p_latitude + meters / 111_320;
}

describe.skipIf(!configured)("live Phase 5.7 attendance geofencing", () => {
  let geoReady = false;
  let fx: LiveFixture;
  let admin: SupabaseClient;
  let empClient: SupabaseClient;
  let mgrClient: SupabaseClient;
  let hrClient: SupabaseClient;
  let empEmployeeId = "";
  let mgrEmployeeId = "";
  let workplaceId = "";
  let inactiveId = "";
  const createdUserIds: string[] = [];
  const runSuffix = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const prefix = process.env.LIVE_TEST_PASSWORD_PREFIX ?? "MtTest1!";

  beforeAll(async () => {
    admin = adminClient();
    const { error } = await admin.from("attendance_location_attempts").select("id").limit(1);
    geoReady = !error;
    if (!geoReady) {
      console.warn("[live-test] 063 unapplied — Phase 5.7 A–T deferred");
      return;
    }
    fx = await provisionLiveFixture();

    async function createWithRole(tag: string, roleCode: string) {
      const email = `mt-live-p57-${tag}-${runSuffix}@test.local`;
      const password = `${prefix}${tag}`;
      const { data: created, error: uErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name_ar: tag, full_name_en: tag, locale: "ar" },
      });
      if (uErr || !created.user) throw new Error(uErr?.message ?? "createUser");
      createdUserIds.push(created.user.id);
      await admin.from("organization_members").upsert({
        organization_id: fx.orgAId,
        profile_id: created.user.id,
        status: "active",
      });
      const { data: emp, error: eErr } = await admin
        .from("employees")
        .upsert(
          {
            organization_id: fx.orgAId,
            profile_id: created.user.id,
            employment_status: "active",
            is_active: true,
            employee_number: `57${tag}${runSuffix}`.slice(0, 32),
          },
          { onConflict: "organization_id,profile_id" },
        )
        .select("id")
        .single();
      if (eErr) throw new Error(eErr.message);
      const { data: role } = await admin
        .from("roles")
        .select("id")
        .eq("code", roleCode)
        .is("organization_id", null)
        .maybeSingle();
      if (role?.id) {
        await admin.from("user_roles").insert({
          organization_id: fx.orgAId,
          profile_id: created.user.id,
          role_id: role.id,
          scope_type: "organization",
        });
      }
      return { email, password, employeeId: emp.id as string };
    }

    const emp = await createWithRole("EMP", "engineer");
    const mgr = await createWithRole("MGR", "department_manager");
    const hr = await createWithRole("HR", "hr_manager");
    empEmployeeId = emp.employeeId;
    mgrEmployeeId = mgr.employeeId;

    const { data: shift } = await admin
      .from("attendance_shifts")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("code", "STD_DAY")
      .maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    if (shift?.id) {
      await admin.from("employee_shift_assignments").insert({
        organization_id: fx.orgAId,
        employee_id: empEmployeeId,
        shift_id: shift.id,
        effective_from: today,
      });
    }

    const { data: wp } = await admin
      .from("workplace_locations")
      .insert({
        organization_id: fx.orgAId,
        name: `P57-HQ-${runSuffix}`,
        code: `P57H${runSuffix}`.slice(0, 32),
        latitude: HQ.p_latitude,
        longitude: HQ.p_longitude,
        allowed_radius_meters: 150,
        max_accuracy_meters: 100,
        is_active: true,
        is_primary: false,
      })
      .select("id")
      .single();
    workplaceId = wp!.id as string;
    await admin.from("employee_workplace_assignments").insert({
      organization_id: fx.orgAId,
      employee_id: empEmployeeId,
      workplace_location_id: workplaceId,
      effective_from: today,
    });

    const { data: inactive } = await admin
      .from("workplace_locations")
      .insert({
        organization_id: fx.orgAId,
        name: `P57-OFF-${runSuffix}`,
        code: `P57I${runSuffix}`.slice(0, 32),
        latitude: HQ.p_latitude,
        longitude: HQ.p_longitude,
        allowed_radius_meters: 150,
        max_accuracy_meters: 100,
        is_active: false,
        is_primary: false,
      })
      .select("id")
      .single();
    inactiveId = inactive!.id as string;

    empClient = await signInAs(emp.email, emp.password);
    mgrClient = await signInAs(mgr.email, mgr.password);
    hrClient = await signInAs(hr.email, hr.password);
  }, 90_000);

  afterAll(async () => {
    if (!geoReady) return;
    await admin.from("attendance_location_attempts").delete().eq("employee_id", empEmployeeId);
    await admin.from("attendance_records").delete().eq("employee_id", empEmployeeId);
    await admin.from("employee_workplace_assignments").delete().eq("employee_id", empEmployeeId);
    await admin.from("workplace_locations").delete().in("id", [workplaceId, inactiveId].filter(Boolean));
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
    if (fx?.cleanup) await fx.cleanup();
  }, 60_000);

  async function punch(
    coords: { p_latitude: number; p_longitude: number; p_accuracy_meters: number },
    action: "attendance_check_in" | "attendance_check_out" = "attendance_check_in",
  ) {
    const { data, error } = await empClient.rpc(action, coords);
    return { parsed: parseAttendancePunchRpc(data), error };
  }

  it("A. valid inside-radius check-in succeeds", async () => {
    if (!geoReady) return;
    const { parsed, error } = await punch(HQ);
    expect(error).toBeNull();
    expect(parsed?.accepted).toBe(true);
    expect(parsed?.reason_code).toBe("ACCEPTED");
    expect(parsed?.attendance_record).toBeTruthy();
  });

  it("B. boundary distance succeeds", async () => {
    if (!geoReady) return;
    const { parsed } = await punch({
      p_latitude: north(149),
      p_longitude: HQ.p_longitude,
      p_accuracy_meters: 12,
    });
    expect(parsed?.accepted).toBe(true);
  });

  it("C. outside-radius punch rejected", async () => {
    if (!geoReady) return;
    const { parsed } = await punch({
      p_latitude: north(400),
      p_longitude: HQ.p_longitude,
      p_accuracy_meters: 12,
    });
    expect(parsed?.accepted).toBe(false);
    expect(parsed?.reason_code).toBe("GEOFENCE_OUTSIDE");
  });

  it("D. OUTSIDE_GEOFENCE attempt row persists", async () => {
    if (!geoReady) return;
    const { data } = await admin
      .from("attendance_location_attempts")
      .select("id, result, latitude, longitude")
      .eq("employee_id", empEmployeeId)
      .eq("result", "OUTSIDE_GEOFENCE");
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("E. poor accuracy rejected", async () => {
    if (!geoReady) return;
    const { parsed } = await punch({ ...HQ, p_accuracy_meters: 450 });
    expect(parsed?.accepted).toBe(false);
    expect(parsed?.reason_code).toBe("GEOFENCE_POOR_ACCURACY");
  });

  it("F. POOR_ACCURACY attempt persists", async () => {
    if (!geoReady) return;
    const { data } = await admin
      .from("attendance_location_attempts")
      .select("id")
      .eq("employee_id", empEmployeeId)
      .eq("result", "POOR_ACCURACY");
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("G. invalid coordinates rejected", async () => {
    if (!geoReady) return;
    const { parsed } = await punch({ p_latitude: 91, p_longitude: 0, p_accuracy_meters: 12 });
    expect(parsed?.accepted).toBe(false);
    expect(parsed?.reason_code).toBe("GEOFENCE_INVALID_LOCATION");
  });

  it("H. INVALID_LOCATION persists with NULL lat/lng, never 0,0", async () => {
    if (!geoReady) return;
    const { data } = await admin
      .from("attendance_location_attempts")
      .select("latitude, longitude, accuracy_meters, distance_meters")
      .eq("employee_id", empEmployeeId)
      .eq("result", "INVALID_LOCATION")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(data?.latitude).toBeNull();
    expect(data?.longitude).toBeNull();
    expect(data?.accuracy_meters).toBeNull();
    expect(data?.distance_meters).toBeNull();
  });

  it("I–J. missing workplace rejected and NO_WORKPLACE persists", async () => {
    if (!geoReady) return;
    await admin.from("employee_workplace_assignments").delete().eq("employee_id", mgrEmployeeId);
    const today = new Date().toISOString().slice(0, 10);
    const { data: primary } = await admin
      .from("workplace_locations")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("is_primary", true)
      .maybeSingle();
    if (primary?.id) {
      await admin.from("workplace_locations").update({ is_primary: false }).eq("id", primary.id);
    }
    const mgrEmail = `mt-live-p57-MGR-${runSuffix}@test.local`;
    const mgrSess = await signInAs(mgrEmail, `${prefix}MGR`);
    const { data } = await mgrSess.rpc("attendance_check_in", HQ);
    const parsed = parseAttendancePunchRpc(data);
    expect(parsed?.reason_code).toBe("GEOFENCE_NO_WORKPLACE");
    const { data: rows } = await admin
      .from("attendance_location_attempts")
      .select("id")
      .eq("employee_id", mgrEmployeeId)
      .eq("result", "NO_WORKPLACE");
    expect((rows ?? []).length).toBeGreaterThan(0);
  });

  it("K–L. inactive workplace rejected and attempt persists", async () => {
    if (!geoReady) return;
    const today = new Date().toISOString().slice(0, 10);
    await admin.from("employee_workplace_assignments").delete().eq("employee_id", mgrEmployeeId);
    await admin.from("employee_workplace_assignments").insert({
      organization_id: fx.orgAId,
      employee_id: mgrEmployeeId,
      workplace_location_id: inactiveId,
      effective_from: today,
    });
    const mgrEmail = `mt-live-p57-MGR-${runSuffix}@test.local`;
    const mgrSess = await signInAs(mgrEmail, `${prefix}MGR`);
    const { data } = await mgrSess.rpc("attendance_check_in", HQ);
    expect(parseAttendancePunchRpc(data)?.reason_code).toBe("GEOFENCE_INACTIVE_WORKPLACE");
    const { data: rows } = await admin
      .from("attendance_location_attempts")
      .select("id")
      .eq("employee_id", mgrEmployeeId)
      .eq("result", "INACTIVE_WORKPLACE");
    expect((rows ?? []).length).toBeGreaterThan(0);
  });

  it("M. rejected check-in does not create/change attendance punch", async () => {
    if (!geoReady) return;
    const today = new Date().toISOString().slice(0, 10);
    const before = await admin
      .from("attendance_records")
      .select("check_in_at")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today)
      .maybeSingle();
    await punch({ p_latitude: north(400), p_longitude: HQ.p_longitude, p_accuracy_meters: 12 });
    const after = await admin
      .from("attendance_records")
      .select("check_in_at")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today)
      .maybeSingle();
    expect(after.data?.check_in_at).toBe(before.data?.check_in_at);
  });

  it("N. rejected checkout does not modify checkout timestamp", async () => {
    if (!geoReady) return;
    const today = new Date().toISOString().slice(0, 10);
    const before = await admin
      .from("attendance_records")
      .select("check_out_at")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today)
      .maybeSingle();
    await punch(
      { p_latitude: north(400), p_longitude: HQ.p_longitude, p_accuracy_meters: 12 },
      "attendance_check_out",
    );
    const after = await admin
      .from("attendance_records")
      .select("check_out_at")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today)
      .maybeSingle();
    expect(after.data?.check_out_at).toBe(before.data?.check_out_at);
  });

  it("O. accepted attempt persists", async () => {
    if (!geoReady) return;
    const { data } = await admin
      .from("attendance_location_attempts")
      .select("id")
      .eq("employee_id", empEmployeeId)
      .eq("result", "ACCEPTED");
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("P. employee sees only own permitted evidence", async () => {
    if (!geoReady) return;
    const { data } = await empClient.from("attendance_location_attempts").select("employee_id");
    expect((data ?? []).every((r) => r.employee_id === empEmployeeId)).toBe(true);
  });

  it("Q. manager without evidence permission cannot see coordinates", async () => {
    if (!geoReady) return;
    const { data } = await mgrClient
      .from("attendance_location_attempts")
      .select("id, latitude, longitude")
      .eq("employee_id", empEmployeeId);
    expect((data ?? []).length).toBe(0);
  });

  it("R. HR evidence permission can see same-org evidence", async () => {
    if (!geoReady) return;
    const { data, error } = await hrClient
      .from("attendance_location_attempts")
      .select("id, latitude, longitude, employee_id")
      .eq("employee_id", empEmployeeId)
      .limit(1);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("S. cross-org evidence denied", async () => {
    if (!geoReady) return;
    const cross = await signInAs(fx.users.restricted.email, fx.users.restricted.password);
    const { data } = await cross.from("attendance_location_attempts").select("id").eq("employee_id", empEmployeeId);
    expect((data ?? []).length).toBe(0);
  });

  it("T. duplicate accepted punch remains idempotent", async () => {
    if (!geoReady) return;
    const today = new Date().toISOString().slice(0, 10);
    const first = await punch(HQ);
    const second = await punch(HQ);
    expect(first.parsed?.accepted).toBe(true);
    expect(second.parsed?.accepted).toBe(true);
    const { data: rows } = await admin
      .from("attendance_records")
      .select("id")
      .eq("employee_id", empEmployeeId)
      .eq("attendance_date", today);
    expect(rows?.length).toBe(1);
  });

  it("employee cannot mutate attempt evidence", async () => {
    if (!geoReady) return;
    const { data: row } = await admin
      .from("attendance_location_attempts")
      .select("id")
      .eq("employee_id", empEmployeeId)
      .limit(1)
      .maybeSingle();
    if (!row?.id) return;
    const { error: delErr } = await empClient.from("attendance_location_attempts").delete().eq("id", row.id);
    const { error: updErr } = await empClient
      .from("attendance_location_attempts")
      .update({ result: "ACCEPTED" })
      .eq("id", row.id);
    expect(delErr || updErr).toBeTruthy();
    const { data: still } = await admin.from("attendance_location_attempts").select("id").eq("id", row.id).maybeSingle();
    expect(still?.id).toBe(row.id);
  });
});

describe.skipIf(!configured)("live Phase 5.7.1 multi-workplace (prepared; skips until 064 is applied)", () => {
  let geoReady = false;
  let multiReady = false;
  let admin: SupabaseClient;
  let fx: LiveFixture;
  let empClient: SupabaseClient;
  let empEmployeeId = "";
  let hqId = "";
  let whId = "";
  const createdUserIds: string[] = [];
  const runSuffix = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const prefix = process.env.LIVE_TEST_PASSWORD_PREFIX ?? "MtTest1!";
  const HQ = { p_latitude: 24.7136, p_longitude: 46.6753, p_accuracy_meters: 12 };
  const WH = { p_latitude: 24.7136 + 400 / 111_320, p_longitude: 46.6753, p_accuracy_meters: 12 };

  beforeAll(async () => {
    admin = adminClient();
    const { error } = await admin.from("attendance_location_attempts").select("id").limit(1);
    geoReady = !error;
    if (!geoReady) {
      console.warn("[live-test] 063 unapplied — Phase 5.7.1 deferred");
      return;
    }
    fx = await provisionLiveFixture();
    const email = `mt-live-p571-${runSuffix}@test.local`;
    const password = `${prefix}m571`;
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name_ar: "p571", full_name_en: "p571", locale: "ar" },
    });
    if (uErr || !created.user) throw new Error(uErr?.message ?? "createUser");
    createdUserIds.push(created.user.id);
    await admin.from("organization_members").upsert({
      organization_id: fx.orgAId,
      profile_id: created.user.id,
      status: "active",
    });
    const { data: emp, error: eErr } = await admin
      .from("employees")
      .upsert(
        {
          organization_id: fx.orgAId,
          profile_id: created.user.id,
          employment_status: "active",
          is_active: true,
          employee_number: `571${runSuffix}`.slice(0, 32),
        },
        { onConflict: "organization_id,profile_id" },
      )
      .select("id")
      .single();
    if (eErr) throw new Error(eErr.message);
    empEmployeeId = emp.id as string;
    const { data: role } = await admin
      .from("roles")
      .select("id")
      .eq("code", "engineer")
      .is("organization_id", null)
      .maybeSingle();
    if (role?.id) {
      await admin.from("user_roles").insert({
        organization_id: fx.orgAId,
        profile_id: created.user.id,
        role_id: role.id,
        scope_type: "organization",
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    const { data: hq } = await admin
      .from("workplace_locations")
      .insert({
        organization_id: fx.orgAId,
        name: `P571-HQ-${runSuffix}`,
        code: `571H${runSuffix}`.slice(0, 32),
        latitude: HQ.p_latitude,
        longitude: HQ.p_longitude,
        allowed_radius_meters: 150,
        max_accuracy_meters: 100,
        is_active: true,
        is_primary: false,
      })
      .select("id")
      .single();
    hqId = hq!.id as string;
    const { data: wh } = await admin
      .from("workplace_locations")
      .insert({
        organization_id: fx.orgAId,
        name: `P571-WH-${runSuffix}`,
        code: `571W${runSuffix}`.slice(0, 32),
        latitude: WH.p_latitude,
        longitude: WH.p_longitude,
        allowed_radius_meters: 150,
        max_accuracy_meters: 200,
        is_active: true,
        is_primary: false,
      })
      .select("id")
      .single();
    whId = wh!.id as string;
    await admin.from("employee_workplace_assignments").insert({
      organization_id: fx.orgAId,
      employee_id: empEmployeeId,
      workplace_location_id: hqId,
      effective_from: today,
    });
    const second = await admin.from("employee_workplace_assignments").insert({
      organization_id: fx.orgAId,
      employee_id: empEmployeeId,
      workplace_location_id: whId,
      effective_from: today,
    });
    if (second.error) {
      console.warn("[live-test] 064 unapplied — Phase 5.7.1 multi-workplace deferred");
      multiReady = false;
    } else {
      multiReady = true;
    }
    empClient = await signInAs(email, password);
  }, 90_000);

  afterAll(async () => {
    if (!geoReady) return;
    if (empEmployeeId) {
      await admin.from("attendance_location_attempts").delete().eq("employee_id", empEmployeeId);
      await admin.from("attendance_records").delete().eq("employee_id", empEmployeeId);
      await admin.from("employee_workplace_assignments").delete().eq("employee_id", empEmployeeId);
    }
    await admin.from("workplace_locations").delete().in("id", [hqId, whId].filter(Boolean));
    for (const id of createdUserIds) {
      try {
        await admin.auth.admin.deleteUser(id);
      } catch {
        /* best-effort */
      }
    }
    if (fx?.cleanup) await fx.cleanup();
  }, 60_000);

  it("K. overlapping different sites allowed when 064 applied", () => {
    if (!geoReady || !multiReady) return;
    expect(multiReady).toBe(true);
  });

  it("B/S. HQ+Warehouse check-in then checkout at the other authorized site", async () => {
    if (!geoReady || !multiReady) return;
    const { data: shift } = await admin
      .from("attendance_shifts")
      .select("id")
      .eq("organization_id", fx.orgAId)
      .eq("code", "STD_DAY")
      .maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    if (shift?.id) {
      await admin.from("employee_shift_assignments").insert({
        organization_id: fx.orgAId,
        employee_id: empEmployeeId,
        shift_id: shift.id,
        effective_from: today,
      });
    }
    const inHq = await empClient.rpc("attendance_check_in", HQ);
    expect(parseAttendancePunchRpc(inHq.data)?.accepted).toBe(true);
    const outWh = await empClient.rpc("attendance_check_out", WH);
    expect(parseAttendancePunchRpc(outWh.data)?.accepted).toBe(true);
  });

  it("L. overlapping same site still rejected", async () => {
    if (!geoReady || !multiReady) return;
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await admin.from("employee_workplace_assignments").insert({
      organization_id: fx.orgAId,
      employee_id: empEmployeeId,
      workplace_location_id: hqId,
      effective_from: today,
    });
    expect(error).toBeTruthy();
    expect(error?.code === "23P01" || /exclusion|no_overlap/i.test(error?.message ?? "")).toBe(true);
  });

  it("U. zero-arg remains fail-closed after 064", async () => {
    if (!geoReady || !multiReady) return;
    const { error } = await empClient.rpc("attendance_check_in");
    expect(error?.message ?? "").toMatch(/GEOFENCE_LOCATION_REQUIRED/);
  });
});

