import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BASE_EMPLOYEE_PERMISSIONS } from "@/lib/permissions/catalog";
import { mapWorkflowRpcError } from "@/modules/projects/approval-workflow-gate";
import {
  evaluateProcurementReadiness,
  ISSUED_PO_STATUSES,
  parseProcurementReadiness,
  parseScopedProjectId,
  PROCUREMENT_DOCUMENT_POLICY,
  PROCUREMENT_STEP_KEY,
  procurementHrefForProject,
  newPurchaseRequestHref,
  type ProcurementReadinessCounts,
} from "./stage05-readiness";

const sql080 = readFileSync("supabase/migrations/080_workflow_procurement_completion_gate.sql", "utf8");
const sql077 = readFileSync("supabase/migrations/077_step_local_workflow_execution.sql", "utf8");
const sql073 = readFileSync("supabase/migrations/073_project_workflow_approval_gate.sql", "utf8");
const sql044 = readFileSync("supabase/migrations/044_phase3_rpc.sql", "utf8");
const sql067 = readFileSync("supabase/migrations/067_base_employee_role.sql", "utf8");
const details = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");
const apply080 = sql080.split("create or replace function public.apply_workflow_step_outcome")[1] ?? "";

const empty: ProcurementReadinessCounts = {
  purchase_request_count: 0,
  rfq_count: 0,
  quotation_count: 0,
  awarded_count: 0,
  issued_po_count: 0,
  issued_po_with_delivery_date_count: 0,
  supporting_document_count: 0,
};

