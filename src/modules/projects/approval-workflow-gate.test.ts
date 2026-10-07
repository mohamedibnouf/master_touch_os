import { describe, expect, it } from "vitest";
import { applyWorkflowStepOutcome, type WorkflowStepDefinition, type WorkflowStepRuntime } from "@/server/domain/workflow";
import { emailAudienceFor } from "@/modules/notifications/event-compat";
import { createWhatsAppProvider } from "@/modules/notifications/providers";
import {
  activityNarrative,
  canDirectCompleteApprovalGate,
  mapWorkflowRpcError,
  shouldApplyApprovalWorkflowGate,
  validateWorkflowApprovalLink,
  workflowOutcomeFromOfficialCode,
} from "./approval-workflow-gate";

const definitions: WorkflowStepDefinition[] = [
  { id: "d1", key: "design", sequence: 1, onRejectStepKey: null, onResubmitStepKey: null },
  { id: "d2", key: "gate", sequence: 2, onRejectStepKey: "design", onResubmitStepKey: "design" },
  { id: "d3", key: "execution", sequence: 3, onRejectStepKey: null, onResubmitStepKey: null },
];

function steps(statuses: Array<WorkflowStepRuntime["status"]>): WorkflowStepRuntime[] {
  return [
    { id: "s1", definitionStepId: "d1", key: "design", sequence: 1, status: statuses[0]! },
    { id: "s2", definitionStepId: "d2", key: "gate", sequence: 2, status: statuses[1]! },
    { id: "s3", definitionStepId: "d3", key: "execution", sequence: 3, status: statuses[2]! },
  ];
}

describe("official A–E → workflow outcome", () => {
  it("uses the approval domain mapping, not inferred aliases", () => {
    expect(workflowOutcomeFromOfficialCode("A")).toBe("complete");
    expect(workflowOutcomeFromOfficialCode("B")).toBe("complete");
    expect(workflowOutcomeFromOfficialCode("C")).toBe("resubmit");
    expect(workflowOutcomeFromOfficialCode("D")).toBe("reject");
    expect(workflowOutcomeFromOfficialCode("E")).toBeNull();
  });
});

describe("approval gate application", () => {
  it("applies only when the approval request is completed on a workflow step", () => {
    expect(
      shouldApplyApprovalWorkflowGate({
        entityType: "workflow_instance_step",
        requestStatus: "in_progress",
        officialCode: "A",
      }),
    ).toBe(false);
    expect(
      shouldApplyApprovalWorkflowGate({
        entityType: "project",
        requestStatus: "completed",
        officialCode: "A",
      }),
    ).toBe(false);
    expect(
      shouldApplyApprovalWorkflowGate({
        entityType: "workflow_instance_step",
        requestStatus: "completed",
        officialCode: "E",
      }),
    ).toBe(false);
    expect(
      shouldApplyApprovalWorkflowGate({
        entityType: "workflow_instance_step",
        requestStatus: "completed",
        officialCode: "A",
      }),
    ).toBe(true);
  });
});

describe("link validation", () => {
  it("rejects missing step, missing instance, or org mismatch", () => {
    expect(
      validateWorkflowApprovalLink({
        requestOrganizationId: "org-a",
        entityType: "workflow_instance_step",
        entityId: "s1",
        stepOrganizationId: "org-b",
        instanceOrganizationId: "org-a",
        stepExists: true,
        instanceExists: true,
      }),
    ).toBe("WORKFLOW_LINK_INVALID");
    expect(
      validateWorkflowApprovalLink({
        requestOrganizationId: "org-a",
        entityType: "workflow_instance_step",
        entityId: "s1",
        stepOrganizationId: "org-a",
        instanceOrganizationId: "org-a",
        stepExists: false,
        instanceExists: true,
      }),
    ).toBe("WORKFLOW_LINK_INVALID");
    expect(
      validateWorkflowApprovalLink({
        requestOrganizationId: "org-a",
        entityType: "workflow_instance_step",
        entityId: "s1",
        stepOrganizationId: "org-a",
        instanceOrganizationId: "org-a",
        stepExists: true,
        instanceExists: true,
      }),
    ).toBe("ok");
    expect(
      validateWorkflowApprovalLink({
        requestOrganizationId: "org-a",
        entityType: "workflow_instance_step",
        entityId: "s1",
        stepOrganizationId: "org-a",
        instanceOrganizationId: "org-a",
        stepExists: true,
        instanceExists: true,
        instanceIsLive: false,
      }),
    ).toBe("WORKFLOW_LINK_INVALID");
    expect(
      validateWorkflowApprovalLink({
        requestOrganizationId: "org-a",
        entityType: "workflow_instance_step",
        entityId: "s1",
        stepOrganizationId: "org-a",
        instanceOrganizationId: "org-a",
        stepExists: true,
        instanceExists: true,
        boundProjectId: "project-a",
        instanceEntityType: "project",
        instanceEntityId: "project-b",
      }),
    ).toBe("WORKFLOW_LINK_INVALID");
  });
});

