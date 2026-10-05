import type { AuthContext } from "@/types/models";
import type { AiProvider } from "../provider/types";
import { classifyProjectHealth, collectDeterministicRisks, type ProjectAiFacts } from "../health";
import {
  projectIntelligenceSchema,
  riskExplanationSchema,
  type ProjectIntelligence,
  type ProjectIntelligenceView,
} from "../schemas";
import { buildProjectIntelligencePrompt, buildRiskExplanationPrompt, AI_PROMPT_VERSIONS } from "../prompts";
import { projectFactsForPrompt } from "../context/project-context";
import { getCachedAiArtifact, hashAiInput, setCachedAiArtifact } from "../cache";
import { estimateChars } from "../security/sanitize";
import { AI_DISCLAIMER_AR } from "../limits";

export async function buildProjectIntelligence(input: {
  provider: AiProvider;
  facts: ProjectAiFacts;
  actor: AuthContext;
  forceRefresh?: boolean;
}): Promise<ProjectIntelligenceView> {
  const risks = collectDeterministicRisks(input.facts);
  const health = classifyProjectHealth({
    risks,
    completed: input.facts.completed_stages,
    total: input.facts.total_stages,
  });

  const extra = {
    health,
    risk_titles: risks.map((r) => r.title_ar),
    pending_titles: risks
      .filter((r) => r.type === "PENDING_APPROVAL" || r.type === "LONG_PENDING_APPROVAL")
      .map((r) => r.title_ar),
    blocker_titles: risks.filter((r) => r.type === "BLOCKED_WORKFLOW" || r.type === "OVERDUE_STAGE").map((r) => r.title_ar),
    current_stage_name: input.facts.current_stage_name,
    completed_stages: input.facts.completed_stages,
    total_stages: input.facts.total_stages,
    risks: risks.map((r) => ({ type: r.type, title_ar: r.title_ar, evidence: r.evidence })),
  };

  const inputHash = hashAiInput({
    v: AI_PROMPT_VERSIONS.projectIntelligence,
    health,
    facts: input.facts,
    model: input.provider.model,
  });

  if (!input.forceRefresh) {
    const cached = getCachedAiArtifact<ProjectIntelligence>({
      organizationId: input.actor.organization.id,
      kind: "project_intelligence",
      targetId: input.facts.projectId,
      inputHash,
    });
    if (cached) {
      return {
        intelligence: { ...cached.payload, health },
        health,
        risks,
        facts: pickFacts(input.facts),
        cached: true,
        generatedAt: cached.createdAt,
        dataAsOf: input.facts.data_as_of,
        disclaimerAr: AI_DISCLAIMER_AR,
        promptVersion: AI_PROMPT_VERSIONS.projectIntelligence,
      };
    }
  }

  const structured = await input.provider.generateStructured({
    schemaName: "project-intelligence",
    schema: projectIntelligenceSchema,
    systemPrompt: buildProjectIntelligencePrompt(),
    userPayload: projectFactsForPrompt(input.facts, extra),
  });

  const intelligence: ProjectIntelligence = {
    ...structured.value,
    health,
    generated_at: structured.value.generated_at || input.facts.generated_at,
  };

  try {
    await input.provider.generateStructured({
      schemaName: "risk-explanation",
      schema: riskExplanationSchema,
      systemPrompt: buildRiskExplanationPrompt(),
      userPayload: projectFactsForPrompt(input.facts, extra),
    });
  } catch {
    // explanations stay deterministic if optional pass fails
  }

  const generatedAt = setCachedAiArtifact({
    organizationId: input.actor.organization.id,
    kind: "project_intelligence",
    targetId: input.facts.projectId,
    inputHash,
    payload: intelligence,
  });

  void estimateChars(extra);

  return {
    intelligence,
    health,
    risks,
    facts: pickFacts(input.facts),
    cached: false,
    generatedAt,
    dataAsOf: input.facts.data_as_of,
    disclaimerAr: AI_DISCLAIMER_AR,
    promptVersion: AI_PROMPT_VERSIONS.projectIntelligence,
  };
}

function pickFacts(facts: ProjectAiFacts) {
  return {
    completed_stages: facts.completed_stages,
    total_stages: facts.total_stages,
    progress_percent: facts.progress_percent,
    current_stage_name: facts.current_stage_name,
    planned_end_date: facts.planned_end_date,
  };
}
