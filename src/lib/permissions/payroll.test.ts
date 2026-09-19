import { describe, expect, it } from "vitest";
import { ALL_INTERNAL_PERMISSIONS, ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";

describe("payroll permissions catalog", () => {
  const keys = ALL_INTERNAL_PERMISSIONS.filter((k) => k.startsWith("payroll."));

  it("defines Phase 4.5 payroll permission set", () => {
    expect(keys.sort()).toEqual(
      [
        "payroll.adjust",
        "payroll.approve",
        "payroll.calculate",
        "payroll.lock",
        "payroll.manage_settings",
        "payroll.prepare",
        "payroll.record_payment",
        "payroll.review",
        "payroll.view_all",
        "payroll.view_self",
      ].sort(),
    );
  });

  it("grants engineer view_self only", () => {
    expect(ROLE_PERMISSION_MAP.engineer).toEqual(expect.arrayContaining(["payroll.view_self"]));
    expect(ROLE_PERMISSION_MAP.engineer).not.toContain("payroll.view_all");
    expect(ROLE_PERMISSION_MAP.engineer).not.toContain("payroll.prepare");
    expect(ROLE_PERMISSION_MAP.engineer).not.toContain("payroll.approve");
    expect(ROLE_PERMISSION_MAP.engineer).not.toContain("payroll.record_payment");
  });

  it("grants HR prepare/calculate/adjust without payment recording", () => {
    expect(ROLE_PERMISSION_MAP.hr_manager).toEqual(
      expect.arrayContaining([
        "payroll.view_self",
        "payroll.view_all",
        "payroll.prepare",
        "payroll.calculate",
        "payroll.adjust",
        "payroll.lock",
        "payroll.manage_settings",
      ]),
    );
    expect(ROLE_PERMISSION_MAP.hr_manager).not.toContain("payroll.record_payment");
  });

  it("grants finance review/approve/payment without prepare", () => {
    expect(ROLE_PERMISSION_MAP.finance_manager).toEqual(
      expect.arrayContaining([
        "payroll.view_all",
        "payroll.review",
        "payroll.approve",
        "payroll.lock",
        "payroll.adjust",
        "payroll.record_payment",
        "payroll.manage_settings",
      ]),
    );
    expect(ROLE_PERMISSION_MAP.finance_manager).not.toContain("payroll.prepare");
  });

  it("denies project manager salary-wide payroll access", () => {
    expect(ROLE_PERMISSION_MAP.project_manager).toEqual(expect.arrayContaining(["payroll.view_self"]));
    expect(ROLE_PERMISSION_MAP.project_manager).not.toContain("payroll.view_all");
    expect(ROLE_PERMISSION_MAP.project_manager).not.toContain("payroll.prepare");
  });
});
