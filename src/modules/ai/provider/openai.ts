import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AI_LIMITS } from "../limits";
import {
  classifyOpenAiHttpStatus,
  classifyThrownProviderFailure,
  extractSafeOpenAiError,
  invalidProviderResponseError,
  providerFailureAppError,
} from "../provider-errors";
import type {
  AiGenerateStructuredInput,
  AiGenerateTextInput,
  AiProvider,
  AiProviderObserve,
  AiStructuredResult,
  AiTextResult,
  AiUsageMeta,
} from "./types";

function emptyUsage(): AiUsageMeta {
  return { promptTokens: null, completionTokens: null, totalTokens: null };
}

function parseUsage(json: unknown): AiUsageMeta {
  const usage = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } })
    .usage;
  if (!usage) return emptyUsage();
  return {
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function logProviderFailure(input: {
  error: AppError | ValidationError;
  observe?: AiProviderObserve;
  model: string;
}): void {
  const details = input.error.details ?? {};
  logger.warn("ai.provider.failed", {
    event: "ai.provider.failed",
    provider: "openai",
    operation: input.observe?.operation ?? (typeof details.operation === "string" ? details.operation : "unknown"),
    httpStatus: typeof details.httpStatus === "number" ? details.httpStatus : null,
    errorCode: typeof details.aiCode === "string" ? details.aiCode : null,
    model: input.model,
    latencyMs: typeof details.latencyMs === "number" ? details.latencyMs : null,
    organizationId: input.observe?.organizationId ?? null,
    documentId: input.observe?.documentId ?? null,
    versionId: input.observe?.versionId ?? null,
    providerErrorCode: typeof details.providerErrorCode === "string" ? details.providerErrorCode : null,
    providerErrorType: typeof details.providerErrorType === "string" ? details.providerErrorType : null,
  });
}

export function createOpenAIProvider(opts: {
  apiKey: string;
  model: string;
  documentModel: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): AiProvider {
  const base = opts.baseUrl.replace(/\/$/, "");
  const fetchFn = opts.fetchImpl ?? fetch;

  async function complete(input: {
    systemPrompt: string;
    userPayload: string;
    timeoutMs: number;
    json: boolean;
    model: string;
    observe?: AiProviderObserve;
  }): Promise<{ content: string; usage: AiUsageMeta; latencyMs: number; model: string }> {
    const started = Date.now();
    let lastError: unknown;
    const operation = input.observe?.operation ?? (input.json ? "structured" : "text");

    for (let attempt = 0; attempt <= AI_LIMITS.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const res = await fetchFn(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify({
            model: input.model,
            temperature: AI_LIMITS.temperature,
            ...(input.json ? { response_format: { type: "json_object" } } : {}),
            messages: [
              { role: "system", content: input.systemPrompt },
              { role: "user", content: input.userPayload },
            ],
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          let providerErrorCode: string | null = null;
          let providerErrorType: string | null = null;
          try {
            const payload: unknown = await res.clone().json();
            const extracted = extractSafeOpenAiError(payload);
            providerErrorCode = extracted.code;
            providerErrorType = extracted.type;
          } catch {
            providerErrorCode = null;
            providerErrorType = null;
          }
          const classified = classifyOpenAiHttpStatus(res.status);
          const failure = providerFailureAppError({
            code: classified,
            httpStatus: res.status,
            model: input.model,
            latencyMs: Date.now() - started,
            providerErrorCode,
            providerErrorType,
            operation,
          });
          if ((res.status === 429 || res.status >= 500) && attempt < AI_LIMITS.maxRetries) {
            lastError = failure;
            await sleep(AI_LIMITS.retryBackoffMs);
            continue;
          }
          logProviderFailure({ error: failure, observe: input.observe, model: input.model });
          throw failure;
        }

        let json: { choices?: Array<{ message?: { content?: string } }> };
        try {
          json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        } catch {
          const failure = invalidProviderResponseError("AI_PROVIDER_INVALID_RESPONSE", {
            httpStatus: res.status,
            model: input.model,
            latencyMs: Date.now() - started,
            operation,
          });
          logProviderFailure({ error: failure, observe: input.observe, model: input.model });
          throw failure;
        }
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
          const failure = invalidProviderResponseError("AI_PROVIDER_INVALID_RESPONSE");
          logProviderFailure({ error: failure, observe: input.observe, model: input.model });
          throw failure;
        }
        return {
          content,
          usage: parseUsage(json),
          latencyMs: Date.now() - started,
          model: input.model,
        };
      } catch (e) {
        if (e instanceof AppError) throw e;
        const thrown = classifyThrownProviderFailure(e);
        const failure = providerFailureAppError({
          code: thrown.code,
          httpStatus: thrown.httpStatus,
          model: input.model,
          latencyMs: Date.now() - started,
          operation,
        });
        if (thrown.code === "AI_PROVIDER_NETWORK_ERROR" && attempt < AI_LIMITS.maxRetries) {
          lastError = failure;
          await sleep(AI_LIMITS.retryBackoffMs);
          continue;
        }
        logProviderFailure({ error: failure, observe: input.observe, model: input.model });
        throw failure;
      } finally {
        clearTimeout(timer);
      }
    }

    if (lastError instanceof AppError) {
      logProviderFailure({ error: lastError, observe: input.observe, model: input.model });
      throw lastError;
    }
    const fallback = providerFailureAppError({
      code: "AI_PROVIDER_SERVER_ERROR",
      model: input.model,
      latencyMs: Date.now() - started,
      operation,
    });
    logProviderFailure({ error: fallback, observe: input.observe, model: input.model });
    throw fallback;
  }

  return {
    id: "openai",
    model: opts.model,
    async generateText(input: AiGenerateTextInput): Promise<AiTextResult> {
      const result = await complete({
        systemPrompt: input.systemPrompt,
        userPayload: input.userPayload,
        timeoutMs: input.timeoutMs ?? AI_LIMITS.providerTimeoutMs,
        json: false,
        model: opts.model,
        observe: input.observe,
      });
      return { text: result.content, usage: result.usage, model: result.model, latencyMs: result.latencyMs };
    },
    async generateStructured<T>(input: AiGenerateStructuredInput<T>): Promise<AiStructuredResult<T>> {
      const result = await complete({
        systemPrompt: input.systemPrompt,
        userPayload: input.userPayload,
        timeoutMs: input.timeoutMs ?? AI_LIMITS.providerTimeoutMs,
        json: true,
        model: input.modelKind === "document" ? opts.documentModel : opts.model,
        observe: input.observe,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        const failure = invalidProviderResponseError("AI_PROVIDER_INVALID_RESPONSE");
        logProviderFailure({ error: failure, observe: input.observe, model: result.model });
        throw failure;
      }
      const checked = input.schema.safeParse(parsed);
      if (!checked.success) {
        const failure = invalidProviderResponseError("AI_PROVIDER_SCHEMA_ERROR");
        logProviderFailure({ error: failure, observe: input.observe, model: result.model });
        throw failure;
      }
      return { value: checked.data, usage: result.usage, model: result.model, latencyMs: result.latencyMs };
    },
  };
}
