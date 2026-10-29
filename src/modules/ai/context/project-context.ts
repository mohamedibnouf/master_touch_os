import type { AuthContext, Project } from "@/types/models";
import type { ProjectWorkflowProjection } from "@/server/use-cases/project-workflow";
import { AI_LIMITS } from "../limits";
import { sanitizeRecord, truncateText } from "../security/sanitize";
import type { ProjectAiFacts } from "../health";
import { pickLocalized, type Locale } from "@/lib/i18n/config";

export function buildProjectAiContext(input: {
  project: Pick<
    Project,
    | "id"
    | "organization_id"
    | "project_code"
    | "name_ar"
    | "description"
    | "status"
    | "start_date"
    | "planned_end_date"
    | "location"
  > & { name_en?: string | null };
  workflow: ProjectWorkflowProjection;
  team: Array<{ label: string; role: string | null }>;
  documents: Array<{ id: string; title: string; category: string | null }>;
  activity: Array<{ action: string; at: string }>;
  now?: Date;
  /** Language of deterministic labels and stage/project names (Arabic by default). */
  locale?: Locale;
}): ProjectAiFacts {
  const now = input.now ?? new Date();
  const locale = input.locale ?? "ar";
  const en = locale === "en";
  const stageName = (n: { nameAr: string; nameEn?: string | null }) =>
    en ? pickLocalized(locale, n.nameAr, n.nameEn) : n.nameAr;
  const current = input.workflow.nodes.find((n) => n.id === input.workflow.currentNodeId);
  const facts: ProjectAiFacts = {
    projectId: input.project.id,
    organizationId: input.project.organization_id,
    // `_ar` keys hold names in the requested locale (English names when locale is "en" and available).
    project_name_ar: en ? pickLocalized(locale, input.project.name_ar, input.project.name_en) : input.project.name_ar,
    project_code: input.project.project_code,
    project_status: input.project.status,
    description: input.project.description
      ? truncateText(input.project.description, 800).text
      : null,
    start_date: input.project.start_date,
    planned_end_date: input.project.planned_end_date,
    location: input.project.location,
    completed_stages: input.workflow.progress.completed,
    total_stages: input.workflow.progress.total,
    progress_percent: input.workflow.progress.percent,
    current_stage_name: current ? stageName(current) : null,
    current_stage_id: current?.id ?? null,
    stages: input.workflow.nodes.slice(0, 40).map((n) => ({
      id: n.id,
      nameAr: stageName(n),
      visual: n.visual,
      deadlineState: n.deadlineState,
      dueAt: n.dueAt,
      responsibleLabel: n.responsibleLabel,
      requiresApproval: n.requiresApproval,
      engineStatus: n.engineStatus,
      blockReason: n.blockReason,
      openApprovalTitle: n.approverLabel
        ? en
          ? `Awaiting ${n.approverLabel}`
          : `بانتظار ${n.approverLabel}`
        : n.requiresApproval
          ? en
            ? "Approval required"
            : "موافقة مطلوبة"
          : null,
      openApprovalId: n.openApproval?.requestId ?? null,
      approvalStartedAt: n.startedAt,
    })),
    team: input.team.slice(0, AI_LIMITS.maxTeamRows),
    documents: input.documents.slice(0, AI_LIMITS.maxDocumentMetaRows),
    activity: input.activity.slice(0, AI_LIMITS.maxActivityRows),
    generated_at: now.toISOString(),
    data_as_of: now.toISOString(),
  };
  return sanitizeRecord(facts as unknown as Record<string, unknown>) as unknown as ProjectAiFacts;
}

export function projectFactsForPrompt(facts: ProjectAiFacts, extra?: Record<string, unknown>): string {
  const payload = {
    MASTER_TOUCH_CONTEXT: "DATA_ONLY",
    facts: {
      ...facts,
      ...extra,
    },
  };
  const raw = JSON.stringify(payload);
  return truncateText(raw, AI_LIMITS.maxContextChars).text;
}

/** Actor is used only for authorization outside this builder. */
export function assertSameOrganization(actor: AuthContext, organizationId: string): boolean {
  return actor.organization.id === organizationId;
}
