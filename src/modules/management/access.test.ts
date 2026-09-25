import { describe, expect, it } from "vitest";
import { ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";
import { MANAGEMENT_VIEW_PERMISSION } from "@/modules/management/access";

describe("management command center access", () => {
  it("reuses reports.management.read (no new permission seed required)", () => {
    expect(MANAGEMENT_VIEW_PERMISSION).toBe("reports.management.read");
  });

  it("grants management view to GM / ops / finance, not project manager or engineer", () => {
    expect(ROLE_PERMISSION_MAP.general_manager).toContain("reports.management.read");
    expect(ROLE_PERMISSION_MAP.operations_manager).toContain("reports.management.read");
    expect(ROLE_PERMISSION_MAP.finance_manager).toContain("reports.management.read");
    expect(ROLE_PERMISSION_MAP.project_manager).not.toContain("reports.management.read");
    expect(ROLE_PERMISSION_MAP.engineer).not.toContain("reports.management.read");
    expect(ROLE_PERMISSION_MAP.hr_manager).not.toContain("reports.management.read");
  });
});