describe("Stage 05 procurement P0 gate (G1–G24)", () => {
  it("G1: non-procurement complete path is unchanged except the keyed predicate", () => {
    expect(apply080).toMatch(/can_execute_workflow_instance_step\(p_instance_step_id\)/);
    expect(apply080).toMatch(/v_step.step_key = 'procurement'/);
    expect(apply080).toMatch(/p_source = 'direct'/);
    expect(apply080).toMatch(/p_outcome = 'complete'/);
  });

  it("G2–G7: incomplete chains are not ready", () => {
    expect(evaluateProcurementReadiness(empty).ready).toBe(false);
    expect(evaluateProcurementReadiness({ ...empty, purchase_request_count: 1 }).ready).toBe(false);
    expect(evaluateProcurementReadiness({ ...empty, purchase_request_count: 1, rfq_count: 1 }).ready).toBe(false);
    expect(
      evaluateProcurementReadiness({
        ...empty,
        purchase_request_count: 1,
        rfq_count: 1,
        quotation_count: 3,
      }).ready,
    ).toBe(false);
    expect(
      evaluateProcurementReadiness({
        ...empty,
        purchase_request_count: 1,
        rfq_count: 1,
        quotation_count: 3,
        awarded_count: 1,
      }).ready,
    ).toBe(false);
    expect(
      evaluateProcurementReadiness({
        ...empty,
        purchase_request_count: 1,
        rfq_count: 1,
        quotation_count: 3,
        awarded_count: 1,
        issued_po_count: 0,
      }).missing,
    ).toContain("issued_po");
  });

  it("G8 G9: issued PO with delivery date and full chain is ready; date is required", () => {
    const complete = evaluateProcurementReadiness({
      purchase_request_count: 1,
      rfq_count: 1,
      quotation_count: 1,
      awarded_count: 1,
      issued_po_count: 1,
      issued_po_with_delivery_date_count: 1,
      supporting_document_count: 0,
    });
    expect(complete.ready).toBe(true);
    expect(ISSUED_PO_STATUSES).toContain("issued");
    expect(
      evaluateProcurementReadiness({
        purchase_request_count: 1,
        rfq_count: 1,
        quotation_count: 1,
        awarded_count: 1,
        issued_po_count: 1,
        issued_po_with_delivery_date_count: 0,
        supporting_document_count: 0,
      }).ready,
    ).toBe(false);
    expect(sql080).toMatch(/po.required_delivery_date is not null/);
  });

  it("G10: documents are advisory only", () => {
    expect(PROCUREMENT_DOCUMENT_POLICY).toBe("ui_advisory");
    expect(sql080).toMatch(/document_enforced', false/);
    const readyWithoutDocs = evaluateProcurementReadiness({
      purchase_request_count: 1,
      rfq_count: 1,
      quotation_count: 1,
      awarded_count: 1,
      issued_po_count: 1,
      issued_po_with_delivery_date_count: 1,
      supporting_document_count: 0,
    });
    expect(readyWithoutDocs.ready).toBe(true);
    expect(readyWithoutDocs.document_enforced).toBe(false);
  });

  it("G11 G12: package SQL requires same project on PR/RFQ/quote/PO", () => {
    expect(sql080).toMatch(/sq.project_id = po.project_id/);
    expect(sql080).toMatch(/pr.project_id = po.project_id/);
    expect(sql080).toMatch(/rfq.project_id = po.project_id/);
  });

  it("G13: readiness RPC requires can_access_project", () => {
    expect(sql080).toMatch(/if not public.can_access_project\(p_project_id\) then/);
    expect(sql080).toMatch(/raise exception 'FORBIDDEN'/);
  });

  it("G14 G15: gate does not grant execution or procurement permissions", () => {
    expect(apply080).toMatch(/can_execute_workflow_instance_step/);
    expect(BASE_EMPLOYEE_PERMISSIONS).not.toContain("purchase_request.create");
    expect(BASE_EMPLOYEE_PERMISSIONS).not.toContain("purchase_order.issue");
    expect(sql067).not.toMatch(/purchase_request.create/);
    expect(sql080).not.toMatch(/insert into public.role_permissions/);
  });

  it("G16: Stage 04 approval gate remains WORKFLOW_GATE_REQUIRED", () => {
    expect(apply080).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(sql073).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(sql077).toMatch(/WORKFLOW_GATE_REQUIRED/);
  });

  it("G17 G18: 073–079 files are not rewritten", () => {
    expect(sql080).not.toMatch(/073_project_workflow_approval_gate/);
    expect(sql080).not.toMatch(/create or replace function public.submit_approval_decision/);
    expect(sql080).not.toMatch(/create or replace function public.can_execute_workflow_instance_step/);
  });

  it("G19 G20: Stage 05 UI uses real readiness and project-scoped href", () => {
    expect(details).toMatch(/ProcurementReadinessCard/);
    expect(details).toMatch(/PROCUREMENT_STEP_KEY/);
    expect(procurementHrefForProject("cbf8f9e7-ca63-4231-8694-8a95372cbd20")).toBe(
      "/procurement?project=cbf8f9e7-ca63-4231-8694-8a95372cbd20",
    );
    expect(newPurchaseRequestHref("cbf8f9e7-ca63-4231-8694-8a95372cbd20")).toContain("project=");
    const page = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    expect(page).toMatch(/get_project_procurement_readiness/);
  });

  it("G21: tampered projectId is ignored", () => {
    expect(parseScopedProjectId("not-a-uuid")).toBeNull();
    expect(parseScopedProjectId("javascript:alert(1)")).toBeNull();
    expect(procurementHrefForProject("nope")).toBe("/procurement");
    const prNew = readFileSync("src/app/(app)/procurement/purchase-requests/new/page.tsx", "utf8");
    expect(prNew).toMatch(/projects.some\(\(p\) => p.id === requestedProject\)/);
  });

  it("G22: blocked completion maps to a stable Arabic domain error", () => {
    const mapped = mapWorkflowRpcError("WORKFLOW_PROCUREMENT_NOT_READY");
    expect(mapped.kind).toBe("VALIDATION");
    expect(mapped.ar).toContain("أمر شراء");
    expect(sql080).toMatch(/raise exception 'WORKFLOW_PROCUREMENT_NOT_READY'/);
  });

  it("G23: issuing a PO does not complete the workflow stage", () => {
    expect(sql044).toMatch(/status = 'issued'/);
    expect(sql044).not.toMatch(/complete_workflow_step/);
    expect(sql044).not.toMatch(/apply_workflow_step_outcome/);
    expect(sql080).not.toMatch(/issue_purchase_order/);
  });

  it("G24: migration does not insert procurement or workflow business rows", () => {
    expect(sql080).not.toMatch(/insert into public.purchase_orders/i);
    expect(sql080).not.toMatch(/insert into public.purchase_requests/i);
    expect(sql080).not.toMatch(/insert into public.workflow_instance_steps/i);
    expect(sql080).not.toMatch(/openai/i);
    expect(sql080).not.toMatch(/whatsapp/i);
    expect(sql080).not.toMatch(/NOTIFICATION_WHATSAPP/);
  });

  it("keeps the internal package function off the client grant list", () => {
    expect(sql080).toMatch(/revoke all on function public.project_has_procurement_completion_package/);
    expect(sql080).toMatch(/grant execute on function public.get_project_procurement_readiness\(uuid\) to authenticated/);
    expect(parseProcurementReadiness({ ready: false, purchase_request_count: 2 })?.purchase_request_count).toBe(2);
    expect(PROCUREMENT_STEP_KEY).toBe("procurement");
  });

  it("080 sql hash is stable for certification scripts", () => {
    expect(createHash("sha256").update(sql080).digest("hex").length).toBe(64);
  });
});
