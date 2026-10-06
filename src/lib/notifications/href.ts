import { commercialEntityHref } from "@/lib/commercial/entity-routes";
import { isPostgresUuid } from "@/lib/postgres-uuid";
import { safeNotificationHref } from "@/modules/notifications/safety";

const ACTIONABLE_TYPES = new Set([
  "workflow.step.activated",
  "workflow.completed",
  "approval.created",
  "approval.approved",
  "approval.rejected",
  "approval.resubmitted",
  "leave_request.submitted",
  "leave_request.approved",
  "leave_request.rejected",
  "document.uploaded",
  "document.revised",
]);

export function isActionableNotificationType(type: string | null | undefined): boolean {
  if (!type) return false;
  return ACTIONABLE_TYPES.has(type);
}

/** Best-effort in-app link for a stored notification entity. Never invents records. */
export function notificationEntityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  const commercial = commercialEntityHref(entityType, entityId);
  if (commercial) return commercial;
  switch (entityType) {
    case "leave_request":
      return `/leave/${entityId}`;
    case "attendance_record":
      return "/attendance";
    case "document":
      return `/documents/${entityId}`;
    case "document_intelligence":
      return `/documents/${entityId}/intelligence`;
    case "project":
      return `/projects/${entityId}`;
    case "approval":
    case "approval_request":
      return "/approvals";
    case "employee":
      return `/employees/${entityId}`;
    case "payroll_period":
      return "/payroll";
    case "hr_alert_hook":
      return "/employees";
    default:
      return null;
  }
}

export function workflowActivationStepIdFromDedup(dedupKey: string | null | undefined): string | null {
  if (!dedupKey) return null;
  const parts = dedupKey.split(":");
  if (parts.length < 3) return null;
  if (parts[0] !== "workflow.step.activated") return null;
  const stepId = parts[1] ?? "";
  return isPostgresUuid(stepId) ? stepId : null;
}

export function workflowStageHref(projectId: string, instanceStepId?: string | null): string | null {
  if (!isPostgresUuid(projectId)) return null;
  if (instanceStepId && isPostgresUuid(instanceStepId)) {
    return `/projects/${projectId}?tab=stages&stage=${instanceStepId}`;
  }
  return `/projects/${projectId}?tab=stages`;
}

/**
 * Prefer the stored notification href (062). Rebuild workflow-stage links from
 * project entity + dedup step id when the UI previously ignored `href`.
 */
export function resolveNotificationHref(input: {
  type?: string | null;
  entityType: string | null;
  entityId: string | null;
  storedHref?: string | null;
  dedupKey?: string | null;
}): string | null {
  const stored = safeNotificationHref(input.storedHref);
  const type = input.type ?? "";
  const stepId = workflowActivationStepIdFromDedup(input.dedupKey);

  if (type === "workflow.step.activated" || type === "workflow.completed") {
    if (input.entityType === "project" && input.entityId && isPostgresUuid(input.entityId)) {
      const rebuilt = workflowStageHref(input.entityId, type === "workflow.step.activated" ? stepId : null);
      if (stored?.startsWith(`/projects/${input.entityId}`)) {
        if (rebuilt && !stored.includes("tab=stages")) return rebuilt;
        if (rebuilt && stepId && !stored.includes("stage=")) return rebuilt;
        return stored;
      }
      return rebuilt ?? stored;
    }
  }

  if (stored) return stored;
  return notificationEntityHref(input.entityType, input.entityId);
}
