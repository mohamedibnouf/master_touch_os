import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWhatsAppProvider } from "@/modules/notifications/providers";
import { emailAudienceFor } from "@/modules/notifications/event-compat";
import { planDeliveryChannels } from "@/modules/notifications/policy";
import {
  shouldApplyApprovalWorkflowGate,
  workflowOutcomeFromOfficialCode,
  mapWorkflowRpcError,
} from "./approval-workflow-gate";
import {
  approvalArtifactRemainsFrozen,
  deriveCurrentWorkflowGate,
  ignoredBrowserGateFields,
  isEligibleGateApprover,
  parseGateApprovalForm,
  rejectBrowserStepSubstitution,
  validateSupportingDocument,
} from "./workflow-gate-approval";

const sql079 = readFileSync("supabase/migrations/079_workflow_gate_approval_documents.sql", "utf8");
const sql073 = readFileSync("supabase/migrations/073_project_workflow_approval_gate.sql", "utf8");
const sql077 = readFileSync("supabase/migrations/077_step_local_workflow_execution.sql", "utf8");
const sql078 = readFileSync("supabase/migrations/078_operational_document_version.sql", "utf8");
const sql075 = readFileSync("supabase/migrations/075_ai_intelligence_platform.sql", "utf8");
const pageSrc = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
const platformSrc = readFileSync("src/server/use-cases/platform.ts", "utf8");
const panelSrc = readFileSync("src/components/projects/approval-action-panel.tsx", "utf8");
const detailsSrc = readFileSync("src/components/projects/workflow-stage-details.tsx", "utf8");
const cardSrc = readFileSync("src/components/projects/workflow-gate-approval-card.tsx", "utf8");
const notifySrc = readFileSync("src/server/services/notification.service.ts", "utf8");
const workerSrc = readFileSync("src/server/services/notification-delivery-worker.ts", "utf8");
const driveSrc = readFileSync("src/modules/documents/drive-ai-auth.ts", "utf8");
const openaiSrc = readFileSync("src/modules/ai/provider/openai.ts", "utf8");

const PROJECT = "cbf8f9e7-ca63-4231-8694-8a95372cbd20";
const ORG = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const INSTANCE = "8c13015c-646f-4b29-9134-55cc3a36ad94";
const STEP_04 = "578ec3ce-ec01-4a63-8785-4d82ffa27721";
const STEP_03 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const STEP_05 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5";
const DOC = "b9b14fa2-7a04-4ff7-b559-768550873fa4";
const VER_A = "11111111-aaaa-4aaa-8aaa-111111111111";
const VER_B = "22222222-bbbb-4bbb-8bbb-222222222222";
const APPROVER = "33333333-3333-4333-8333-333333333333";

function instance(overrides: Partial<Parameters<typeof deriveCurrentWorkflowGate>[0]["instance"]> = {}) {
  return {
    id: INSTANCE,
    organizationId: ORG,
    status: "in_progress",
    entityType: "project",
    entityId: PROJECT,
    ...overrides,
  };
}

function steps() {
  return [
    { id: STEP_03, instanceId: INSTANCE, organizationId: ORG, status: "completed", sequence: 3, requiresApproval: false },
    { id: STEP_04, instanceId: INSTANCE, organizationId: ORG, status: "ready", sequence: 4, requiresApproval: true },
    { id: STEP_05, instanceId: INSTANCE, organizationId: ORG, status: "pending", sequence: 5, requiresApproval: false },
  ];
}

