import { randomUUID } from "node:crypto";
import type { AiProvider } from "../provider/types";
import { managementInsightSchema, type ManagementInsight, type ManagementInsightFacts } from "../schemas";
import { buildManagementInsightsPrompt, AI_PROMPT_VERSIONS } from "../prompts";
import { getCachedAiArtifact, hashAiInput, setCachedAiArtifact } from "../cache";
import { AI_DISCLAIMER_AR } from "../limits";
import {
  MANAGEMENT_INSIGHTS_SCHEMA_VERSION,
  validateManagementInsightPayload,
} from "../management-insights-contract";
import { invalidProviderResponseError } from "../provider-errors";
import { coerceExecutiveFacts } from "../executive-intelligence/facts-builder";
import { groundManagementInsight } from "../executive-intelligence/grounding";
import type { ExecutiveIntelligenceFacts } from "../executive-intelligence/types";

export async function explainManagementInsights(input: {
  provider: AiProvider;
  organizationId: string;
  facts: ManagementInsightFacts | ExecutiveIntelligenceFacts;
  forceRefresh?: boolean;
}): Promise<{
  insight: ManagementInsight;
  cached: boolean;
  facts: ExecutiveIntelligenceFacts;
  disclaimerAr: string;
}> {
  const facts = coerceExecutiveFacts(input.facts);
  const items = facts.projectNotes.slice(0, 5).map((p) => ({
    title_ar: p.nameAr,
    explanation_ar: p.reasonAr,
    href: p.href,
  }));

  const factsPayload = {
    follow_up_projects: facts.followUpProjects,
    overdue_stages: facts.overdueStages,
    pending_approvals: facts.pendingApprovals,
    insight_items: items,
    generated_at: new Date().toISOString(),
    data_as_of: facts.dataAsOf,
    metrics: facts.metrics.map((m) => ({
      key: m.key,
      label_ar: m.labelAr,
      value: m.value,
      unit: m.unit,
      availability: m.availability,
      denominator: m.denominator,
    })),
    delayed_projects: facts.delayedProjects.map((p) => ({
      id: p.id,
      name_ar: p.nameAr,
      overdue_days: p.overdueDays,
    })),
    progress_sample: facts.progressSample.map((p) => ({
      id: p.id,
      name_ar: p.nameAr,
      percent: p.percent,
    })),
    pending_approval_titles: facts.pendingApprovalRows.map((p) => p.titleAr),
    allowed_roles_ar: facts.allowedRolesAr,
    limitations_ar: facts.limitationsAr,
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
      return { insight: cached.payload, cached: true, facts, disclaimerAr: AI_DISCLAIMER_AR };
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

  const checked = validateManagementInsightPayload(structured.value);
  if (!checked.ok) {
    throw invalidProviderResponseError("AI_SCHEMA_VALIDATION_FAILED", {
      operation: "management_insights",
      pipeline: "management_insights",
      promptVersion: AI_PROMPT_VERSIONS.managementInsights,
      schemaVersion: MANAGEMENT_INSIGHTS_SCHEMA_VERSION,
      schemaIssues: checked.issues,
    });
  }

  const insight = groundManagementInsight(
    {
      ...checked.value,
      data_as_of: facts.dataAsOf,
    },
    facts,
  );

  setCachedAiArtifact({
    organizationId: input.organizationId,
    kind: "management_insights",
    targetId: input.organizationId,
    inputHash,
    payload: insight,
  });

  return { insight, cached: false, facts, disclaimerAr: AI_DISCLAIMER_AR };
}
