import { describe, expect, it, vi, afterEach } from "vitest";
import { managementInsightSchema } from "@/modules/ai/schemas";
import { documentAnalysisSchema } from "@/modules/ai/schemas";
import {
  MANAGEMENT_INSIGHTS_OPENAI_JSON_SCHEMA,
  MANAGEMENT_INSIGHTS_SCHEMA_NAME,
  managementInsightResponseInstructions,
  normalizeManagementInsightShape,
  validateManagementInsightPayload,
} from "@/modules/ai/management-insights-contract";
import { buildManagementInsightsPrompt, AI_PROMPT_VERSIONS } from "@/modules/ai/prompts";
import { createOpenAIProvider } from "@/modules/ai/provider/openai";
import { createMockAiProvider, createUnavailableMockProvider } from "@/modules/ai/provider/mock";
import type { AiProvider } from "@/modules/ai/provider/types";
import { explainManagementInsights } from "@/modules/ai/services/management-insights";
import { analyzeDocumentText } from "@/modules/ai/services/document-analysis";
import { mapToAiClientError } from "@/modules/ai/errors";
import { AI_PROVIDER_USER_MESSAGE_AR, invalidProviderResponseError } from "@/modules/ai/provider-errors";
import { clearAiCacheForTests } from "@/modules/ai/cache";

const VALID = {
  headline_ar: "ثلاث إشارات تشغيلية تحتاج متابعة.",
  executive_summary_ar: "الملخص مبني على المقاييس الحتمية دون اختراع أرقام.",
  items: [
    {
      title_ar: "مشروع تجريبي",
      explanation_ar: "ضمن المشاريع المصرّح بعرضها",
      href: "/projects/cbf8f9e7-ca63-4231-8694-8a95372cbd20",
    },
  ],
  observations: [],
  recommendations: [],
  limitations_ar: "التحليل استشاري.",
  generated_at: "2026-10-08T16:00:00.000Z",
  data_as_of: "2026-10-08",
};

const FACTS = {
  followUpProjects: 1,
  overdueStages: 2,
  pendingApprovals: 3,
  projectNotes: [
    {
      id: "cbf8f9e7-ca63-4231-8694-8a95372cbd20",
      nameAr: "مشروع تجريبي",
      reasonAr: "ضمن المشاريع المصرّح بعرضها",
      href: "/projects/cbf8f9e7-ca63-4231-8694-8a95372cbd20",
    },
  ],
  dataAsOf: "2026-10-08",
};

function openai(fetchImpl: typeof fetch) {
  return createOpenAIProvider({
    apiKey: "test-openai-key-value",
    model: "gpt-4o-mini",
    documentModel: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    fetchImpl,
  });
}

