import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { archiveRestrictionFor } from "@/modules/documents/lifecycle";
import { canShowStartWorkflowForm } from "./start-workflow-input";

const sql088 = readFileSync("supabase/migrations/088_workflow_integrity.sql", "utf8");
const platformSrc = readFileSync("src/server/use-cases/platform.ts", "utf8");
const engineeringSrc = readFileSync("src/server/use-cases/engineering.ts", "utf8");
const lifecycleSrc = readFileSync("src/server/use-cases/document-lifecycle.ts", "utf8");
const pageSrc = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
const stageDetailsSrc = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");

function fnSlice(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  return src.slice(from, to === -1 ? undefined : to);
}

const applyFn = fnSlice(
  sql088,
  "create or replace function public.apply_workflow_step_outcome(",
  "revoke all on function public.apply_workflow_step_outcome",
);
const startFn = fnSlice(
  sql088,
  "create or replace function public.start_workflow(",
  "revoke all on function public.start_workflow",
);

describe("088 migration hygiene", () => {
  it("is additive: no drop table/column/policy, no role or database changes", () => {
    expect(sql088).not.toMatch(/\bdrop\s+table\b/i);
    expect(sql088).not.toMatch(/\bdrop\s+column\b/i);
    expect(sql088).not.toMatch(/\bdrop\s+policy\b/i);
    expect(sql088).not.toMatch(/\balter\s+role\b/i);
    expect(sql088).not.toMatch(/\balter\s+database\b/i);
    expect(sql088).toMatch(/^-- Master Touch OS — 088/);
    expect(sql088).toContain("-- Safety:");
  });

  it("re-creates triggers idempotently", () => {
    expect(sql088).toContain("drop trigger if exists approval_requests_00_integrity_guard on public.approval_requests;");
    expect(sql088).toContain("drop trigger if exists approval_steps_00_integrity_guard on public.approval_steps;");
  });
});

describe("finding 1 — no direct writes to workflow / approval outcome state", () => {
  it("trust is derived from current_user in an invoker function", () => {
    expect(sql088).toMatch(/select current_user in \('authenticated', 'anon'\);/);
    expect(sql088).toMatch(
      /create or replace function public\.workflow_write_is_untrusted\(\)[\s\S]*?security invoker/,
    );
    expect(sql088).toMatch(
      /create or replace function public\.guard_approval_request_integrity\(\)[\s\S]*?security invoker/,
    );
    expect(sql088).toMatch(
      /create or replace function public\.guard_approval_step_integrity\(\)[\s\S]*?security invoker/,
    );
  });

  it("revokes client writes on workflow engine tables and approval decisions", () => {
    expect(sql088).toContain("revoke insert, update, delete on table public.workflow_instances from anon, authenticated;");
    expect(sql088).toContain("revoke insert, update, delete on table public.workflow_instance_steps from anon, authenticated;");
    expect(sql088).toContain("revoke insert, update, delete on table public.approval_actions from anon, authenticated;");
    expect(sql088).toContain("revoke update, delete on table public.approval_requests from anon, authenticated;");
    expect(sql088).toContain("revoke update, delete on table public.approval_steps from anon, authenticated;");
    // App inserts (commercial / finance / procurement / generic approvals) keep INSERT.
    expect(sql088).not.toMatch(/revoke[^;]*insert[^;]*public\.approval_requests/);
    expect(sql088).not.toMatch(/revoke[^;]*insert[^;]*public\.approval_steps/);
  });

  it("an untrusted approval request starts open, undecided, self-requested and never as a gate", () => {
    const guard = fnSlice(sql088, "function public.guard_approval_request_integrity()", "$$;");
    expect(guard).toMatch(/new\.status not in \('pending', 'in_progress'\)/);
    expect(guard).toMatch(/new\.official_code is not null/);
    expect(guard).toMatch(/new\.official_outcome is distinct from 'pending'/);
    expect(guard).toMatch(/new\.entity_type = 'workflow_instance_step'/);
    expect(guard).toMatch(/new\.requested_by is distinct from auth\.uid\(\)/);
  });

  it("an untrusted approval step needs an open, non-gate request owned by the caller", () => {
    const guard = fnSlice(sql088, "function public.guard_approval_step_integrity()", "$$;");
    expect(guard).toMatch(/new\.status not in \('pending', 'in_progress'\)/);
    expect(guard).toMatch(/v_request\.status not in \('pending', 'in_progress'\)/);
    expect(guard).toMatch(/v_request\.entity_type = 'workflow_instance_step'/);
    expect(guard).toMatch(/v_request\.requested_by is distinct from auth\.uid\(\)/);
  });

  it("keeps every RPC it re-creates as security definer", () => {
    expect(applyFn).toMatch(/security definer/);
    expect(startFn).toMatch(/security definer/);
  });
});

describe("finding 2 — C / D on a gate re-opens the gate", () => {
  it("resubmit resets the gate itself (<=)", () => {
    expect(applyFn).toMatch(/and s\.sequence <= v_step\.sequence;/);
    expect(applyFn).not.toMatch(/and s\.sequence < v_step\.sequence;/);
  });

  it("reject with a return step resets target..gate inclusive to pending", () => {
    expect(applyFn).toMatch(/if v_target\.sequence < v_step\.sequence then/);
    expect(applyFn).toMatch(/s\.sequence > v_target\.sequence\s+and s\.sequence <= v_step\.sequence/);
  });

  it("keeps A/B completion and reject-without-target cancellation", () => {
    expect(applyFn).toMatch(/r\.official_code in \('A', 'B'\)/);
    expect(applyFn).toMatch(/set status = 'cancelled', completed_at = timezone\('utc', now\(\)\)/);
    expect(applyFn).toMatch(/update public\.workflow_instances\s+set status = 'completed'/);
    expect(applyFn).toContain("WORKFLOW_HANDOVER_NOT_READY");
    expect(applyFn).toContain("WORKFLOW_PROCUREMENT_NOT_READY");
  });

  it("a gate approval from an earlier pass does not satisfy a re-opened gate", () => {
    expect(applyFn).toMatch(/>= coalesce\(v_step\.started_at, '-infinity'::timestamptz\)/);
  });
});

