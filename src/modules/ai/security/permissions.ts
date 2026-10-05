import type { AuthContext } from "@/types/models";
import { can } from "@/lib/permissions/evaluate";
import type { PermissionKey } from "@/lib/permissions/catalog";

export type AiCapability =
  | "ai.use"
  | "ai.project.analyze"
  | "ai.document.analyze"
  | "ai.report.generate"
  | "ai.management.view";

function orgCan(ctx: AuthContext, key: PermissionKey): boolean {
  return can(ctx.grants, key, { organizationId: ctx.organization.id });
}

/**
 * After migration 075, `ai.*` keys are primary.
 * Fallback until 075: reports.management.read / project.manage_team / document upload|update.
 */
export function canUseAiCapability(ctx: AuthContext | null, capability: AiCapability): boolean {
  if (!ctx) return false;
  if (!ctx.profile.is_active || ctx.membershipStatus !== "active") return false;

  if (orgCan(ctx, capability)) return true;

  const management = orgCan(ctx, "reports.management.read");
  const projectLead = orgCan(ctx, "project.manage_team") && orgCan(ctx, "project.read");
  const docWriter = orgCan(ctx, "document.upload") || orgCan(ctx, "document.update");

  switch (capability) {
    case "ai.use":
      return management || projectLead || docWriter;
    case "ai.management.view":
      return management;
    case "ai.report.generate":
      return management || projectLead;
    case "ai.project.analyze":
      return management || projectLead;
    case "ai.document.analyze":
      return docWriter || management || projectLead;
    default:
      return false;
  }
}

export function canAnalyzeProjectAi(ctx: AuthContext | null): boolean {
  return Boolean(ctx && canUseAiCapability(ctx, "ai.project.analyze") && orgCan(ctx, "project.read"));
}

export function canViewManagementAi(ctx: AuthContext | null): boolean {
  return canUseAiCapability(ctx, "ai.management.view");
}
