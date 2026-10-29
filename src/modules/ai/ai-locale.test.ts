import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/types/models";
import { collectDeterministicRisks, type ProjectAiFacts } from "@/modules/ai/health";
import { createMockAiProvider } from "@/modules/ai/provider/mock";
import type { AiGenerateStructuredInput, AiProvider, AiStructuredResult } from "@/modules/ai/provider/types";
import {
  aiCacheKey,
  clearAiCacheForTests,
  getCachedAiArtifact,
  setCachedAiArtifact,
} from "@/modules/ai/cache";
import {
  buildAssistantPrompt,
  buildBaseSafetyPrompt,
  buildExecutiveReportPrompt,
  buildLanguageInstruction,
  buildManagementInsightsPrompt,
} from "@/modules/ai/prompts";
import { projectIntelligenceSchema, assistantAnswerSchema, managementInsightSchema } from "@/modules/ai/schemas";
import { buildProjectIntelligence } from "@/modules/ai/services/project-intelligence";
import { answerProjectAssistant } from "@/modules/ai/services/assistant";
import { buildExecutiveReportAi } from "@/modules/ai/services/executive-report";
import { buildExecutiveIntelligenceFacts } from "@/modules/ai/executive-intelligence/facts-builder";
import { buildBusinessCaseExtractionSystemPrompt } from "@/modules/document-intelligence/prompt";

const ORG = "11111111-1111-1111-1111-111111111111";

function facts(partial: Partial<ProjectAiFacts> = {}): ProjectAiFacts {
  return {
    projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    organizationId: ORG,
    project_name_ar: "برج تجريبي",
    project_code: "MT-1",
    project_status: "active",
    description: null,
    start_date: "2026-01-01",
    planned_end_date: "2026-02-01",
    location: null,
    completed_stages: 3,
    total_stages: 10,
    progress_percent: 30,
    current_stage_name: "التنفيذ",
    current_stage_id: "s1",
    stages: [
      {
        id: "s1",
        nameAr: "التنفيذ",
        visual: "overdue",
        deadlineState: "OVERDUE",
        dueAt: "2026-09-01T00:00:00.000Z",
        responsibleLabel: "مدير",
        requiresApproval: false,
        engineStatus: "in_progress",
        blockReason: null,
        openApprovalTitle: null,
        openApprovalId: null,
        approvalStartedAt: null,
      },
    ],
    team: [],
    documents: [],
    activity: [],
    generated_at: "2026-10-05T00:00:00.000Z",
    data_as_of: "2026-10-05T00:00:00.000Z",
    ...partial,
  };
}

const actor = { organization: { id: ORG } } as unknown as AuthContext;

/** Wraps the mock provider and records every structured call. */
function recordingProvider(): AiProvider & { calls: AiGenerateStructuredInput<unknown>[] } {
  const inner = createMockAiProvider();
  const calls: AiGenerateStructuredInput<unknown>[] = [];
  return {
    id: inner.id,
    model: inner.model,
    calls,
    generateText: (input) => inner.generateText(input),
    async generateStructured<T>(input: AiGenerateStructuredInput<T>): Promise<AiStructuredResult<T>> {
      calls.push(input as AiGenerateStructuredInput<unknown>);
      return inner.generateStructured(input);
    },
  };
}

const ARABIC = /[؀-ۿ]/;

beforeEach(() => clearAiCacheForTests());

describe("AI prompt language", () => {
  it("asks for English when locale is en", () => {
    for (const prompt of [
      buildBaseSafetyPrompt("en"),
      buildAssistantPrompt("en"),
      buildExecutiveReportPrompt("en"),
      buildManagementInsightsPrompt("en"),
    ]) {
      expect(prompt).toContain("OUTPUT LANGUAGE: English.");
      expect(prompt).toMatch(/_ar are fixed schema names/);
      expect(prompt).not.toContain("professional concise Arabic");
    }
    expect(buildExecutiveReportPrompt("en")).toContain("executive report in English");
    expect(buildBusinessCaseExtractionSystemPrompt("en")).toContain("English values");
  });

  it("keeps the Arabic instruction by default", () => {
    expect(buildBaseSafetyPrompt()).toContain(buildLanguageInstruction("ar"));
    expect(buildBaseSafetyPrompt()).toContain("professional concise Arabic");
    expect(buildBaseSafetyPrompt()).not.toContain("OUTPUT LANGUAGE: English.");
    expect(buildExecutiveReportPrompt()).toContain("executive report in Arabic");
    expect(buildBusinessCaseExtractionSystemPrompt()).toContain("Arabic");
  });

  it("services send the English prompt and locale to the provider", async () => {
    const provider = recordingProvider();
    await buildProjectIntelligence({ provider, facts: facts(), actor, locale: "en" });
    await answerProjectAssistant({ provider, facts: facts(), question: "What is the current stage status?", locale: "en" });
    expect(provider.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of provider.calls) {
      expect(call.systemPrompt).toContain("OUTPUT LANGUAGE: English.");
      expect(call.locale).toBe("en");
    }
  });
});

