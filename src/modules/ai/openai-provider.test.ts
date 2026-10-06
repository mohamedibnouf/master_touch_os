import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { sanitizeLogContext } from "@/lib/logger";
import { mapToAiClientError } from "@/modules/ai/errors";
import { createOpenAIProvider } from "@/modules/ai/provider/openai";
import { classifyDocumentSource } from "@/modules/ai/classify-source";
import { DRIVE_AI_ACCESS_MESSAGE_AR } from "@/modules/documents/drive-ai-auth";
import { analyzeDocumentText } from "@/modules/ai/services/document-analysis";
import { createMockAiProvider } from "@/modules/ai/provider/mock";
import { documentAnalysisSchema } from "@/modules/ai/schemas";
import { clearAiCacheForTests } from "@/modules/ai/cache";
import { aiRuntimeConfigSnapshot } from "@/modules/ai/config-env";
import {
  AI_PROVIDER_USER_MESSAGE_AR,
  classifyOpenAiHttpStatus,
  classifyThrownProviderFailure,
  extractSafeOpenAiError,
  isAiProviderFailureCode,
  providerFailureAppError,
} from "@/modules/ai/provider-errors";

const KEY = "test-openai-key-value";
const PROMPT = "SECRET_PROMPT_BODY";
const DOC_TEXT = "MT-AI-DRIVE-7319 HVAC procurement delay of 14 days";
const GOOGLE_TOKEN = "ya29.fake-google-token-value";

const tinySchema = z.object({ summary_ar: z.string().min(1) });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function provider(fetchImpl: typeof fetch) {
  return createOpenAIProvider({
    apiKey: KEY,
    model: "gpt-4o-mini",
    documentModel: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    fetchImpl,
  });
}

async function expectHttp(status: number, code: string, message: string) {
  const ai = provider(async () =>
    jsonResponse(status, { error: { code: "safe_code", type: "invalid_request_error", message: "hidden" } }),
  );
  await expect(
    ai.generateStructured({
      schemaName: "tiny",
      schema: tinySchema,
      systemPrompt: PROMPT,
      userPayload: DOC_TEXT,
      observe: { operation: "document_analysis", documentId: "dddddddd-dddd-dddd-dddd-dddddddddddd" },
    }),
  ).rejects.toMatchObject({ details: { aiCode: code, httpStatus: status } });
  const mapped = mapToAiClientError(providerFailureAppError({ code: code as never, httpStatus: status }));
  expect(mapped.code).toBe(code);
  expect(mapped.message).toBe(message);
}

