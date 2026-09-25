import { commercialEntityHref } from "@/lib/commercial/entity-routes";
import type { PendingAction } from "@/types/models";

/** Link a My Work item to an existing route. Approvals go to the inbox, not a fabricated task module. */
export function pendingActionHref(action: PendingAction): string {
  const commercial = commercialEntityHref(action.entityType, action.entityId);
  if (commercial) return commercial;
  switch (action.kind) {
    case "approval":
      return "/approvals";
    case "rfi":
    case "ncr":
    case "inspection":
    case "document_revision":
      return "/engineering";
    case "workflow":
      return "/approvals";
    default:
      return "/";
  }
}
