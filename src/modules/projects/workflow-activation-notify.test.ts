import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { emailAudienceFor } from "@/modules/notifications/event-compat";
import { whatsappAudienceFor } from "@/modules/notifications/whatsapp-policy";
import { workflowStepNotificationRecipients } from "./workflow-responsibility";
import {
  WORKFLOW_ACTIVATION_FLUSH_LIMIT,
  workflowActivationRecipients,
  workflowStepActivatedDedupKey,
  workflowStepActivatedMessage,
} from "./workflow-activation-notify";

const platformSrc = readFileSync("src/server/use-cases/platform.ts", "utf8");
const workerSrc = readFileSync("src/server/services/notification-delivery-worker.ts", "utf8");
const hubSrc = readFileSync("src/server/use-cases/notifications-hub.ts", "utf8");
const assignFn = platformSrc.slice(
  platformSrc.indexOf("export async function assignWorkflowStepResponsibleAction"),
  platformSrc.indexOf("export async function completeWorkflowStepAction"),
);
const startFn = platformSrc.slice(
  platformSrc.indexOf("export async function startWorkflowAction"),
  platformSrc.indexOf("export async function updateWorkflowStepDeadlineAction"),
);
const completeFn = platformSrc.slice(
  platformSrc.indexOf("export async function completeWorkflowStepAction"),
  platformSrc.indexOf("export async function createApprovalAction"),
);
const canActSrc = readFileSync("supabase/migrations/014_assignee_enforcement.sql", "utf8");
const sql076 = readFileSync("supabase/migrations/076_project_workflow_step_responsibility.sql", "utf8");
const sql073 = readFileSync("supabase/migrations/073_project_workflow_approval_gate.sql", "utf8");
const sql074 = readFileSync("supabase/migrations/074_workflow_step_deadlines.sql", "utf8");

describe("workflow activation notifications", () => {
  it("notifies the responsible person for the first READY step after start", () => {
    expect(startFn).toMatch(/notifyWorkflowReadyAssignees/);
    expect(workerSrc).toMatch(/status", "ready"/);
    expect(workerSrc).toMatch(/type: "workflow\.step\.activated"/);
    expect(workerSrc).toMatch(/responsibleUserId: row\.responsible_user_id/);
    expect(
      workflowStepActivatedMessage({ nameAr: "البداية", dueLabel: "الثلاثاء" }),
    ).toContain("البداية");
  });

  it("queues personal email for workflow.step.activated and flushes the delivery worker", () => {
    expect(emailAudienceFor("workflow.step.activated")).toBe("personal");
    expect(workerSrc).toMatch(/flushWorkflowActivationDeliveries/);
    expect(workerSrc).toMatch(/processPendingNotificationDeliveries/);
    expect(hubSrc).toMatch(/processPendingNotificationDeliveries\(admin/);
    expect(WORKFLOW_ACTIVATION_FLUSH_LIMIT).toBe(25);
  });

  it("dedupes the same responsible and role holder", () => {
    expect(
      workflowActivationRecipients({
        responsibleUserId: "u1",
        assignedUserId: null,
        roleHolderIds: ["u1"],
      }),
    ).toEqual(["u1"]);
    expect(workflowStepNotificationRecipients({
      responsibleUserId: "u1",
      assignedUserId: null,
      roleHolderIds: ["u1"],
    })).toEqual(["u1"]);
  });

  it("keeps a distinct role holder alongside the responsible person", () => {
    expect(
      workflowActivationRecipients({
        responsibleUserId: "u-responsible",
        assignedUserId: null,
        roleHolderIds: ["u-role"],
      }),
    ).toEqual(["u-responsible", "u-role"]);
  });

  it("notifies later READY steps after completion", () => {
    expect(completeFn).toMatch(/notifyWorkflowReadyAssignees/);
    expect(completeFn).toMatch(/complete_workflow_step/);
  });

  it("notifies later READY steps after an approval decision", () => {
    expect(platformSrc).toMatch(/entity_type === "workflow_instance_step"/);
    const decide = platformSrc.slice(platformSrc.indexOf("submit_approval_decision"));
    expect(decide).toMatch(/notifyWorkflowReadyAssignees/);
  });

  it("falls back to role holders when no responsible person is set", () => {
    expect(
      workflowActivationRecipients({
        responsibleUserId: null,
        assignedUserId: null,
        roleHolderIds: ["u-role"],
      }),
    ).toEqual(["u-role"]);
  });

  it("does not emit workflow.step.activated for a pre-start assignment", () => {
    expect(assignFn).not.toMatch(/notifyWorkflowReadyAssignees/);
    expect(assignFn).toMatch(/liveStep/);
    expect(sql076).not.toMatch(/workflow\.step\.activated/);
  });

  it("uses a stable per-step per-user dedup key so refresh does not duplicate", () => {
    const key = workflowStepActivatedDedupKey("step-1", "user-1");
    expect(key).toBe("workflow.step.activated:step-1:user-1");
    expect(workerSrc).toMatch(/workflowStepActivatedDedupKey\(row\.id, userId\)/);
  });

  it("does not create a second email row for the same activation retry", () => {
    expect(workerSrc).toMatch(/dedupKey: workflowStepActivatedDedupKey/);
    const sql062 = readFileSync("supabase/migrations/062_phase5_notification_communication_hub.sql", "utf8");
    expect(sql062).toMatch(/on conflict \(organization_id, recipient_profile_id, dedup_key\)/);
    expect(sql062).toMatch(/on conflict \(notification_id, channel\) do nothing/);
  });

  it("does not grant workflow authorization to the responsible person", () => {
    expect(canActSrc).not.toMatch(/responsible_user_id/);
    expect(sql076).not.toMatch(/create or replace function public\.can_act_on_workflow_step/);
  });

  it("does not roll back the workflow if email flush fails", () => {
    expect(workerSrc).toMatch(/flushWorkflowActivationDeliveries/);
    expect(workerSrc).toMatch(/workflow activation delivery flush failed/);
    expect(startFn).toMatch(/await supabase\.rpc\("start_workflow"/);
    const rpcThenNotify = startFn.indexOf('rpc("start_workflow"') < startFn.indexOf("notifyWorkflowReadyAssignees");
    expect(rpcThenNotify).toBe(true);
  });

  it("does not enable WhatsApp for workflow activation", () => {
    expect(whatsappAudienceFor("workflow.step.activated")).toBe("none");
    expect(emailAudienceFor("workflow.step.activated")).toBe("personal");
  });

  it("leaves 073, 074, and 076 contracts in place", () => {
    expect(sql073).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(sql074).toMatch(/update_workflow_step_deadline/);
    expect(sql076).toMatch(/project_workflow_step_assignments/);
    expect(sql076).toMatch(/v_responsible/);
  });
});
