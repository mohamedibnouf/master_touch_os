import "server-only";

import type { AuthContext } from "@/types/models";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { canViewManagementAi } from "@/modules/ai/security/permissions";
import {
  buildExecutiveIntelligenceFacts,
  EXECUTIVE_DELAYED_PROJECT_LIMIT,
  type ProjectPortfolioRow,
} from "@/modules/ai/executive-intelligence/facts-builder";
import type { ExecutiveIntelligenceFacts, ExecutiveProgressRow } from "@/modules/ai/executive-intelligence/types";
import type { DashboardViz } from "@/server/use-cases/dashboard-viz";

export async function loadExecutiveIntelligenceFacts(
  ctx: AuthContext,
  viz?: DashboardViz | null,
): Promise<ExecutiveIntelligenceFacts | null> {
  if (!canViewManagementAi(ctx)) return null;

  const canProjects = hasPermission(ctx, "project.read") || hasPermission(ctx, "project.read_all");
  const canApprovals =
    hasPermission(ctx, "approval.review") ||
    hasPermission(ctx, "approval.approve") ||
    hasPermission(ctx, "approval.create") ||
    canViewManagementAi(ctx);
  const canPeople = hasPermission(ctx, "employee.read") || hasPermission(ctx, "employee.manage");
  const canFinance = hasPermission(ctx, "finance.read") || hasPermission(ctx, "commercial_reports.read");
  const orgId = ctx.organization.id;
  const asOf = riyadhTodayYmd();
  const nowIso = new Date().toISOString();
  const supabase = await createServerSupabaseClient();

  const [activeCountRes, trackedCountRes, overdueCountRes, delayedRes, overdueRes, pendingCountRes, pendingRes] =
    await Promise.all([
      canProjects
        ? supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "active")
        : Promise.resolve({ count: null as number | null }),
      canProjects
        ? supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["active", "on_hold"])
        : Promise.resolve({ count: null as number | null }),
      canProjects
        ? supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["active", "on_hold"])
            .lt("planned_end_date", asOf)
        : Promise.resolve({ count: null as number | null }),
      canProjects
        ? supabase
            .from("projects")
            .select("id, project_code, name_ar, status, planned_end_date, risk_level")
            .eq("organization_id", orgId)
            .in("status", ["active", "on_hold"])
            .lt("planned_end_date", asOf)
            .order("planned_end_date", { ascending: true })
            .limit(EXECUTIVE_DELAYED_PROJECT_LIMIT)
        : Promise.resolve({ data: [] as ProjectPortfolioRow[] }),
      canProjects
        ? supabase
            .from("workflow_instance_steps")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["ready", "in_progress"])
            .lt("due_at", nowIso)
        : Promise.resolve({ count: null as number | null }),
      canApprovals
        ? supabase
            .from("approval_requests")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["pending", "in_progress"])
        : Promise.resolve({ count: null as number | null }),
      canApprovals
        ? supabase
            .from("approval_requests")
            .select("id, title")
            .eq("organization_id", orgId)
            .in("status", ["pending", "in_progress"])
            .limit(8)
        : Promise.resolve({ data: [] as Array<{ id: string; title: string | null }> }),
    ]);

  const progressSample: ExecutiveProgressRow[] = (viz?.progressRows ?? []).map((row) => ({
    id: row.id,
    nameAr: row.label,
    percent: row.percent,
    hint: row.hint,
    href: row.href,
  }));

  return buildExecutiveIntelligenceFacts({
    asOf,
    canProjects,
    canApprovals,
    canPeople,
    canFinance,
    projects: delayedRes.data ?? [],
    census: canProjects
      ? {
          total: null,
          active: typeof activeCountRes.count === "number" ? activeCountRes.count : null,
          tracked: typeof trackedCountRes.count === "number" ? trackedCountRes.count : null,
          overduePlannedEnd: typeof overdueCountRes.count === "number" ? overdueCountRes.count : null,
        }
      : null,
    portfolioCapped: true,
    overdueStageCount:
      typeof viz?.kpis.overdueStages === "number"
        ? viz.kpis.overdueStages
        : typeof overdueRes.count === "number"
          ? overdueRes.count
          : canProjects
            ? 0
            : null,
    pendingApprovalCount:
      typeof viz?.kpis.pendingApprovals === "number"
        ? viz.kpis.pendingApprovals
        : typeof pendingCountRes.count === "number"
          ? pendingCountRes.count
          : canApprovals
            ? 0
            : null,
    pendingApprovalRows: pendingRes.data ?? [],
    progressSample,
    activeEmployeeCount: viz?.kpis.activeEmployees ?? null,
  });
}
