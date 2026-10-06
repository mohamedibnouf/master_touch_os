import { z } from "zod";
import { isPostgresUuid } from "@/lib/postgres-uuid";
import { uniqueProfileIds } from "@/modules/projects/deadline";

const postgresUuid = z.string().refine(isPostgresUuid, { message: "Invalid uuid" });

export const WORKFLOW_STEP_ASSIGNEE_CHANGED = "workflow.step.assignee_changed";
export const WORKFLOW_ASSIGN_PERMISSION = "workflow.manage" as const;

const LOCKED_STEP_STATUSES = new Set(["completed", "skipped", "rejected", "cancelled"]);

export const assignWorkflowStepResponsibleSchema = z.object({
  projectId: postgresUuid,
  workflowStepId: postgresUuid,
  responsibleUserId: postgresUuid,
});

export type EligibleResponsibleDecision = "ok" | "cross_org" | "inactive" | "not_on_project";

export function decideResponsibleEligibility(input: {
  candidateOrganizationId: string;
  projectOrganizationId: string;
  orgMemberActive: boolean;
  profileActive: boolean;
  hasEmployeeInOrganization: boolean;
  hasActiveEmployeeInOrganization: boolean;
  isActiveProjectMember: boolean;
  isProjectManager: boolean;
}): EligibleResponsibleDecision {
  if (input.candidateOrganizationId !== input.projectOrganizationId) return "cross_org";
  if (!input.orgMemberActive || !input.profileActive) return "inactive";
  if (input.hasEmployeeInOrganization && !input.hasActiveEmployeeInOrganization) return "inactive";
  if (!input.isActiveProjectMember && !input.isProjectManager) return "not_on_project";
  return "ok";
}

export function canReassignWorkflowStepStatus(status: string | null): boolean {
  if (!status) return true;
  return !LOCKED_STEP_STATUSES.has(status);
}

export function workflowStepNotificationRecipients(input: {
  responsibleUserId: string | null;
  assignedUserId: string | null;
  roleHolderIds: string[];
}): string[] {
  return uniqueProfileIds([input.responsibleUserId, input.assignedUserId, ...input.roleHolderIds]);
}

export function eligibleResponsibleRejectMessage(reason: EligibleResponsibleDecision): { ar: string; en: string } {
  if (reason === "cross_org") {
    return { ar: "لا يمكن تعيين مستخدم من مؤسسة أخرى.", en: "A user from another organization cannot be assigned." };
  }
  if (reason === "inactive") {
    return { ar: "لا يمكن تعيين مستخدم غير نشط.", en: "An inactive user cannot be assigned." };
  }
  return { ar: "يجب أن يكون المسؤول عضواً في فريق المشروع أو مدير المشروع.", en: "The responsible person must be a project team member or the project manager." };
}
