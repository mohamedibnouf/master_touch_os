import { describe, expect, it } from "vitest";
import { workplaceUniqueViolationMessage } from "./workplace-write";

describe("workplaceUniqueViolationMessage", () => {
  it("maps duplicate workplace code (23505 org_code)", () => {
    const msg = workplaceUniqueViolationMessage({
      code: "23505",
      message: 'duplicate key value violates unique constraint "workplace_locations_org_code_uidx"',
      details: "Key (organization_id, code)=(11111111-1111-1111-1111-111111111111, z1) already exists.",
    });
    expect(msg?.ar).toContain("رمز الموقع");
  });

  it("maps duplicate org primary (23505 one_primary)", () => {
    const msg = workplaceUniqueViolationMessage({
      code: "23505",
      message: 'duplicate key value violates unique constraint "workplace_locations_one_primary_uidx"',
      details: "Key (organization_id)=(11111111-1111-1111-1111-111111111111) already exists.",
    });
    expect(msg?.ar).toContain("الموقع الأساسي");
  });

  it("returns null for other codes", () => {
    expect(workplaceUniqueViolationMessage({ code: "42501", message: "permission denied" })).toBeNull();
  });
});