describe("mock provider language", () => {
  it("returns English canned content when asked in English", async () => {
    const provider = createMockAiProvider();
    const payload = JSON.stringify({ facts: { current_stage_name: "Execution", completed_stages: 2, total_stages: 5 } });
    const intel = await provider.generateStructured({
      schemaName: "project-intelligence",
      schema: projectIntelligenceSchema,
      systemPrompt: buildBaseSafetyPrompt("en"),
      userPayload: payload,
      locale: "en",
    });
    expect(intel.value.progress_summary_ar).toBe("2 of 5 stages completed.");
    expect(intel.value.summary_ar).not.toMatch(ARABIC);
    expect(intel.value.recommended_actions.join(" ")).not.toMatch(ARABIC);

    const answer = await provider.generateStructured({
      schemaName: "assistant",
      schema: assistantAnswerSchema,
      systemPrompt: "",
      userPayload: payload,
      locale: "en",
    });
    expect(answer.value.answer_ar).toContain("Current stage: Execution");

    const insights = await provider.generateStructured({
      schemaName: "management-insights",
      schema: managementInsightSchema,
      systemPrompt: "",
      userPayload: JSON.stringify({ facts: { insight_items: [] } }),
      locale: "en",
    });
    expect(insights.value.headline_ar).not.toMatch(ARABIC);

    const text = await provider.generateText({ systemPrompt: "", userPayload: payload, locale: "en" });
    expect(text.text).not.toMatch(ARABIC);
  });

  it("keeps the existing Arabic content by default", async () => {
    const provider = createMockAiProvider();
    const intel = await provider.generateStructured({
      schemaName: "project-intelligence",
      schema: projectIntelligenceSchema,
      systemPrompt: "",
      userPayload: JSON.stringify({ facts: { current_stage_name: "التنفيذ", completed_stages: 2, total_stages: 5 } }),
    });
    expect(intel.value.progress_summary_ar).toBe("تم إنجاز 2 من أصل 5 مراحل.");
    expect(intel.value.current_stage_summary_ar).toBe("المرحلة الحالية: التنفيذ.");
  });
});

describe("AI cache locale isolation", () => {
  it("cache key differs by locale", () => {
    expect(aiCacheKey(ORG, "project_intelligence", "p1", "ar")).not.toBe(
      aiCacheKey(ORG, "project_intelligence", "p1", "en"),
    );
    expect(aiCacheKey(ORG, "project_intelligence", "p1")).toBe(aiCacheKey(ORG, "project_intelligence", "p1", "ar"));
  });

  it("an English lookup never returns a cached Arabic artifact", () => {
    setCachedAiArtifact({ organizationId: ORG, kind: "executive_report", targetId: "p1", inputHash: "h", payload: { x: "ar" } });
    expect(getCachedAiArtifact({ organizationId: ORG, kind: "executive_report", targetId: "p1", inputHash: "h" })).not.toBeNull();
    expect(
      getCachedAiArtifact({ organizationId: ORG, kind: "executive_report", targetId: "p1", inputHash: "h", locale: "en" }),
    ).toBeNull();
  });

  it("project intelligence served from cache stays in the requested language", async () => {
    const provider = createMockAiProvider();
    const ar = await buildProjectIntelligence({ provider, facts: facts(), actor });
    const en = await buildProjectIntelligence({ provider, facts: facts(), actor, locale: "en" });
    expect(en.cached).toBe(false);
    expect(en.intelligence.summary_ar).toContain("Status summary");
    const enAgain = await buildProjectIntelligence({ provider, facts: facts(), actor, locale: "en" });
    expect(enAgain.cached).toBe(true);
    expect(enAgain.intelligence.summary_ar).toBe(en.intelligence.summary_ar);
    expect(ar.intelligence.summary_ar).toContain("ملخص");
  });
});

describe("deterministic labels by locale", () => {
  it("health risks have English titles and evidence when locale is en", () => {
    const now = new Date("2026-10-05T00:00:00.000Z");
    const en = collectDeterministicRisks(facts(), now, "en");
    const ar = collectDeterministicRisks(facts(), now);
    expect(en.map((r) => r.type)).toEqual(ar.map((r) => r.type));
    const overdue = en.find((r) => r.type === "OVERDUE_STAGE");
    expect(overdue?.title_ar).toBe("Overdue stage: التنفيذ");
    expect(overdue?.evidence[0]).toBe("Stage: التنفيذ");
    expect(en.find((r) => r.type === "PROJECT_END_DATE_RISK")?.title_ar).toBe("Planned end date passed");
    expect(ar.find((r) => r.type === "OVERDUE_STAGE")?.title_ar).toBe("مرحلة متأخرة: التنفيذ");
  });

  it("executive report deterministic fields follow the locale", async () => {
    const provider = createMockAiProvider();
    const { report } = await buildExecutiveReportAi({ provider, facts: facts(), organizationId: ORG, locale: "en" });
    expect(report.progress_narrative_ar).toBe("3 of 10 stages completed.");
    expect(report.important_dates_ar[0]).toBe("Start: 2026-01-01");
    expect(report.project_status_ar).not.toMatch(ARABIC);
  });

  it("facts-builder limitations and labels are English when locale is en", () => {
    const base = {
      asOf: "2026-10-05",
      canProjects: true,
      canApprovals: true,
      canPeople: false,
      canFinance: false,
      projects: [],
      overdueStageCount: 1,
      pendingApprovalCount: 2,
      pendingApprovalRows: [{ id: "a1", title: null }],
      progressSample: [],
      activeEmployeeCount: null,
    };
    const en = buildExecutiveIntelligenceFacts({ ...base, locale: "en" });
    const ar = buildExecutiveIntelligenceFacts(base);
    expect(en.limitationsAr.join(" ")).not.toMatch(ARABIC);
    expect(en.metrics.map((m) => m.labelAr).join(" ")).not.toMatch(ARABIC);
    expect(en.operationalSummaryAr).toContain("As of 2026-10-05");
    expect(en.pendingApprovalRows[0]?.titleAr).toBe("Approval request");
    expect(en.allowedRolesAr).toContain("General Manager");
    expect(ar.limitationsAr[0]).toBe("الأرقام المعروضة حتمية من قاعدة البيانات ضمن صلاحياتك.");
    expect(ar.allowedRolesAr).toContain("مدير عام");
  });
});
