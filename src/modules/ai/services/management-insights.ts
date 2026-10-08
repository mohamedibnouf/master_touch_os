import { randomUUID } from "node:crypto";
import type { AiProvider } from "../provider/types";
import { managementInsightSchema, type ManagementInsight, type ManagementInsightFacts } from "../schemas";
import { buildManagementInsightsPrompt, AI_PROMPT_VERSIONS } from "../prompts";
import { getCachedAiArtifact, hashAiInput, setCachedAiArtifact } from "../cache";
import { AI_DISCLAIMER_AR } from "../limits";
import { MANAGEMENT_INSIGHTS_SCHEMA_VERSION } from "../management-insights-contract";

export async function explainManagementInsights(input: {
  provider: AiProvider;
  organizationId: string;
  facts: ManagementInsightFacts;
  forceRefresh?: boolean;
}): Promise<{ insight: ManagementInsight; cached: boolean; facts: ManagementInsightFacts; disclaimerAr: string }> {
  const items = input.facts.projectNotes.slice(0, 5).map((p) => ({
    title_ar: p.nameAr,
    explanation_ar: p.reasonAr,
    href: p.href,
  }));

  const factsPayload = {
    follow_up_projects: input.facts.followUpProjects,
    overdue_stages: input.facts.overdueStages,
    pending_approvals: input.facts.pendingApprovals,
    insight_items: items,
    generated_at: new Date().toISOString(),
    data_as_of: input.facts.dataAsOf,
  };

  const inputHash = hashAiInput({ v: AI_PROMPT_VERSIONS.managementInsights, factsPayload, model: input.provider.model });
  if (!input.forceRefresh) {
    const cached = getCachedAiArtifact<ManagementInsight>({
      organizationId: input.organizationId,
      kind: "management_insights",
      targetId: input.organizationId,
      inputHash,
    });
    if (cached) {
      return { insight: cached.payload, cached: true, facts: input.facts, disclaimerAr: AI_DISCLAIMER_AR };
    }
  }

  const structured = await input.provider.generateStructured({
    schemaName: "management-insights",
    schema: managementInsightSchema,
    systemPrompt: buildManagementInsightsPrompt(),
    userPayload: JSON.stringify({ MASTER_TOUCH_CONTEXT: "DATA_ONLY", facts: factsPayload }),
    observe: {
      operation: "management_insights",
      organizationId: input.organizationId,
      pipeline: "management_insights",
      promptVersion: AI_PROMPT_VERSIONS.managementInsights,
      schemaVersion: MANAGEMENT_INSIGHTS_SCHEMA_VERSION,
      correlationId: randomUUID(),
    },
  });

  const insight: ManagementInsight = {
    ...structured.value,
    items: structured.value.items,
    data_as_of: input.facts.dataAsOf,
  };

  setCachedAiArtifact({
    organizationId: input.organizationId,
    kind: "management_insights",
    targetId: input.organizationId,
    inputHash,
    payload: insight,
  });

  return { insight, cached: false, facts: input.facts, disclaimerAr: AI_DISCLAIMER_AR };
}
