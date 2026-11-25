import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/092_employee_split_shifts.sql", "utf8");

describe("092 split shifts migration", () => {
  it("allows different shifts to overlap in dates but never the same shift twice", () => {
    expect(sql).toMatch(/drop constraint if exists employee_shift_assignments_no_overlap/);
    expect(sql).toMatch(/employee_shift_assignments_same_shift_no_overlap/);
    expect(sql).toMatch(/shift_id with =/);
  });

  it("stores one attendance row per employee + day + shift", () => {
    expect(sql).toMatch(/unique \(employee_id, attendance_date, shift_id\)/);
    expect(sql).toMatch(/on conflict \(employee_id, attendance_date, shift_id\) do nothing/);
    expect(sql).not.toMatch(/on conflict \(employee_id, attendance_date\) do/);
  });

  it("keeps geofenced punches non-raising on rejection and zero-arg punches fail-closed", () => {
    expect(sql).toMatch(/'accepted', false/);
    expect(sql).not.toMatch(/if v_geo_result is distinct from 'ACCEPTED' then\s+raise/i);
    expect(sql).not.toMatch(/create or replace function public\.attendance_check_in\(\)/);
    expect(sql).not.toMatch(/drop function if exists public\.attendance_check_in/);
  });

  it("rejects colliding shift hours and supports end / delete", () => {
    expect(sql).toMatch(/SHIFT_TIME_OVERLAP/);
    expect(sql).toMatch(/SHIFT_ALREADY_ASSIGNED/);
    expect(sql).toMatch(/create or replace function public\.end_employee_shift_assignment\(/);
    expect(sql).toMatch(/create or replace function public\.delete_employee_shift_assignment\(/);
    expect(sql).toMatch(/SHIFT_ASSIGNMENT_HAS_ATTENDANCE/);
    expect(sql).toMatch(/attendance\.manage_shifts/);
  });

  it("counts payroll and summary attendance in days, not rows", () => {
    expect(sql).toMatch(/create or replace function public\.calculate_payroll_period\(p_period_id uuid\)/);
    const weightUses = sql.match(/sum\(ar\.day_weight\)/g) ?? [];
    expect(weightUses.length).toBeGreaterThanOrEqual(6);
    expect(sql).not.toMatch(/count\(\*\) filter \(where ar\.attendance_status = 'absent'\)/);
  });
});
