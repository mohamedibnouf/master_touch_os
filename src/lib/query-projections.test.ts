import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_RECORD_LIST_COLUMNS,
  AUTH_EMPLOYEE_COLUMNS,
  AUTH_PROFILE_COLUMNS,
  DOCUMENT_LIST_COLUMNS,
  NOTIFICATION_HEADER_COLUMNS,
  PAYROLL_PERIOD_LIST_COLUMNS,
  PROJECT_LIST_COLUMNS,
  PROJECT_PICKER_COLUMNS,
} from "@/lib/query-projections";
import { GPS_STAGE_COPY } from "@/modules/attendance/gps-ux";

describe("list/header query projections", () => {
  it("uses explicit columns rather than select *", () => {
    const all = [
      PROJECT_LIST_COLUMNS,
      PROJECT_PICKER_COLUMNS,
      DOCUMENT_LIST_COLUMNS,
      NOTIFICATION_HEADER_COLUMNS,
      PAYROLL_PERIOD_LIST_COLUMNS,
      AUTH_PROFILE_COLUMNS,
      AUTH_EMPLOYEE_COLUMNS,
      ATTENDANCE_RECORD_LIST_COLUMNS,
    ];
    for (const cols of all) {
      expect(cols.includes("*")).toBe(false);
    }
  });

  it("keeps employee selector/auth projections free of compensation and GPS", () => {
    expect(AUTH_EMPLOYEE_COLUMNS).not.toMatch(/salary|iban|bank|latitude|longitude/i);
    expect(ATTENDANCE_RECORD_LIST_COLUMNS).not.toMatch(/latitude|longitude/);
    expect(PROJECT_PICKER_COLUMNS).toContain("project_code");
    expect(PROJECT_PICKER_COLUMNS).not.toMatch(/budget|contract_value/i);
  });
});

describe("GPS pending copy", () => {
  it("exposes locating then verifying stages without implying a punch was created", () => {
    expect(GPS_STAGE_COPY.locating).toContain("تحديد موقعك");
    expect(GPS_STAGE_COPY.verifying).toContain("التحقق من موقع الحضور");
  });
});