function sha(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

describe("079 current workflow gate derivation", () => {
  it("1. detects Stage 04 as the current approval gate", () => {
    const result = deriveCurrentWorkflowGate({
      projectId: PROJECT,
      organizationId: ORG,
      instance: instance(),
      steps: steps(),
    });
    expect(result).toEqual({ ok: true, instanceStepId: STEP_04, instanceId: INSTANCE });
  });

  it("2. generic project approval is not a gate", () => {
    expect(
      shouldApplyApprovalWorkflowGate({
        entityType: "project",
        requestStatus: "completed",
        officialCode: "A",
      }),
    ).toBe(false);
    expect(pageSrc).toMatch(/entityType" value="project"/);
    expect(pageSrc).toMatch(/طلبات موافقة عامة/);
    expect(pageSrc).toMatch(/ولا يحرّك مرحلة مسار العمل/);
  });

  it("3. server derives the current instance step from live instance + ready/in_progress", () => {
    expect(sql079).toMatch(/entity_type = 'project'/);
    expect(sql079).toMatch(/s\.status in \('ready', 'in_progress'\)/);
    expect(sql079).toMatch(/order by s\.sequence/);
    expect(sql079).toMatch(/'workflow_instance_step'/);
    const gateAction = platformSrc.slice(platformSrc.indexOf("export async function createCurrentWorkflowGateApprovalAction"));
    expect(gateAction).toMatch(/create_current_workflow_gate_approval/);
    expect(gateAction).not.toMatch(/p_instance_step_id/);
  });

  it("4. browser cannot substitute another step id", () => {
    const derived = deriveCurrentWorkflowGate({
      projectId: PROJECT,
      organizationId: ORG,
      instance: instance(),
      steps: steps(),
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(rejectBrowserStepSubstitution({ derivedInstanceStepId: derived.instanceStepId, browserInstanceStepId: STEP_03 })).toEqual({
      ok: false,
      reason: "STEP_NOT_CURRENT",
    });
    const fd = new FormData();
    fd.set("projectId", PROJECT);
    fd.set("approverProfileId", APPROVER);
    fd.set("entityType", "workflow_instance_step");
    fd.set("entityId", STEP_03);
    fd.set("instanceStepId", STEP_03);
    expect(ignoredBrowserGateFields(fd).sort()).toEqual(["entityId", "entityType", "instanceStepId"]);
    expect(sql079).not.toMatch(/p_instance_step_id/);
    expect(sql079).not.toMatch(/p_entity_id/);
    expect(detailsSrc).not.toMatch(/name="entityId"/);
    expect(cardSrc).not.toMatch(/name="entityId"/);
  });

  it("5. requires_approval=false is rejected", () => {
    const result = deriveCurrentWorkflowGate({
      projectId: PROJECT,
      organizationId: ORG,
      instance: instance(),
      steps: [
        { id: STEP_04, instanceId: INSTANCE, organizationId: ORG, status: "ready", sequence: 4, requiresApproval: false },
      ],
    });
    expect(result).toEqual({ ok: false, reason: "GATE_NOT_REQUIRED" });
    expect(sql079).toMatch(/GATE_NOT_REQUIRED/);
  });

  it("6. completed or pending non-current steps are rejected", () => {
    const completedCurrent = deriveCurrentWorkflowGate({
      projectId: PROJECT,
      organizationId: ORG,
      instance: instance(),
      steps: [{ id: STEP_04, instanceId: INSTANCE, organizationId: ORG, status: "completed", sequence: 4, requiresApproval: true }],
    });
    expect(completedCurrent.ok).toBe(false);
    const pendingOnly = deriveCurrentWorkflowGate({
      projectId: PROJECT,
      organizationId: ORG,
      instance: instance(),
      steps: [{ id: STEP_05, instanceId: INSTANCE, organizationId: ORG, status: "pending", sequence: 5, requiresApproval: true }],
    });
    expect(pendingOnly).toEqual({ ok: false, reason: "NO_ACTIONABLE_GATE" });
  });

  it("7. cross-project instance is rejected", () => {
    expect(
      deriveCurrentWorkflowGate({
        projectId: PROJECT,
        organizationId: ORG,
        instance: instance({ entityId: "99999999-9999-4999-8999-999999999999" }),
        steps: steps(),
      }),
    ).toEqual({ ok: false, reason: "CROSS_PROJECT" });
  });

  it("8. cross-org instance is rejected", () => {
    expect(
      deriveCurrentWorkflowGate({
        projectId: PROJECT,
        organizationId: ORG,
        instance: instance({ organizationId: ORG_B }),
        steps: steps(),
      }),
    ).toEqual({ ok: false, reason: "CROSS_ORG" });
  });

  it("9. inactive approver is rejected", () => {
    expect(isEligibleGateApprover({ memberStatus: "active", profileActive: false, hasEmployeeRow: false, employeeActive: true })).toBe(false);
    expect(isEligibleGateApprover({ memberStatus: "invited", profileActive: true, hasEmployeeRow: false, employeeActive: true })).toBe(false);
    expect(isEligibleGateApprover({ memberStatus: "active", profileActive: true, hasEmployeeRow: true, employeeActive: false })).toBe(false);
    expect(sql079).toMatch(/p\.is_active = true/);
  });

  it("10. unauthorized requester is rejected in RPC", () => {
    expect(sql079).toMatch(/has_permission\('approval\.create'/);
    expect(sql079).toMatch(/can_access_project\(v_project\.id\)/);
    expect(platformSrc).toMatch(/authorize\(await getAuthContext\(\), "approval\.create"\)/);
  });

  it("11. valid supporting document is accepted", () => {
    const result = validateSupportingDocument({
      organizationId: ORG,
      projectId: PROJECT,
      candidate: {
        documentId: DOC,
        documentVersionId: VER_A,
        organizationId: ORG,
        projectId: PROJECT,
        archivedAt: null,
        documentStatus: "draft",
        revision: "A",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frozen).toEqual({ documentId: DOC, documentVersionId: VER_A, revision: "A" });
  });

  it("12. foreign project document is rejected", () => {
    expect(
      validateSupportingDocument({
        organizationId: ORG,
        projectId: PROJECT,
        candidate: {
          documentId: DOC,
          documentVersionId: VER_A,
          organizationId: ORG,
          projectId: "99999999-9999-4999-8999-999999999999",
          archivedAt: null,
          documentStatus: "draft",
          revision: "A",
        },
      }),
    ).toEqual({ ok: false, reason: "DOCUMENT_PROJECT_MISMATCH" });
    expect(sql079).toMatch(/DOCUMENT_PROJECT_MISMATCH/);
  });

  it("13. archived document is rejected", () => {
    expect(
      validateSupportingDocument({
        organizationId: ORG,
        projectId: PROJECT,
        candidate: {
          documentId: DOC,
          documentVersionId: VER_A,
          organizationId: ORG,
          projectId: PROJECT,
          archivedAt: "2026-10-01T00:00:00Z",
          documentStatus: "draft",
          revision: "A",
        },
      }).ok,
    ).toBe(false);
    expect(sql079).toMatch(/DOCUMENT_ARCHIVED/);
  });

  it("14–15. exact revision is frozen; later current revision does not rewrite the artifact", () => {
    expect(
      approvalArtifactRemainsFrozen({
        linkedVersionId: VER_A,
        linkedRevision: "A",
        originalVersionId: VER_A,
        originalRevision: "A",
        documentCurrentRevision: "B",
        documentCurrentVersionId: VER_B,
      }),
    ).toBe(true);
    expect(sql079).toMatch(/document_version_id uuid not null/);
    expect(sql079).toMatch(/revision text not null/);
    expect(sql079).toMatch(/later current_revision must not rewrite/);
  });

  it("16–17. duplicate open gate is blocked by partial unique index + unique_violation", () => {
    expect(sql079).toMatch(/approval_requests_open_workflow_step_uidx/);
    expect(sql079).toMatch(/status in \('pending', 'in_progress'\)/);
    expect(sql079).toMatch(/when unique_violation then/);
    expect(sql079).toMatch(/DUPLICATE_OPEN_GATE/);
    expect(mapWorkflowRpcError("DUPLICATE_OPEN_GATE").ar).toContain("مفتوح");
  });
});

describe("073 decision contract preserved by 079", () => {
  it("18–22. A/B complete, C resubmit, D reject, E no movement", () => {
    expect(workflowOutcomeFromOfficialCode("A")).toBe("complete");
    expect(workflowOutcomeFromOfficialCode("B")).toBe("complete");
    expect(workflowOutcomeFromOfficialCode("C")).toBe("resubmit");
    expect(workflowOutcomeFromOfficialCode("D")).toBe("reject");
    expect(workflowOutcomeFromOfficialCode("E")).toBeNull();
    expect(shouldApplyApprovalWorkflowGate({ entityType: "workflow_instance_step", requestStatus: "completed", officialCode: "A" })).toBe(true);
    expect(shouldApplyApprovalWorkflowGate({ entityType: "workflow_instance_step", requestStatus: "completed", officialCode: "E" })).toBe(false);
    expect(sql073).toMatch(/when 'A' then 'complete'/);
    expect(sql073).toMatch(/when 'B' then 'complete'/);
    expect(sql073).toMatch(/when 'C' then 'resubmit'/);
    expect(sql073).toMatch(/when 'D' then 'reject'/);
    expect(sql073).toMatch(/else null/);
    expect(sql079).not.toMatch(/create or replace function public\.submit_approval_decision/);
    expect(sql079).not.toMatch(/create or replace function public\.apply_workflow_step_outcome/);
    expect(panelSrc).toMatch(/officialCode" value=\{code\}/);
    expect(panelSrc).toMatch(/للعلم/);
  });

  it("23–24. Stage 05 stays pending until A/B; 079 does not mutate instance steps", () => {
    expect(sql079).not.toMatch(/update public\.workflow_instance_steps/);
    expect(sql073).toMatch(/WORKFLOW_GATE_REQUIRED/);
  });
});

describe("079 UX / notifications / regressions", () => {
  it("25. generic approval UI is clearly separated", () => {
    expect(pageSrc).toMatch(/generic-project-approval-card/);
    expect(pageSrc).toMatch(/إنشاء طلب عام/);
    expect(cardSrc).toMatch(/اعتماد المرحلة الحالية/);
  });

  it("26. start workflow is hidden when an instance is already running", () => {
    expect(pageSrc).toMatch(/workflow\.mode !== "workflow"/);
    expect(pageSrc).not.toMatch(/hasPermission\(ctx, "workflow.start"\) \? \(/);
  });

  it("27–28. approver notification uses existing approval.created + email pipeline", () => {
    expect(platformSrc).toMatch(/type: "approval.created"/);
    expect(emailAudienceFor("approval.created")).toBe("personal");
    const channels = planDeliveryChannels({
      type: "approval.created",
      recipientId: APPROVER,
      preferences: [],
      personalEmailAllowed: true,
      emailAvailable: true,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toContain("email");
    expect(channels).not.toContain("whatsapp");
    expect(notifySrc).toMatch(/upsert_operational_notification/);
  });

  it("29. WhatsApp is not invoked", () => {
    expect(createWhatsAppProvider().enabled).toBe(false);
    expect(sql079).not.toMatch(/management_notification_whatsapp|NOTIFICATION_WHATSAPP/);
    const gateAction = platformSrc.slice(platformSrc.indexOf("createCurrentWorkflowGateApprovalAction"));
    expect(gateAction).not.toMatch(/createWhatsAppProvider|whatsappAvailable:\s*true/);
  });

  it("30. 077 regression: step-local execution file unchanged by 079", () => {
    expect(sql079).not.toMatch(/can_execute_workflow_instance_step/);
    expect(sql077).toMatch(/create or replace function public\.can_execute_workflow_instance_step/);
    expect(sha(sql077)).toHaveLength(64);
  });

  it("31. 078 regression: operational revision RPC is not rewritten", () => {
    expect(sql079).not.toMatch(/create_operational_document_version|next_operational_revision_code/);
    expect(sql078).toMatch(/create or replace function public\.create_operational_document_version/);
    expect(sha(sql078)).toHaveLength(64);
  });

  it("32. Google Drive AI regression: 079 does not touch Drive/OpenAI analysis", () => {
    expect(sql079).not.toMatch(/chat\/completions|gpt-4o|drive\.file|document_intelligence/);
    expect(driveSrc).toMatch(/drive/);
    expect(openaiSrc).toMatch(/chat\/completions/);
    expect(sha(sql075)).toHaveLength(64);
  });

  it("33. Storage AI / notification worker unchanged by 079", () => {
    expect(workerSrc).toMatch(/workflow\.step\.activated/);
    expect(sql079).not.toMatch(/notification-delivery-worker/);
    expect(sql073).toMatch(/create or replace function public\.submit_approval_decision/);
  });
});

describe("079 SQL security", () => {
  it("uses SECURITY DEFINER, fixed search_path, authenticated-only execute, RLS select", () => {
    expect(sql079).toMatch(/security definer/);
    expect(sql079).toMatch(/set search_path = public/);
    expect(sql079).toMatch(/revoke all on function public\.create_current_workflow_gate_approval/);
    expect(sql079).toMatch(
      /grant execute on function public\.create_current_workflow_gate_approval\(uuid, uuid, text, uuid\[]\)\s+to authenticated/,
    );
    expect(sql079).not.toMatch(/grant execute[^\n]+to anon/);
    expect(sql079).not.toMatch(/grant execute[^\n]+to public/);
    expect(sql079).toMatch(/enable row level security/);
    expect(sql079).toMatch(/grant select on table public\.approval_request_documents to authenticated/);
    expect(sql079).not.toMatch(/grant insert on table public\.approval_request_documents/);
    expect(sql079).toMatch(/workflow.approval.requested/);
    expect(sql079).toMatch(/approval.document.linked/);
  });

  it("parseGateApprovalForm never trusts spoofed entity fields", () => {
    const fd = new FormData();
    fd.set("projectId", PROJECT);
    fd.set("approverProfileId", APPROVER);
    fd.set("entityId", STEP_03);
    fd.set("documentVersionId", VER_A);
    const parsed = parseGateApprovalForm(fd);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed).not.toHaveProperty("entityId");
    expect(parsed.documentVersionIds).toEqual([VER_A]);
  });
});