function chat(message: unknown, finish_reason = "stop") {
  return new Response(JSON.stringify({ choices: [{ message, finish_reason }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("management insights contract", () => {
  it("accepts a valid Management Insights response", () => {
    const result = validateManagementInsightPayload(VALID);
    expect(result.ok).toBe(true);
    expect(managementInsightSchema.safeParse(VALID).success).toBe(true);
  });

  it("fails closed when headline_ar is missing (no fabricated analysis)", () => {
    const { headline_ar: _drop, ...rest } = VALID;
    void _drop;
    const result = validateManagementInsightPayload(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === "headline_ar")).toBe(true);
  });

  it("fails closed on wrong field types", () => {
    const result = validateManagementInsightPayload({ ...VALID, items: "not-an-array" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe("items");
      expect(result.issues[0]?.received).toBe("string");
    }
  });

  it("maps echoed insight_items to items without inventing headlines", () => {
    const normalized = normalizeManagementInsightShape({
      headline_ar: VALID.headline_ar,
      executive_summary_ar: VALID.executive_summary_ar,
      insight_items: VALID.items,
      observations: [],
      recommendations: [],
      limitations_ar: VALID.limitations_ar,
      generated_at: VALID.generated_at,
      data_as_of: VALID.data_as_of,
    });
    const result = validateManagementInsightPayload(normalized);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0]?.title_ar).toBe("مشروع تجريبي");
    expect(validateManagementInsightPayload({ insight_items: VALID.items }).ok).toBe(false);
  });

  it("does not treat a v2-shaped payload as a successful v3 analysis", () => {
    const result = validateManagementInsightPayload({
      headline_ar: VALID.headline_ar,
      items: VALID.items,
      generated_at: VALID.generated_at,
      data_as_of: VALID.data_as_of,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === "executive_summary_ar")).toBe(true);
  });

  it("does not coerce a malformed observations value into an empty success", () => {
    const result = validateManagementInsightPayload({ ...VALID, observations: "not-an-array" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === "observations")).toBe(true);
  });

  it("does not treat a missing items key as an empty successful analysis", () => {
    const result = validateManagementInsightPayload({
      headline_ar: VALID.headline_ar,
      generated_at: VALID.generated_at,
      data_as_of: VALID.data_as_of,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === "items")).toBe(true);
  });

  it("accepts an explicit empty items array without filling recommendations", () => {
    const result = validateManagementInsightPayload({ ...VALID, items: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toEqual([]);
  });

  it("strict schema lists every property as required with additionalProperties false", () => {
    const root = MANAGEMENT_INSIGHTS_OPENAI_JSON_SCHEMA;
    expect(root.additionalProperties).toBe(false);
    expect([...root.required].sort()).toEqual(Object.keys(root.properties).sort());
    const item = root.properties.items.items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.properties.href).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    const rec = root.properties.recommendations.items;
    expect(rec.additionalProperties).toBe(false);
    expect([...rec.required].sort()).toEqual(Object.keys(rec.properties).sort());
    const obs = root.properties.observations.items;
    expect(obs.additionalProperties).toBe(false);
    expect([...obs.required].sort()).toEqual(Object.keys(obs.properties).sort());
  });

  it("does not invent a fallback headline or recommendations", () => {
    const result = validateManagementInsightPayload({
      follow_up_projects: 5,
      overdue_stages: 2,
      pending_approvals: 1,
      insight_items: VALID.items,
      generated_at: VALID.generated_at,
      data_as_of: VALID.data_as_of,
    });
    expect(result.ok).toBe(false);
  });

  it("prompt and JSON schema list the same required keys", () => {
    const prompt = buildManagementInsightsPrompt();
    expect(prompt).toContain(managementInsightResponseInstructions());
    expect(prompt).toContain(AI_PROMPT_VERSIONS.managementInsights);
    expect(MANAGEMENT_INSIGHTS_OPENAI_JSON_SCHEMA.required).toEqual([
      "headline_ar",
      "executive_summary_ar",
      "items",
      "observations",
      "recommendations",
      "limitations_ar",
      "generated_at",
      "data_as_of",
    ]);
    expect(prompt).toContain("headline_ar");
    expect(prompt).toContain("The output key is items.");
    expect(prompt).not.toContain("fabricate");
  });
});

describe("management insights OpenAI adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends json_schema structured outputs named management_insights", async () => {
    let body: Record<string, unknown> = {};
    const ai = openai(async (_url, init) => {
      body = JSON.parse(String(init && "body" in init ? init.body : "{}"));
      return chat({ content: JSON.stringify(VALID) });
    });
    await ai.generateStructured({
      schemaName: "management-insights",
      schema: managementInsightSchema,
      systemPrompt: buildManagementInsightsPrompt(),
      userPayload: "{}",
    });
    const format = body.response_format as { type?: string; json_schema?: { name?: string; strict?: boolean } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema?.name).toBe(MANAGEMENT_INSIGHTS_SCHEMA_NAME);
    expect(format.json_schema?.strict).toBe(true);
  });

  it("classifies empty output as invalid response", async () => {
    const ai = openai(async () => chat({ content: "" }));
    await expect(
      ai.generateStructured({
        schemaName: "management-insights",
        schema: managementInsightSchema,
        systemPrompt: "sys",
        userPayload: "{}",
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_PROVIDER_INVALID_RESPONSE" } });
  });

  it("classifies malformed JSON as AI_INVALID_JSON", async () => {
    const ai = openai(async () => chat({ content: "{not-json" }));
    await expect(
      ai.generateStructured({
        schemaName: "management-insights",
        schema: managementInsightSchema,
        systemPrompt: "sys",
        userPayload: "{}",
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_INVALID_JSON" } });
  });

  it("maps AI_INVALID_JSON to the Arabic invalid-response message", () => {
    const err = invalidProviderResponseError("AI_INVALID_JSON");
    expect(mapToAiClientError(err)).toEqual({
      code: "AI_INVALID_JSON",
      message: AI_PROVIDER_USER_MESSAGE_AR.AI_INVALID_JSON,
    });
    expect(mapToAiClientError(err).message).toContain("غير صالحة");
  });

  it("classifies schema mismatch as AI_SCHEMA_VALIDATION_FAILED", async () => {
    const ai = openai(async () =>
      chat({ content: JSON.stringify({ follow_up_projects: 1, insight_items: [] }) }),
    );
    await expect(
      ai.generateStructured({
        schemaName: "management-insights",
        schema: managementInsightSchema,
        systemPrompt: "sys",
        userPayload: "{}",
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_SCHEMA_VALIDATION_FAILED" } });
  });

  it("classifies refusal as AI_RESPONSE_INCOMPLETE without leaking refusal text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ai = openai(async () => chat({ content: null, refusal: "SECRET_REFUSAL_BODY" }, "stop"));
    await expect(
      ai.generateStructured({
        schemaName: "management-insights",
        schema: managementInsightSchema,
        systemPrompt: "SECRET_PROMPT",
        userPayload: "SECRET_FACTS",
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_RESPONSE_INCOMPLETE", finishReason: "refusal" } });
    const dumped = warn.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(dumped).toContain("AI_RESPONSE_INCOMPLETE");
    expect(dumped).not.toContain("SECRET_REFUSAL_BODY");
    expect(dumped).not.toContain("SECRET_PROMPT");
    expect(dumped).not.toContain("SECRET_FACTS");
  });

  it("classifies truncated finish_reason as AI_RESPONSE_INCOMPLETE", async () => {
    const ai = openai(async () => chat({ content: "{\"headline_ar\":" }, "length"));
    await expect(
      ai.generateStructured({
        schemaName: "management-insights",
        schema: managementInsightSchema,
        systemPrompt: "sys",
        userPayload: "{}",
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_RESPONSE_INCOMPLETE", finishReason: "length" } });
  });

  it("classifies provider HTTP 500 as AI_PROVIDER_SERVER_ERROR", async () => {
    const ai = openai(async () => new Response("{}", { status: 500 }));
    await expect(
      ai.generateStructured({
        schemaName: "management-insights",
        schema: managementInsightSchema,
        systemPrompt: "sys",
        userPayload: "{}",
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_PROVIDER_SERVER_ERROR" } });
  });

  it("accepts echoed insight_items through the adapter after safe normalize", async () => {
    const ai = openai(async () =>
      chat({
        content: JSON.stringify({
          headline_ar: VALID.headline_ar,
          executive_summary_ar: VALID.executive_summary_ar,
          insight_items: VALID.items,
          observations: [],
          recommendations: [],
          limitations_ar: VALID.limitations_ar,
          generated_at: VALID.generated_at,
          data_as_of: VALID.data_as_of,
        }),
      }),
    );
    const result = await ai.generateStructured({
      schemaName: "management-insights",
      schema: managementInsightSchema,
      systemPrompt: "sys",
      userPayload: "{}",
    });
    expect(result.value.headline_ar).toBe(VALID.headline_ar);
    expect(result.value.items).toHaveLength(1);
  });
});

describe("management insights service and sibling pipelines", () => {
  it("mock provider still produces a valid insight without fabricating extra projects", async () => {
    clearAiCacheForTests();
    const explained = await explainManagementInsights({
      provider: createMockAiProvider(),
      organizationId: "11111111-1111-1111-1111-111111111111",
      facts: FACTS,
      forceRefresh: true,
    });
    expect(explained.insight.headline_ar.length).toBeGreaterThan(0);
    expect(explained.insight.data_as_of).toBe(FACTS.dataAsOf);
    expect(explained.insight.data_as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(explained.insight.generated_at.length).toBeGreaterThan(0);
    expect(explained.insight.generated_at.length).toBeLessThanOrEqual(40);
    expect(explained.insight.executive_summary_ar.length).toBeGreaterThan(0);
    expect(explained.insight.observations).toEqual([]);
  });

  it("surfaces provider failure without fabricating insights", async () => {
    clearAiCacheForTests();
    await expect(
      explainManagementInsights({
        provider: createUnavailableMockProvider(),
        organizationId: "11111111-1111-1111-1111-111111111111",
        facts: FACTS,
        forceRefresh: true,
      }),
    ).rejects.toMatchObject({ status: 504 });
  });

  it("does not replace an empty model items array with deterministic project notes", async () => {
    clearAiCacheForTests();
    const emptyItemsProvider: AiProvider = {
      id: "mock",
      model: "mock-empty-items",
      async generateText() {
        throw new Error("unused");
      },
      async generateStructured<T>() {
        return {
          value: {
            headline_ar: "لا توجد بنود تحليل إضافية.",
            executive_summary_ar: "لا توجد بنود تحليل إضافية.",
            items: [],
            observations: [],
            recommendations: [],
            limitations_ar: "",
            generated_at: "2026-10-08T16:00:00.000Z",
            data_as_of: "wrong-date",
          } as T,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          model: "mock-empty-items",
          latencyMs: 1,
        };
      },
    };
    const explained = await explainManagementInsights({
      provider: emptyItemsProvider,
      organizationId: "11111111-1111-1111-1111-111111111111",
      facts: FACTS,
      forceRefresh: true,
    });
    expect(explained.insight.items).toEqual([]);
    expect(explained.insight.data_as_of).toBe(FACTS.dataAsOf);
  });

  it("document-analysis pipeline still uses its own schema name", async () => {
    let name: string | null = null;
    const ai = openai(async (_url, init) => {
      const body = JSON.parse(String(init && "body" in init ? init.body : "{}")) as {
        response_format?: { json_schema?: { name?: string } };
      };
      name = body.response_format?.json_schema?.name ?? null;
      return chat({
        content: JSON.stringify({
          summary_ar: "ملخص كاف.",
          key_points: [],
          obligations: [],
          dates: [],
          risks: [],
          missing_information: [],
          management_questions: [],
          citations: [],
        }),
      });
    });
    await analyzeDocumentText({
      provider: ai,
      organizationId: "11111111-1111-1111-1111-111111111111",
      documentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      versionId: "vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv",
      analysisType: "document",
      text: "This is a long enough contract text about obligations and dates in January.",
      pageCount: 1,
    });
    expect(name).toBe("document_analysis");
    expect(documentAnalysisSchema.safeParse({
      summary_ar: "ملخص كاف.",
      key_points: [],
      obligations: [],
      dates: [],
      risks: [],
      missing_information: [],
      management_questions: [],
      citations: [],
    }).success).toBe(true);
  });
});
