import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/063_phase5_attendance_geofencing.sql", "utf8");

describe("063 static invariants", () => {
  it("does not fabricate 0,0 and keeps fail-closed zero-arg punch RPCs", () => {
    expect(sql).not.toMatch(/coalesce\(\s*p_latitude\s*,\s*0\s*\)/i);
    expect(sql).not.toMatch(/drop function if exists public\.attendance_check_in\(\)/i);
    expect(sql).toMatch(/GEOFENCE_LOCATION_REQUIRED/);
    expect(sql).toMatch(/create or replace function public\.attendance_check_in\(\)/);
    expect(sql).toMatch(/create or replace function public\.attendance_check_in\(\s*p_latitude numeric/);
    expect(sql).toMatch(/max_accuracy_meters/);
    expect(sql).toMatch(/workplace_locations_directory/);
    expect(sql).toContain("latitude numeric,");
    expect(sql).toContain("v_store_lat := null;");
    expect(sql).not.toMatch(/if v_geo_result is distinct from 'ACCEPTED' then\s+raise/i);
    expect(sql).not.toMatch(/if v_result <> 'ACCEPTED' then\s+raise exception/i);
    expect(sql).toMatch(/'accepted', false/);
    expect(sql).toMatch(/returns jsonb/);
  });
});
