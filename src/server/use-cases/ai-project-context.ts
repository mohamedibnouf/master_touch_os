import "server-only";

import type { AuthContext } from "@/types/models";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CoreRepository } from "@/server/repositories/core.repository";
import { loadProjectWorkflowProjection } from "@/server/use-cases/project-workflow";
import { buildProjectAiContext } from "@/modules/ai/context/project-context";
import type { ProjectAiFacts } from "@/modules/ai/health";
import { AUDIT_FEED_COLUMNS } from "@/lib/query-projections";
import { NotFoundError } from "@/lib/errors";

export async function loadAuthorizedProjectAiFacts(input: {
  supabase: SupabaseClient;
  ctx: AuthContext;
  projectId: string;
}): Promise<ProjectAiFacts> {
  const repo = new CoreRepository(input.supabase);
  const project = await repo.getProject(input.ctx.organization.id, input.projectId);
  if (!project) throw new NotFoundError("المشروع", "Project");

  const [stages, members, documents, users] = await Promise.all([
    repo.listProjectStages(project.id),
    repo.listProjectMembers(project.id),
    repo.listDocuments(input.ctx.organization.id, project.id),
    repo.listUsers(input.ctx.organization.id),
  ]);

  const profileNames = new Map<string, string>();
  for (const row of users) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const name = profile?.full_name_ar || profile?.full_name_en;
    if (name) profileNames.set(row.profile_id, name);
  }

  const { data: roleRows } = await input.supabase
    .from("roles")
    .select("id, name_ar")
    .or(`organization_id.eq.${input.ctx.organization.id},organization_id.is.null`);
  const roleNames = new Map((roleRows ?? []).map((r) => [r.id as string, r.name_ar as string]));

  const { data: departmentRows } = await input.supabase
    .from("departments")
    .select("id, name_ar")
    .eq("organization_id", input.ctx.organization.id);
  const departmentNames = new Map((departmentRows ?? []).map((d) => [d.id as string, d.name_ar as string]));

  const workflow = await loadProjectWorkflowProjection({
    supabase: input.supabase,
    ctx: input.ctx,
    projectId: project.id,
    stages,
    profileNames,
    roleNames,
    departmentNames,
  });

  const team = members.map((m) => {
    const profiles = (m as { profiles?: { full_name_ar?: string } | { full_name_ar?: string }[] }).profiles;
    const profile = Array.isArray(profiles) ? profiles[0] : profiles;
    return {
      label: profile?.full_name_ar || (m.profile_id as string),
      role: (m.role_label as string | null) ?? null,
    };
  });

  const activityIds = [project.id, workflow.instanceId].filter((v): v is string => Boolean(v));
  const { data: activityRows } = activityIds.length
    ? await input.supabase
        .from("audit_logs")
        .select(AUDIT_FEED_COLUMNS)
        .eq("organization_id", input.ctx.organization.id)
        .in("entity_id", activityIds)
        .order("created_at", { ascending: false })
        .limit(12)
    : { data: [] as Array<{ action: string; created_at: string }> };

  return buildProjectAiContext({
    project,
    workflow,
    team,
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category ?? null,
    })),
    activity: (activityRows ?? []).map((row) => ({
      action: row.action as string,
      at: row.created_at as string,
    })),
  });
}