describe("OpenAI HTTP classification", () => {
  it("1. classifies 400", async () => {
    expect(classifyOpenAiHttpStatus(400)).toBe("AI_PROVIDER_BAD_REQUEST");
    await expectHttp(400, "AI_PROVIDER_BAD_REQUEST", AI_PROVIDER_USER_MESSAGE_AR.AI_PROVIDER_BAD_REQUEST);
  });

  it("2. classifies 401", async () => {
    expect(classifyOpenAiHttpStatus(401)).toBe("AI_PROVIDER_AUTH_FAILED");
    await expectHttp(401, "AI_PROVIDER_AUTH_FAILED", AI_PROVIDER_USER_MESSAGE_AR.AI_PROVIDER_AUTH_FAILED);
  });

  it("3. classifies 403", async () => {
    expect(classifyOpenAiHttpStatus(403)).toBe("AI_PROVIDER_FORBIDDEN");
    await expectHttp(403, "AI_PROVIDER_FORBIDDEN", AI_PROVIDER_USER_MESSAGE_AR.AI_PROVIDER_FORBIDDEN);
  });

  it("4. classifies 404/model", async () => {
    expect(classifyOpenAiHttpStatus(404)).toBe("AI_PROVIDER_MODEL_NOT_FOUND");
    await expectHttp(404, "AI_PROVIDER_MODEL_NOT_FOUND", AI_PROVIDER_USER_MESSAGE_AR.AI_PROVIDER_MODEL_NOT_FOUND);
  });

  it("5. classifies 429", async () => {
    expect(classifyOpenAiHttpStatus(429)).toBe("AI_PROVIDER_RATE_LIMITED");
    await expectHttp(429, "AI_PROVIDER_RATE_LIMITED", AI_PROVIDER_USER_MESSAGE_AR.AI_PROVIDER_RATE_LIMITED);
  });

  it("6. classifies 500", async () => {
    expect(classifyOpenAiHttpStatus(500)).toBe("AI_PROVIDER_SERVER_ERROR");
    await expectHttp(500, "AI_PROVIDER_SERVER_ERROR", AI_PROVIDER_USER_MESSAGE_AR.AI_PROVIDER_SERVER_ERROR);
  });

  it("7. classifies timeout", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyThrownProviderFailure(abort)).toEqual({ code: "AI_PROVIDER_TIMEOUT", httpStatus: 408 });
    const ai = provider(async () => {
      throw abort;
    });
    await expect(
      ai.generateStructured({
        schemaName: "tiny",
        schema: tinySchema,
        systemPrompt: PROMPT,
        userPayload: DOC_TEXT,
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_PROVIDER_TIMEOUT" } });
  });

  it("8. classifies network failure", async () => {
    expect(classifyThrownProviderFailure(new TypeError("fetch failed"))).toEqual({
      code: "AI_PROVIDER_NETWORK_ERROR",
      httpStatus: null,
    });
    const ai = provider(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      ai.generateStructured({
        schemaName: "tiny",
        schema: tinySchema,
        systemPrompt: PROMPT,
        userPayload: DOC_TEXT,
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_PROVIDER_NETWORK_ERROR" } });
  });

  it("9. classifies malformed JSON", async () => {
    const ai = provider(async () => new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(
      ai.generateStructured({
        schemaName: "tiny",
        schema: tinySchema,
        systemPrompt: PROMPT,
        userPayload: DOC_TEXT,
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_PROVIDER_INVALID_RESPONSE" } });
  });

  it("10. classifies schema validation failure", async () => {
    const ai = provider(async () =>
      jsonResponse(200, { choices: [{ message: { content: JSON.stringify({ nope: true }) } }] }),
    );
    await expect(
      ai.generateStructured({
        schemaName: "tiny",
        schema: tinySchema,
        systemPrompt: PROMPT,
        userPayload: DOC_TEXT,
      }),
    ).rejects.toMatchObject({ details: { aiCode: "AI_PROVIDER_SCHEMA_ERROR" } });
  });

  it("11. maps safe Arabic without raw provider bodies", () => {
    const mapped = mapToAiClientError(
      providerFailureAppError({
        code: "AI_PROVIDER_AUTH_FAILED",
        httpStatus: 401,
      }),
    );
    expect(mapped.message).toContain("مفتاح OpenAI");
    expect(mapped.message).not.toContain("sk-");
    expect(mapped.message).not.toContain(KEY);
  });
});

describe("sanitized provider logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("12-15. never logs API key, prompt, document text, or Google token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ai = provider(async () =>
      jsonResponse(401, { error: { code: "invalid_api_key", type: "invalid_request_error", message: KEY } }),
    );
    await ai
      .generateStructured({
        schemaName: "tiny",
        schema: tinySchema,
        systemPrompt: PROMPT,
        userPayload: `${DOC_TEXT} token=${GOOGLE_TOKEN}`,
        observe: { operation: "document_analysis", organizationId: "org", documentId: "doc", versionId: "ver" },
      })
      .catch(() => undefined);

    const dumped = warn.mock.calls.map((c) => JSON.stringify(c)).join("\n");
    expect(dumped).toContain("ai.provider.failed");
    expect(dumped).toContain("AI_PROVIDER_AUTH_FAILED");
    expect(dumped).not.toContain(KEY);
    expect(dumped).not.toContain(PROMPT);
    expect(dumped).not.toContain("MT-AI-DRIVE-7319");
    expect(dumped).not.toContain("ya29.");
    expect(dumped.toLowerCase()).not.toContain("authorization");

    const redacted = sanitizeLogContext({
      authorization: "Bearer secret",
      prompt: PROMPT,
      googleAccessToken: GOOGLE_TOKEN,
      api_key: KEY,
      errorCode: "AI_PROVIDER_AUTH_FAILED",
    });
    expect(redacted).toEqual({ errorCode: "AI_PROVIDER_AUTH_FAILED" });
    expect(extractSafeOpenAiError({ error: { code: "invalid_api_key", type: "invalid_request_error" } }).code).toBe(
      "invalid_api_key",
    );
    expect(extractSafeOpenAiError({ error: { code: "not a token", type: "invalid_request_error" } }).code).toBeNull();
  });
});

describe("successful and adjacent paths", () => {
  it("16. successful provider path returns structured JSON", async () => {
    const ai = provider(async (_url, init) => {
      const body = JSON.parse(String(init && "body" in init ? init.body : "{}"));
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.temperature).toBe(0.2);
      return jsonResponse(200, {
        choices: [{ message: { content: JSON.stringify({ summary_ar: "ملخص" }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      });
    });
    const result = await ai.generateStructured({
      schemaName: "tiny",
      schema: tinySchema,
      systemPrompt: "sys",
      userPayload: "user",
      modelKind: "document",
    });
    expect(result.value.summary_ar).toBe("ملخص");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("17. Drive path classification and access message unchanged", () => {
    expect(
      classifyDocumentSource({
        fileSource: "google_drive",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("DRIVE_FETCH_REQUIRED");
    expect(DRIVE_AI_ACCESS_MESSAGE_AR).toContain("حساب Google");
  });

  it("18. Storage path still content-available", async () => {
    expect(
      classifyDocumentSource({ fileSource: "storage", mimeType: "application/pdf", filePath: "org/a.pdf" }),
    ).toBe("CONTENT_AVAILABLE");
    clearAiCacheForTests();
    const ok = await analyzeDocumentText({
      provider: createMockAiProvider(),
      organizationId: "11111111-1111-1111-1111-111111111111",
      documentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      versionId: "vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv",
      analysisType: "document",
      text: "This is a long enough contract text about obligations and dates in January.",
      pageCount: 2,
    });
    expect(documentAnalysisSchema.safeParse(ok.document).success).toBe(true);
  });

  it("runtime snapshot never includes a key", () => {
    const snap = aiRuntimeConfigSnapshot();
    expect(Object.keys(snap).sort()).toEqual(["documentModel", "enabled", "hasApiKey", "model", "provider"]);
    expect(JSON.stringify(snap)).not.toMatch(/sk-|OPENAI_API_KEY/i);
    expect("apiKey" in snap).toBe(false);
  });

  it("treats only provider failure codes as persistable failed runs", () => {
    expect(isAiProviderFailureCode("AI_PROVIDER_AUTH_FAILED")).toBe(true);
    expect(isAiProviderFailureCode("DRIVE_NOT_FOUND")).toBe(false);
    expect(isAiProviderFailureCode(new AppError({
      code: "INTERNAL",
      status: 500,
      message: "x",
      userMessageAr: "x",
      userMessageEn: "x",
      details: { aiCode: "DRIVE_NOT_FOUND" },
    }).details?.aiCode)).toBe(false);
  });
});