describe("requires_approval bypass", () => {
  it("denies direct complete until A/B exists, and allows approval_gate without workflow.manage", () => {
    expect(
      canDirectCompleteApprovalGate({
        requiresApproval: true,
        source: "direct",
        satisfiedOfficialCodes: [],
      }),
    ).toBe(false);
    expect(
      canDirectCompleteApprovalGate({
        requiresApproval: true,
        source: "direct",
        satisfiedOfficialCodes: ["A"],
      }),
    ).toBe(true);
    expect(
      canDirectCompleteApprovalGate({
        requiresApproval: true,
        source: "approval_gate",
        satisfiedOfficialCodes: [],
      }),
    ).toBe(true);
  });
});

describe("transition semantics after gate", () => {
  it("A/B completes the gate and activates the next step once", () => {
    const first = applyWorkflowStepOutcome({
      instanceStatus: "in_progress",
      steps: steps(["completed", "ready", "pending"]),
      definitions,
      stepId: "s2",
      outcome: "complete",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.updates).toContainEqual({ stepId: "s2", status: "completed" });
    expect(first.updates).toContainEqual({ stepId: "s3", status: "ready" });

    const again = applyWorkflowStepOutcome({
      instanceStatus: "in_progress",
      steps: steps(["completed", "completed", "ready"]),
      definitions,
      stepId: "s2",
      outcome: "complete",
    });
    expect(again).toEqual({ ok: false, reason: "already_completed" });
  });

  it("C returns to the resubmit target without deleting history", () => {
    const result = applyWorkflowStepOutcome({
      instanceStatus: "in_progress",
      steps: steps(["completed", "in_progress", "pending"]),
      definitions,
      stepId: "s2",
      outcome: "resubmit",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updates.some((u) => u.stepId === "s1" && u.status === "ready")).toBe(true);
  });

  it("D follows on_reject to the designated step", () => {
    const result = applyWorkflowStepOutcome({
      instanceStatus: "in_progress",
      steps: steps(["completed", "in_progress", "pending"]),
      definitions,
      stepId: "s2",
      outcome: "reject",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updates.some((u) => u.stepId === "s1" && u.status === "ready")).toBe(true);
  });

  it("final complete finishes the instance", () => {
    const result = applyWorkflowStepOutcome({
      instanceStatus: "in_progress",
      steps: steps(["completed", "completed", "ready"]),
      definitions,
      stepId: "s3",
      outcome: "complete",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instanceStatus).toBe("completed");
  });
});

describe("rpc error mapping", () => {
  it("maps gate and link failures to validation, not raw SQL", () => {
    expect(mapWorkflowRpcError("WORKFLOW_GATE_REQUIRED").kind).toBe("VALIDATION");
    expect(mapWorkflowRpcError("WORKFLOW_LINK_INVALID").ar).toContain("ارتباط");
    expect(mapWorkflowRpcError("CONFLICT").kind).toBe("CONFLICT");
    expect(mapWorkflowRpcError("WORKFLOW_PROCUREMENT_NOT_READY").ar).toContain("أمر شراء");
    expect(mapWorkflowRpcError("WORKFLOW_MOBILIZATION_NOT_READY").ar).toContain("التجهيز");
    expect(mapWorkflowRpcError("WORKFLOW_EXECUTION_NOT_READY").ar).toContain("التنفيذ");
    expect(mapWorkflowRpcError("WORKFLOW_COMMISSIONING_NOT_READY").ar).toContain("اختبارات التشغيل");
    expect(mapWorkflowRpcError("WORKFLOW_HANDOVER_NOT_READY").ar).toContain("متطلبات التسليم");
  });
});

describe("activity + notifications policy", () => {
  it("explains automatic transition from audit payload", () => {
    expect(activityNarrative("workflow.step.completed", { automatic: true, source: "approval_gate" })).toContain(
      "تلقائياً",
    );
    expect(activityNarrative("approval.approved", { official_code: "A" })).toBeNull();
  });

  it("emails activation and approvals while keeping WhatsApp disabled", () => {
    expect(emailAudienceFor("workflow.step.activated")).toBe("personal");
    expect(emailAudienceFor("approval.created")).toBe("personal");
    expect(emailAudienceFor("workflow.step.completed")).toBe("none");
    expect(createWhatsAppProvider().enabled).toBe(false);
  });
});
