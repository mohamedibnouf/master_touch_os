import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveStageAssignment } from "./workflow-view";
import {
  WORKFLOW_ASSIGN_PERMISSION,
  WORKFLOW_STEP_ASSIGNEE_CHANGED,
  assignWorkflowStepResponsibleSchema,
  canReassignWorkflowStepStatus,
  decideResponsibleEligibility,
  workflowStepNotificationRecipients,
} from "./workflow-responsibility";

const sql076 = readFileSync("supabase/migrations/076_project_workflow_step_responsibility.sql", "utf8");
const sql073 = readFileSync("supabase/migrations/073_project_workflow_approval_gate.sql", "utf8");
const sql074 = readFileSync("supabase/migrations/074_workflow_step_deadlines.sql", "utf8");

const baseEligible = {
  candidateOrganizationId: "org-a",
  projectOrganizationId: "org-a",
  orgMemberActive: true,
  profileActive: true,
  hasEmployeeInOrganization: true,
  hasActiveEmployeeInOrganization: true,
  isActiveProjectMember: true,
  isProjectManager: false,
};

describe("workflow step responsibility", () => {
  it("allows an eligible project member", () => {
    expect(decideResponsibleEligibility(baseEligible)).toBe("ok");
    expect(assignWorkflowStepResponsibleSchema.safeParse({
      projectId: "11111111-1111-1111-1111-111111111111",
      workflowStepId: "40000000-0000-0000-0000-000000000201",
      responsibleUserId: "22222222-2222-2222-2222-222222222222",
    }).success).toBe(true);
  });

  it("includes the project manager even when not listed as a member", () => {
    expect(
      decideResponsibleEligibility({
        ...baseEligible,
        isActiveProjectMember: false,
        isProjectManager: true,
      }),
    ).toBe("ok");
  });

  it("rejects unauthorized assignment permission model", () => {
    expect(WORKFLOW_ASSIGN_PERMISSION).toBe("workflow.manage");
    expect(WORKFLOW_ASSIGN_PERMISSION).not.toBe("workflow.advance");
  });

  it("rejects a cross-organization user", () => {
    expect(
      decideResponsibleEligibility({
        ...baseEligible,
        candidateOrganizationId: "org-b",
      }),
    ).toBe("cross_org");
  });

  it("rejects inactive org members, profiles, and employees", () => {
    expect(decideResponsibleEligibility({ ...baseEligible, orgMemberActive: false })).toBe("inactive");
    expect(decideResponsibleEligibility({ ...baseEligible, profileActive: false })).toBe("inactive");
    expect(
      decideResponsibleEligibility({
        ...baseEligible,
        hasEmployeeInOrganization: true,
        hasActiveEmployeeInOrganization: false,
      }),
    ).toBe("inactive");
  });

  it("rejects a user who is not on the project team", () => {
    expect(
      decideResponsibleEligibility({
        ...baseEligible,
        isActiveProjectMember: false,
        isProjectManager: false,
      }),
    ).toBe("not_on_project");
  });

  it("keeps assignments project-scoped in the unique key", () => {
    expect(sql076).toMatch(/unique \(project_id, workflow_step_id\)/);
    expect(sql076).toMatch(/project_id uuid not null references public\.projects/);
    expect(sql076).toMatch(/organization_id uuid not null references public\.organizations/);
  });

  it("does not mutate workflow template steps globally", () => {
    expect(sql076).not.toMatch(/update public\.workflow_steps/i);
    expect(sql076).toMatch(/project_workflow_step_assignments/);
  });

  it("start_workflow copies project assignment onto the instance step", () => {
    expect(sql076).toMatch(/create or replace function public\.start_workflow\(/);
    expect(sql076).toMatch(/responsible_user_id/);
    expect(sql076).toMatch(/from public\.project_workflow_step_assignments/);
    expect(sql076).toMatch(/v_step\.assigned_role_id/);
    expect(sql076).toMatch(/v_step\.assigned_user_id/);
    expect(sql076).toMatch(/status in \('pending', 'in_progress'\)/);
  });

  it("preserves role authorization and does not rewrite can_act_on_workflow_step", () => {
    expect(sql076).not.toMatch(/create or replace function public\.can_act_on_workflow_step/);
    expect(sql076).toMatch(/assigned_role_id/);
    expect(sql073).toMatch(/can_act_on_workflow_step/);
  });

  it("blocks improper reassignment of completed steps", () => {
    expect(canReassignWorkflowStepStatus("completed")).toBe(false);
    expect(canReassignWorkflowStepStatus("skipped")).toBe(false);
    expect(canReassignWorkflowStepStatus("rejected")).toBe(false);
    expect(canReassignWorkflowStepStatus("cancelled")).toBe(false);
    expect(sql076).toMatch(/v_instance_step\.status in \('completed', 'skipped', 'rejected', 'cancelled'\)/);
  });

  it("reassignment updates responsible_user_id only", () => {
    expect(sql076).toMatch(/set responsible_user_id = p_responsible_user_id/);
    expect(sql076).not.toMatch(/update public\.workflow_instance_steps[\s\S]{0,80}set status/i);
    expect(sql076).not.toMatch(/set assigned_role_id = p_/);
  });

  it("writes an assignee_changed audit event", () => {
    expect(WORKFLOW_STEP_ASSIGNEE_CHANGED).toBe("workflow.step.assignee_changed");
    expect(sql076).toMatch(/workflow\.step\.assignee_changed/);
    expect(sql076).toMatch(/log_audit/);
    expect(sql076).toMatch(/previous_responsible_user_id/);
    expect(sql076).toMatch(/new_responsible_user_id/);
  });

  it("keeps a single active instance guard", () => {
    expect(sql076).toMatch(/raise exception 'CONFLICT'/);
    expect(sql076).toMatch(/entity_id = p_entity_id/);
  });

  it("does not rewrite 073 approval gates or 074 deadlines", () => {
    expect(sql076).not.toMatch(/create or replace function public\.complete_workflow_step/);
    expect(sql076).not.toMatch(/create or replace function public\.apply_workflow_step_outcome/);
    expect(sql076).not.toMatch(/create or replace function public\.submit_approval_decision/);
    expect(sql076).not.toMatch(/create or replace function public\.update_workflow_step_deadline/);
    expect(sql073).toMatch(/WORKFLOW_GATE_REQUIRED/);
    expect(sql074).toMatch(/due_at/);
  });

  it("notification recipients prefer the responsible user without duplicating role holders", () => {
    expect(
      workflowStepNotificationRecipients({
        responsibleUserId: "u1",
        assignedUserId: "u1",
        roleHolderIds: ["u1", "u2"],
      }),
    ).toEqual(["u1", "u2"]);
  });

  it("displays the responsible person ahead of the authorization role", () => {
    expect(
      resolveStageAssignment({
        responsibleUserId: "u1",
        assignedUserId: null,
        assignedRoleId: "r1",
        assignedDepartmentId: null,
        profileNames: new Map([["u1", "محمد"]]),
        roleNames: new Map([["r1", "مدير المشروع"]]),
        departmentNames: new Map(),
        jobTitles: new Map([["u1", "مهندس"]]),
      }),
    ).toEqual({ kind: "user", label: "محمد", subtitle: "مهندس" });
  });
});
