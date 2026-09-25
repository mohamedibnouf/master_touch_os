import { commercialEntityHref } from "@/lib/commercial/entity-routes";

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
