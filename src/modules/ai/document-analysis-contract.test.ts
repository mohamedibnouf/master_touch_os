import { describe, expect, it, vi, afterEach } from "vitest";
import { documentAnalysisSchema } from "@/modules/ai/schemas";
import {
  DOCUMENT_ANALYSIS_OPENAI_JSON_SCHEMA,
  documentAnalysisResponseInstructions,
  extractChatMessageContent,
  normalizeDocumentAnalysisShape,
  parseDocumentAnalysisJson,
  summarizeZodIssues,
  validateDocumentAnalysisPayload,
} from "@/modules/ai/document-analysis-contract";
import { buildDocumentAnalysisPrompt } from "@/modules/ai/prompts";
import { createOpenAIProvider } from "@/modules/ai/provider/openai";
import { persistAiRun } from "@/modules/ai/cache";
import { classifyDocumentSource } from "@/modules/ai/classify-source";
import { driveAiRecoveryVisibility } from "@/modules/documents/drive-ai-auth";
import { logger, sanitizeLogContext } from "@/lib/logger";

const VALID = {
  summary_ar: "ملخص عن تأخير التوريد.",
  key_points: ["نقطة"],
  obligations: [],
  dates: [],
  risks: ["مخاطرة نصية"],
  missing_information: [],
  management_questions: [],
  citations: [{ label_ar: "المصدر", page: null }],
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

function chatContent(content: unknown, finish_reason = "stop") {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("document analysis contract", () => {
  it("1. accepts exact valid document-analysis JSON", () => {
    expect(validateDocumentAnalysisPayload(VALID).ok).toBe(true);
    expect(documentAnalysisSchema.safeParse(VALID).success).toBe(true);
  });

  it("2. accepts Arabic strings", () => {
    const result = validateDocumentAnalysisPayload(VALID);
    expect(result.ok && result.value.summary_ar).toContain("ملخص");
  });

  it("3. missing required summary fails closed", () => {
    const { summary_ar: _drop, ...rest } = VALID;
    void _drop;
    const result = validateDocumentAnalysisPayload(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.includes("summary_ar"))).toBe(true);
  });

  it("4. wrong array/string type fails closed", () => {
    const result = validateDocumentAnalysisPayload({ ...VALID, key_points: "not-an-array" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe("key_points");
      expect(result.issues[0]?.received).toBe("string");
    }
  });

  it("5. invalid nested type (page enum-like string) fails closed", () => {
    const result = validateDocumentAnalysisPayload({
      ...VALID,
      citations: [{ label_ar: "ص", page: "high" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.startsWith("citations"))).toBe(true);
  });

  it("6. nested risk objects are rejected (risks are strings)", () => {
    const result = validateDocumentAnalysisPayload({
      ...VALID,
      risks: [{ title: "delay", severity: "high", description: "14 days" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path.startsWith("risks"))).toBe(true);
      expect(JSON.stringify(result.issues)).not.toContain("14 days");
    }
  });

  it("7. optional/nullable: omitted arrays default to []; omitted page becomes null", () => {
    const result = validateDocumentAnalysisPayload({
      summary_ar: "نص كاف للتحليل المعتمد.",
      citations: [{ label_ar: "مصدر" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.risks).toEqual([]);
      expect(result.value.citations[0]?.page).toBeNull();
    }
  });

  it("8. extra fields are stripped by schema (not a failure)", () => {
    const result = validateDocumentAnalysisPayload({ ...VALID, confidence: 0.9, extra: true });
    expect(result.ok).toBe(true);
  });

  it("9. markdown JSON fences are stripped", () => {
    const parsed = parseDocumentAnalysisJson("```json\n" + JSON.stringify(VALID) + "\n```");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(validateDocumentAnalysisPayload(parsed.value).ok).toBe(true);
  });

  it("10. malformed JSON is json failure", () => {
    expect(parseDocumentAnalysisJson("{not-json")).toEqual({ ok: false, reason: "json" });
  });

  it("11. empty content is empty failure", () => {
    expect(extractChatMessageContent({ content: "" })).toBeNull();
    expect(extractChatMessageContent({ content: "   " })).toBeNull();
  });
});

describe("document analysis OpenAI wiring", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses json_schema structured outputs for document-analysis", async () => {
    let body: Record<string, unknown> = {};
    const ai = openai(async (_url, init) => {
      body = JSON.parse(String(init && "body" in init ? init.body : "{}"));
      return chatContent(JSON.stringify(VALID));
    });
    await ai.generateStructured({
      schemaName: "document-analysis",
      schema: documentAnalysisSchema,
      systemPrompt: buildDocumentAnalysisPrompt(),
      userPayload: "{}",
      modelKind: "document",
    });
    const format = body.response_format as { type?: string; json_schema?: { name?: string; strict?: boolean } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema?.name).toBe("document_analysis");
    expect(format.json_schema?.strict).toBe(true);
    expect(DOCUMENT_ANALYSIS_OPENAI_JSON_SCHEMA.required).toContain("summary_ar");
    expect(buildDocumentAnalysisPrompt()).toContain(documentAnalysisResponseInstructions());
  });

  it("12. valid structured response can persist a succeeded ai_run", async () => {
    const inserted: unknown[] = [];
    const supabase = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          return { error: null };
        },
      }),
    };
    await persistAiRun({
      supabase: supabase as never,
      organizationId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "user-1",
      documentId: "1b5469b5-2750-4a7a-abd2-0adec9de8d31",
      analysisType: "document_analysis",
      provider: "openai",
      model: "gpt-4o-mini",
      promptVersion: "document-analysis:v1",
      status: "succeeded",
      latencyMs: 10,
      inputChars: 40,
      outputChars: 20,
      promptTokens: null,
      completionTokens: null,
    });
    expect(inserted).toEqual([
      expect.objectContaining({ table: "ai_runs", status: "succeeded", error_category: null }),
    ]);
  });

  it("13. invalid response can persist a failed ai_run", async () => {
    const inserted: unknown[] = [];
    const supabase = {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserted.push({ table, ...row });
          return { error: null };
        },
      }),
    };
    await persistAiRun({
      supabase: supabase as never,
      organizationId: "11111111-1111-1111-1111-111111111111",
      actorUserId: "user-1",
      documentId: "1b5469b5-2750-4a7a-abd2-0adec9de8d31",
      analysisType: "document_analysis",
      provider: "openai",
      model: "gpt-4o-mini",
      promptVersion: "document-analysis:v1",
      status: "failed",
      latencyMs: 10,
      inputChars: 0,
      outputChars: 0,
      promptTokens: null,
      completionTokens: null,
      errorCategory: "AI_PROVIDER_SCHEMA_ERROR",
    });
    expect(inserted).toEqual([
      expect.objectContaining({ status: "failed", error_category: "AI_PROVIDER_SCHEMA_ERROR" }),
    ]);
  });

  it("14-15. schema logs omit document content and response values", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ai = openai(async () =>
      chatContent(JSON.stringify({ summary_ar: "SECRET_DOC_VALUE", risks: [{ title: "SECRET_RISK" }] })),
    );
    await ai
      .generateStructured({
        schemaName: "document-analysis",
        schema: documentAnalysisSchema,
        systemPrompt: "sys",
        userPayload: "MT-AI-DRIVE-7319",
        modelKind: "document",
      })
      .catch(() => undefined);
    const dumped = warn.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(dumped).toContain("AI_PROVIDER_SCHEMA_ERROR");
    expect(dumped).not.toContain("SECRET_DOC_VALUE");
    expect(dumped).not.toContain("SECRET_RISK");
    expect(dumped).not.toContain("MT-AI-DRIVE-7319");
    const issues = summarizeZodIssues(documentAnalysisSchema.safeParse({ risks: [{ title: "SECRET" }] }).error!);
    expect(JSON.stringify(issues)).not.toContain("SECRET");
  });

  it("16. Google Drive path still requires fetch", () => {
    expect(
      classifyDocumentSource({
        fileSource: "google_drive",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("DRIVE_FETCH_REQUIRED");
  });

  it("17. Storage path still content-available", () => {
    expect(
      classifyDocumentSource({ fileSource: "storage", mimeType: "application/pdf", filePath: "org/a.pdf" }),
    ).toBe("CONTENT_AVAILABLE");
  });

  it("18. Drive auth recovery still shows once for 404/403", () => {
    expect(driveAiRecoveryVisibility({ recoveryUsed: false, errorCode: "DRIVE_NOT_FOUND" }).showRecovery).toBe(true);
    expect(driveAiRecoveryVisibility({ recoveryUsed: false, errorCode: "DRIVE_FORBIDDEN" }).showRecovery).toBe(true);
    expect(driveAiRecoveryVisibility({ recoveryUsed: true, errorCode: "DRIVE_NOT_FOUND" }).showRecovery).toBe(false);
  });

  it("does not log prompts through sanitizeLogContext", () => {
    expect(sanitizeLogContext({ prompt: "hidden", errorCode: "AI_PROVIDER_SCHEMA_ERROR" })).toEqual({
      errorCode: "AI_PROVIDER_SCHEMA_ERROR",
    });
    void logger;
  });
});

describe("normalize helpers", () => {
  it("does not invent summary content", () => {
    expect(validateDocumentAnalysisPayload(normalizeDocumentAnalysisShape({ key_points: [] })).ok).toBe(false);
  });
});
