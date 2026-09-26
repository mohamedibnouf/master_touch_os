import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/064_phase5_multi_workplace_attendance.sql", "utf8");
const apply = readFileSync("supabase/phase5_apply_064.sql", "utf8");
const sql063 = readFileSync("supabase/migrations/063_phase5_attendance_geofencing.sql", "utf8");

describe("064 static invariants", () => {
  it("is byte-identical to the apply script and does not edit 063", () => {
    expect(sql).toBe(apply);
    expect(sql).not.toContain("geofence_all_active");
    expect(sql063).toContain("resolve_employee_workplace");
  });

  it("replaces overlap to employee+workplace and removes primary punch fallback", () => {
    expect(sql).toMatch(/employee_workplace_assignments_no_overlap_per_site/);
    expect(sql).toMatch(/064_PREFLIGHT_OVERLAP/);
    expect(sql).toMatch(/workplace_location_id with =/);
    expect(sql).toMatch(/No org-primary fallback/);
    expect(sql).not.toMatch(/w\.is_primary/);
  });

  it("keeps jsonb rejects, no RAISE after attempt insert, no payroll, no zero-arg drop", () => {
    expect(sql).toMatch(/Do NOT RAISE on geofence rejection/);
    expect(sql).not.toMatch(/if v_result <> 'ACCEPTED' then\s+raise exception/i);
    expect(sql).not.toMatch(/payroll/i);
    expect(sql).not.toMatch(/drop function if exists public\.attendance_check_in\(\)/i);
    expect(sql).toMatch(/on delete restrict/i);
  });

  it("U/Q contract: invalid coords stay null and nearest-valid matching is documented", () => {
    expect(sql).toMatch(/GEOFENCE_INVALID_LOCATION/);
    expect(sql).toMatch(/v_best_valid_id/);
    expect(sql).toMatch(/v_store_lat := null/);
  });
});
