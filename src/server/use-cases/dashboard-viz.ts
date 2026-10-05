import "server-only";

import type { AuthContext } from "@/types/models";
import { hasPermission } from "@/server/policies/authorize";
import { deriveDeadlineState } from "@/modules/projects/deadline";
import type { DonutSegment } from "@/components/charts/semantic-charts";

type ActiveBar = { id: string; label: string; href: string; percent: number; hint: string };

export type DashboardViz = {
  kpis: {
    activeProjects: number | null;
    overdueStages: number | null;
    pendingApprovals: number | null;
    activeEmployees: number | null;
  };
  projectStatus: DonutSegment[];
  projectStatusTotal: number;
  progressRows: ActiveBar[];
  stageAttention: Array<{ label: string; value: number; tone: "success" | "warning" | "danger" | "info" }>;
  approvalStatus: DonutSegment[];
  approvalTotal: number;
};

export async function loadDashboardViz(
  ctx: AuthContext,
  supabase: import("@supabase/supabase-js").SupabaseClient,
): Promise<DashboardViz | null> {
  const canOrg =
    hasPermission(ctx, "reports.management.read") || hasPermission(ctx, "employee.read");
  const canProjects = hasPermission(ctx, "project.read");
  if (!canOrg && !canProjects) return null;

  const orgId = ctx.organization.id;
  const nowIso = new Date().toISOString();

  const empty: DashboardViz = {
    kpis: { activeProjects: null, overdueStages: null, pendingApprovals: null, activeEmployees: null },
    projectStatus: [],
    projectStatusTotal: 0,
    progressRows: [],
    stageAttention: [],
    approvalStatus: [],
    approvalTotal: 0,
  };

  const [projectsRes, overdueStepsRes, employeesRes, pendingApprovalsRes, instancesRes, activeStepsRes, approvalsRes] =
    await Promise.all([
      canProjects
        ? supabase.from("projects").select("id, status, name_ar").eq("organization_id", orgId).limit(400)
        : Promise.resolve({ data: [] as Array<{ id: string; status: string; name_ar: string }> }),
      canProjects
        ? supabase
            .from("workflow_instance_steps")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["ready", "in_progress"])
            .lt("due_at", nowIso)
        : Promise.resolve({ count: null as number | null }),
      canOrg
        ? supabase
            .from("employees")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("is_active", true)
        : Promise.resolve({ count: null as number | null }),
      canOrg || hasPermission(ctx, "approval.review")
        ? supabase
            .from("approval_requests")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["pending", "in_progress"])
        : Promise.resolve({ count: null as number | null }),
      canProjects
        ? supabase
            .from("workflow_instances")
            .select("id, entity_id, status")
            .eq("organization_id", orgId)
            .eq("entity_type", "project")
            .eq("status", "in_progress")
            .limit(20)
        : Promise.resolve({ data: [] as Array<{ id: string; entity_id: string; status: string }> }),
      canProjects
        ? supabase
            .from("workflow_instance_steps")
            .select("id, status, due_at, workflow_steps(warning_hours)")
            .eq("organization_id", orgId)
            .in("status", ["ready", "in_progress"])
            .limit(200)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              status: string;
              due_at: string | null;
              workflow_steps: { warning_hours: number | null } | { warning_hours: number | null }[] | null;
            }>,
          }),
      canOrg || hasPermission(ctx, "approval.review")
        ? supabase.from("approval_requests").select("status").eq("organization_id", orgId).limit(400)
        : Promise.resolve({ data: [] as Array<{ status: string }> }),
    ]);

  const projects = projectsRes.data ?? [];
  const statusCounts = new Map<string, number>();
  for (const p of projects) {
    statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);
  }
  const statusTone = (status: string): DonutSegment["tone"] => {
    if (status === "active" || status === "completed") return "success";
    if (status === "on_hold") return "warning";
    if (status === "cancelled") return "danger";
    if (status === "draft") return "neutral";
    return "info";
  };
  const statusLabel: Record<string, string> = {
    active: "نشط",
    completed: "مكتمل",
    on_hold: "متوقف",
    cancelled: "ملغى",
    draft: "مسودة",
  };
  const projectStatus: DonutSegment[] = [...statusCounts.entries()].map(([status, value]) => ({
    label: statusLabel[status] ?? status,
    value,
    tone: statusTone(status),
  }));

  const instances = instancesRes.data ?? [];
  const instanceIds = instances.map((i) => i.id);
  let progressRows: ActiveBar[] = [];
  if (instanceIds.length > 0) {
    const { data: stepRows } = await supabase
      .from("workflow_instance_steps")
      .select("instance_id, status")
      .in("instance_id", instanceIds);
    const byInstance = new Map<string, { completed: number; total: number }>();
    for (const row of stepRows ?? []) {
      const cur = byInstance.get(row.instance_id) ?? { completed: 0, total: 0 };
      cur.total += 1;
      if (row.status === "completed" || row.status === "skipped") cur.completed += 1;
      byInstance.set(row.instance_id, cur);
    }
    const nameById = new Map(projects.map((p) => [p.id, p.name_ar]));
    progressRows = instances
      .map((inst) => {
        const counts = byInstance.get(inst.id);
        const total = counts?.total ?? 0;
        const completed = counts?.completed ?? 0;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        return {
          id: inst.entity_id,
          label: nameById.get(inst.entity_id) ?? "مشروع",
          href: `/projects/${inst.entity_id}`,
          percent,
          hint: total > 0 ? `${completed} من ${total}` : "بدون مراحل",
        };
      })
      .slice(0, 8);
  }

  const asOne = <T,>(value: T | T[] | null | undefined): T | null => {
    if (!value) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  };

  let onTrack = 0;
  let dueSoon = 0;
  let overdue = 0;
  for (const step of activeStepsRes.data ?? []) {
    const def = asOne(step.workflow_steps);
    const state = deriveDeadlineState({
      engineStatus: step.status,
      dueAt: step.due_at,
      warningHours: def?.warning_hours ?? null,
      nowIso,
    });
    if (state === "OVERDUE") overdue += 1;
    else if (state === "DUE_SOON") dueSoon += 1;
    else onTrack += 1;
  }

  const waitingApproval = (approvalsRes.data ?? []).filter(
    (r) => r.status === "pending" || r.status === "in_progress",
  ).length;

  const approvalCounts = new Map<string, number>();
  for (const row of approvalsRes.data ?? []) {
    approvalCounts.set(row.status, (approvalCounts.get(row.status) ?? 0) + 1);
  }
  const approvalLabel: Record<string, string> = {
    pending: "معلّق",
    in_progress: "قيد التنفيذ",
    approved: "معتمد",
    rejected: "مرفوض",
    cancelled: "ملغى",
    completed: "مكتمل",
  };
  const approvalTone = (status: string): DonutSegment["tone"] => {
    if (status === "approved" || status === "completed") return "success";
    if (status === "pending" || status === "in_progress") return "warning";
    if (status === "rejected") return "danger";
    return "neutral";
  };
  const approvalStatus: DonutSegment[] = [...approvalCounts.entries()].map(([status, value]) => ({
    label: approvalLabel[status] ?? status,
    value,
    tone: approvalTone(status),
  }));

  return {
    ...empty,
    kpis: {
      activeProjects: canProjects ? projects.filter((p) => p.status === "active").length : null,
      overdueStages: typeof overdueStepsRes.count === "number" ? overdueStepsRes.count : overdue,
      pendingApprovals: typeof pendingApprovalsRes.count === "number" ? pendingApprovalsRes.count : waitingApproval,
      activeEmployees: typeof employeesRes.count === "number" ? employeesRes.count : null,
    },
    projectStatus,
    projectStatusTotal: projects.length,
    progressRows,
    stageAttention: [
      { label: "في المسار", value: onTrack, tone: "success" },
      { label: "اقترب موعدها", value: dueSoon, tone: "warning" },
      { label: "متأخرة", value: overdue, tone: "danger" },
      { label: "بانتظار الموافقة", value: waitingApproval, tone: "info" },
    ],
    approvalStatus,
    approvalTotal: (approvalsRes.data ?? []).length,
  };
}
