import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";
import {
  evaluateRfqSupplierEligibility,
  isRfqInvitationEditable,
  parseSupplierId,
  RFQ_INVITE_ERROR,
} from "./rfq-invitation";

const procurement = readFileSync("src/server/use-cases/procurement.ts", "utf8");
const detail = readFileSync("src/app/(app)/procurement/rfqs/[id]/page.tsx", "utf8");
const sql080 = readFileSync("supabase/migrations/080_workflow_procurement_completion_gate.sql", "utf8");
const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SUPPLIER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("RFQ supplier invitation (RFQ-S1–S11)", () => {
  it("RFQ-S1: active same-org supplier is eligible", () => {
    expect(
      evaluateRfqSupplierEligibility({
        supplierId: SUPPLIER,
        actorOrganizationId: ORG,
        supplierOrganizationId: ORG,
        supplierStatus: "active",
      }).ok,
    ).toBe(true);
  });

  it("RFQ-S2: unrelated-org supplier is rejected", () => {
    expect(
      evaluateRfqSupplierEligibility({
        supplierId: SUPPLIER,
        actorOrganizationId: ORG,
        supplierOrganizationId: OTHER,
        supplierStatus: "active",
      }),
    ).toEqual({ ok: false, code: "ORG_MISMATCH" });
  });

  it("RFQ-S3: inactive supplier is rejected", () => {
    expect(
      evaluateRfqSupplierEligibility({
        supplierId: SUPPLIER,
        actorOrganizationId: ORG,
        supplierOrganizationId: ORG,
        supplierStatus: "suspended",
      }),
    ).toEqual({ ok: false, code: "INACTIVE" });
    expect(RFQ_INVITE_ERROR.INACTIVE.ar).toContain("النشطين");
  });

  it("RFQ-S4: duplicate invite is a domain error and unique in schema", () => {
    expect(RFQ_INVITE_ERROR.DUPLICATE.ar).toContain("مدعو");
    expect(readFileSync("supabase/migrations/034_rfq.sql", "utf8")).toMatch(/unique \(rfq_id, supplier_id\)/);
    expect(procurement).toMatch(/RFQ_INVITE_ERROR.DUPLICATE/);
  });

  it("RFQ-S5: invited suppliers render on RFQ detail", () => {
    expect(detail).toMatch(/الموردون المدعوون/);
    expect(detail).toMatch(/rfq_suppliers/);
    expect(detail).toMatch(/RfqSupplierInvitePanel/);
    expect(readFileSync("src/components/procurement/rfq-supplier-invite-panel.tsx", "utf8")).toMatch(/إدارة الموردين/);
  });

  it("RFQ-S6: removal is supported only while editable", () => {
    expect(procurement).toMatch(/removeRfqSupplierAction/);
    expect(isRfqInvitationEditable("draft")).toBe(true);
    expect(isRfqInvitationEditable("issued")).toBe(false);
  });

  it("RFQ-S7: add/remove require rfq.issue or rfq.manage", () => {
    expect(procurement).toMatch(/authorizeRfqInvitationMutation/);
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("rfq.issue");
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("rfq.manage");
  });

  it("RFQ-S8: issued RFQ cannot mutate the supplier list", () => {
    expect(isRfqInvitationEditable("issued")).toBe(false);
    expect(isRfqInvitationEditable("responses_received")).toBe(false);
    expect(procurement).toMatch(/isRfqInvitationEditable/);
  });

  it("RFQ-S9: invite actions do not rewrite PR/RFQ linkage", () => {
    const inviteBlock = procurement.split("export async function inviteRfqSupplierAction")[1]?.split("export async function")[0] ?? "";
    expect(inviteBlock).not.toMatch(/purchase_requests/);
    expect(inviteBlock).not.toMatch(/purchase_request_id/);
  });

  it("RFQ-S10 S11: no Stage 05/06 or 080 mutation in this change", () => {
    expect(sql080).toMatch(/WORKFLOW_PROCUREMENT_NOT_READY/);
    expect(procurement).not.toMatch(/complete_workflow_step/);
    expect(detail).not.toMatch(/apply_workflow_step_outcome/);
  });

  it("rejects tampered supplier ids", () => {
    expect(parseSupplierId("not-a-uuid")).toBeNull();
    expect(parseSupplierId("javascript:alert(1)")).toBeNull();
    expect(
      evaluateRfqSupplierEligibility({
        supplierId: parseSupplierId("nope"),
        actorOrganizationId: ORG,
        supplierOrganizationId: ORG,
        supplierStatus: "active",
      }),
    ).toEqual({ ok: false, code: "INVALID_ID" });
  });
});
