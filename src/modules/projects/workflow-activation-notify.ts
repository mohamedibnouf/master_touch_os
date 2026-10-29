import { uniqueProfileIds } from "@/modules/projects/deadline";

export const WORKFLOW_ACTIVATION_FLUSH_LIMIT = 25;

export function workflowStepActivatedDedupKey(instanceStepId: string, userId: string): string {
  return `workflow.step.activated:${instanceStepId}:${userId}`;
}

export function workflowStepActivatedMessage(input: { nameAr: string | null; dueLabel: string | null }): string {
  return [input.nameAr ? `المرحلة: ${input.nameAr}` : "تم تفعيل مرحلة تالية في مسار العمل.", input.dueLabel ? `موعد الإغلاق: ${input.dueLabel}` : null]
    .filter(Boolean)
    .join(" — ");
}

/** English counterpart of `workflowStepActivatedMessage` (falls back to the Arabic stage name). */
export function workflowStepActivatedMessageEn(input: {
  nameEn: string | null;
  nameAr: string | null;
  dueLabel: string | null;
}): string {
  const name = input.nameEn?.trim() || input.nameAr?.trim() || null;
  return [name ? `Stage: ${name}` : "The next stage of the workflow has been activated.", input.dueLabel ? `Due: ${input.dueLabel}` : null]
    .filter(Boolean)
    .join(" — ");
}

export function workflowActivationRecipients(input: {
  responsibleUserId: string | null;
  assignedUserId: string | null;
  roleHolderIds: string[];
}): string[] {
  return uniqueProfileIds([input.responsibleUserId, input.assignedUserId, ...input.roleHolderIds]);
}
