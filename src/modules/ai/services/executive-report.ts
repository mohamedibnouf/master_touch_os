import type { AiProvider } from "../provider/types";
import { executiveReportSchema, type ExecutiveReport } from "../schemas";
import { buildExecutiveReportPrompt, AI_PROMPT_VERSIONS } from "../prompts";
import { collectDeterministicRisks, classifyProjectHealth, type ProjectAiFacts } from "../health";
import { getCachedAiArtifact, hashAiInput, setCachedAiArtifact } from "../cache";
import { AI_DISCLAIMER_AR } from "../limits";
import { projectStatusLabel } from "@/lib/ui/operational-labels";
import type { Locale } from "@/lib/i18n/config";

function progressNarrative(completed: number, total: number, locale: Locale): string {
  return locale === "en"
    ? `${completed} of ${total} stages completed.`
    : `تم إنجاز ${completed} مراحل من أصل ${total}.`;
}

export async function buildExecutiveReportAi(input: {
  provider: AiProvider;
  facts: ProjectAiFacts;
  organizationId: string;
  forceRefresh?: boolean;
  /** Report language (Arabic by default). The `*_ar` report fields hold text in this language. */
  locale?: Locale;
}): Promise<{ report: ExecutiveReport; cached: boolean; disclaimerAr: string }> {
  const locale = input.locale ?? "ar";
  const en = locale === "en";
  const risks = collectDeterministicRisks(input.facts, undefined, locale);
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
    input.facts.start_date ? `${en ? "Start" : "البداية"}: ${input.facts.start_date}` : null,
    input.facts.planned_end_date
      ? `${en ? "Planned end" : "الانتهاء المخطط"}: ${input.facts.planned_end_date}`
      : null,
    ...input.facts.stages.filter((s) => s.dueAt).slice(0, 8).map((s) => `${s.nameAr}: ${s.dueAt}`),
  ].filter((x): x is string => Boolean(x));

  const factsPayload = {
    project_name_ar: input.facts.project_name_ar,
    project_status_ar: projectStatusLabel(input.facts.project_status, locale),
    completed_stages: input.facts.completed_stages,
    total_stages: input.facts.total_stages,
    current_stage_name: input.facts.current_stage_name ?? (en ? "Not set" : "غير محددة"),
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
    locale,
    factsPayload,
    model: input.provider.model,
  });

  if (!input.forceRefresh) {
    const cached = getCachedAiArtifact<ExecutiveReport>({
      organizationId: input.organizationId,
      kind: "executive_report",
      targetId: input.facts.projectId,
      inputHash,
      locale,
    });
    if (cached) {
      return {
        report: {
          ...cached.payload,
          progress_narrative_ar: progressNarrative(input.facts.completed_stages, input.facts.total_stages, locale),
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
    systemPrompt: buildExecutiveReportPrompt(locale),
    locale,
    userPayload: JSON.stringify({ MASTER_TOUCH_CONTEXT: "DATA_ONLY", facts: factsPayload }),
  });

  const report: ExecutiveReport = {
    ...structured.value,
    progress_narrative_ar: progressNarrative(input.facts.completed_stages, input.facts.total_stages, locale),
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
    locale,
  });

  return { report, cached: false, disclaimerAr: AI_DISCLAIMER_AR };
}