describe("finding 3 / 5 / 9 — project page", () => {
  it("shows the start form after a cancelled workflow but not after a completed one", () => {
    expect(canShowStartWorkflowForm({ mode: "default", latestInstanceStatus: null })).toBe(true);
    expect(canShowStartWorkflowForm({ mode: "preview", latestInstanceStatus: null })).toBe(true);
    expect(canShowStartWorkflowForm({ mode: "workflow", latestInstanceStatus: "in_progress" })).toBe(false);
    expect(canShowStartWorkflowForm({ mode: "workflow", latestInstanceStatus: "cancelled" })).toBe(true);
    expect(canShowStartWorkflowForm({ mode: "workflow", latestInstanceStatus: "completed" })).toBe(false);
    expect(pageSrc).toMatch(/canShowStartWorkflowForm\(/);
    expect(pageSrc).not.toMatch(/workflow\.mode !== "workflow" \? \(/);
  });

  it("passes the English stage name to the gate submit form", () => {
    expect(stageDetailsSrc).toMatch(/stageNameEn=\{node\.nameEn\}/);
  });
});

describe("finding 4 / 6 — platform actions", () => {
  const createApproval = fnSlice(
    platformSrc,
    "export async function createApprovalAction",
    "export async function createCurrentWorkflowGateApprovalAction",
  );
  const assignMember = fnSlice(
    platformSrc,
    "export async function assignProjectMemberAction",
    "export async function updateProjectStageAction",
  );

  it("createApprovalAction refuses workflow_instance_step before any insert", () => {
    const refuse = createApproval.indexOf('parsed.data.entityType === "workflow_instance_step"');
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(createApproval.indexOf('.from("approval_requests")'));
  });

  it("assignProjectMemberAction upserts on the unique keys and checks the assignment error", () => {
    expect(assignMember).toContain('{ onConflict: "project_id,profile_id" }');
    expect(assignMember).toContain('{ onConflict: "employee_id,project_id" }');
    expect(assignMember).toMatch(/if \(assignmentError\) throw new DatabaseError\(assignmentError\)/);
  });
});

describe("finding 7 / 8 — engineering", () => {
  const transmittal = fnSlice(
    engineeringSrc,
    "export async function createTransmittalAction",
    "export async function issueTransmittalAction",
  );

  it("validates transmittal documents before registering the TRN number", () => {
    const validate = transmittal.indexOf('.from("documents")');
    const register = transmittal.indexOf("await registerDoc(");
    expect(validate).toBeGreaterThan(0);
    expect(validate).toBeLessThan(register);
    expect(transmittal).toMatch(/d\.project_id !== projectId/);
    expect(transmittal).toMatch(/d\.archived_at !== null/);
    expect(transmittal.indexOf("versionByDocument.has(id)")).toBeLessThan(register);
  });

  it("guards RFI response, inspection result and NCR close by status on the write", () => {
    expect(engineeringSrc).toMatch(/\.in\("status", RFI_RESPONDABLE_STATUSES\)/);
    expect(engineeringSrc).toMatch(/\.in\("status", INSPECTION_RESULTABLE_STATUSES\)/);
    expect(engineeringSrc).toMatch(/\.in\("status", NCR_CLOSABLE_STATUSES\)/);
    expect(engineeringSrc).toMatch(/RFI_RESPONDABLE_STATUSES: string\[\] = \["submitted", "under_review"\]/);
  });

  it("notifies the site engineer / requester of a failed inspection, not the inspector", () => {
    const record = fnSlice(
      engineeringSrc,
      "export async function recordInspectionResultAction",
      "export async function createReinspectionAction",
    );
    expect(record).not.toMatch(/recipientProfileId: ctx\.userId/);
    expect(record).toMatch(/existing\.site_engineer_id/);
  });
});

describe("finding 9 / 10 — document lifecycle", () => {
  it("passes the request locale and localizes success text", () => {
    expect(lifecycleSrc).toMatch(/formActionFailure\(err, "[^"]+", locale\)/);
    expect(lifecycleSrc).not.toMatch(/formActionFailure\(err, "[^"]+"\)/);
    expect(lifecycleSrc).toContain("Document restored.");
  });

  it("refuses archiving a document frozen into an open approval", () => {
    expect(lifecycleSrc).toContain('.from("approval_request_documents")');
    expect(
      archiveRestrictionFor({
        is_register_controlled: false,
        approval_request_id: null,
        workflow_instance_id: null,
        hasEngineeringLink: false,
        hasTransmittalItem: false,
        isProjectBusinessCase: false,
        hasEmployeeDocumentLink: false,
        hasOpenGateApprovalLink: true,
      }),
    ).toBe("workflow");
  });

  it("start_workflow checks definition and entity organization", () => {
    expect(startFn).toMatch(/v_def_org is not null and v_def_org is distinct from p_organization_id/);
    expect(startFn).toMatch(/from public\.projects where id = p_entity_id and organization_id = p_organization_id/);
  });
});
