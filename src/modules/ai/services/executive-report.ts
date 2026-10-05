import type { AiProvider } from "../provider/types";
import { executiveReportSchema, type ExecutiveReport } from "../schemas";
import { buildExecutiveReportPrompt, AI_PROMPT_VERSIONS } from "../prompts";
import { collectDeterministicRisks, classifyProjectHealth, type ProjectAiFacts } from "../health";
import { getCachedAiArtifact, hashAiInput, setCachedAiArtifact } from "../cache";
import { AI_DISCLAIMER_AR } from "../limits";
import { projectStatusLabel } from "@/lib/ui/operational-labels";

export async function buildExecutiveReportAi(input: {
  provider: AiProvider;
  facts: ProjectAiFacts;
  organizationId: string;
  forceRefresh?: boolean;
}): Promise<{ report: ExecutiveReport; cached: boolean; disclaimerAr: string }> {
  const risks = collectDeterministicRisks(input.facts);
  const health = classifyProjectHealth({
    risks,
    completed: input.facts.completed_stages,
    total: input.facts.total_stages,
  });

  const overdueNames = input.facts.stages
    .filter((s) => s.deadlineState === "OVERDUE" || s.visual === "overdue")
    .map((s) => s.nameAr);
  const pending = input.facts.stages
    .filter((s) => s.openApprovalId || s.visual === "waiting_approval")
    .map((s) => s.openApprovalTitle || s.nameAr);
  const dates = [
    input.facts.start_date ? `البداية: ${input.facts.start_date}` : null,
    input.facts.planned_end_date ? `الانتهاء المخطط: ${input.facts.planned_end_date}` : null,
    ...input.facts.stages.filter((s) => s.dueAt).slice(0, 8).map((s) => `${s.nameAr}: ${s.dueAt}`),
  ].filter((x): x is string => Boolean(x));

  const factsPayload = {
    project_name_ar: input.facts.project_name_ar,
    project_status_ar: projectStatusLabel(input.facts.project_status),
    completed_stages: input.facts.completed_stages,
    total_stages: input.facts.total_stages,
    current_stage_name: input.facts.current_stage_name ?? "غير محددة",
    overdue_stage_names: overdueNames,
    pending_approval_titles: pending,
    important_dates: dates,
    risk_titles: risks.map((r) => r.title_ar),
    health,
    generated_at: input.facts.generated_at,
    data_as_of: input.facts.data_as_of,
  };

  const inputHash = hashAiInput({
    v: AI_PROMPT_VERSIONS.executiveReport,
    factsPayload,
    model: input.provider.model,
  });

  if (!input.forceRefresh) {
    const cached = getCachedAiArtifact<ExecutiveReport>({
      organizationId: input.organizationId,
      kind: "executive_report",
      targetId: input.facts.projectId,
      inputHash,
    });
    if (cached) {
      return {
        report: {
          ...cached.payload,
          progress_narrative_ar: `تم إنجاز ${input.facts.completed_stages} مراحل من أصل ${input.facts.total_stages}.`,
          overdue_stages_ar: overdueNames,
          pending_approvals_ar: pending,
          data_as_of: input.facts.data_as_of,
        },
        cached: true,
        disclaimerAr: AI_DISCLAIMER_AR,
      };
    }
  }

  const structured = await input.provider.generateStructured({
    schemaName: "executive-report",
    schema: executiveReportSchema,
    systemPrompt: buildExecutiveReportPrompt(),
    userPayload: JSON.stringify({ MASTER_TOUCH_CONTEXT: "DATA_ONLY", facts: factsPayload }),
  });

  const report: ExecutiveReport = {
    ...structured.value,
    progress_narrative_ar: `تم إنجاز ${input.facts.completed_stages} مراحل من أصل ${input.facts.total_stages}.`,
    current_stage_ar: input.facts.current_stage_name ?? structured.value.current_stage_ar,
    overdue_stages_ar: overdueNames,
    pending_approvals_ar: pending,
    generated_at: input.facts.generated_at,
    data_as_of: input.facts.data_as_of,
  };

  setCachedAiArtifact({
    organizationId: input.organizationId,
    kind: "executive_report",
    targetId: input.facts.projectId,
    inputHash,
    payload: report,
  });

  return { report, cached: false, disclaimerAr: AI_DISCLAIMER_AR };
}
