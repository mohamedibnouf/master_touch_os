import { AppError, ValidationError } from "@/lib/errors";
import { AI_LIMITS } from "../limits";
import type {
  AiGenerateStructuredInput,
  AiGenerateTextInput,
  AiProvider,
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

export function createOpenAIProvider(opts: {
  apiKey: string;
  model: string;
  documentModel: string;
  baseUrl: string;
}): AiProvider {
  const base = opts.baseUrl.replace(/\/$/, "");

  async function complete(input: {
    systemPrompt: string;
    userPayload: string;
    timeoutMs: number;
    json: boolean;
    model: string;
  }): Promise<{ content: string; usage: AiUsageMeta; latencyMs: number; model: string }> {
    const started = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt <= AI_LIMITS.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const res = await fetch(`${base}/chat/completions`, {
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

        if (res.status === 429 || res.status >= 500) {
          lastError = new AppError({
            code: "INTERNAL",
            status: 502,
            message: `AI provider HTTP ${res.status}`,
            userMessageAr: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
            userMessageEn: "Analysis is temporarily unavailable. Please try again.",
          });
          if (attempt < AI_LIMITS.maxRetries) {
            await sleep(AI_LIMITS.retryBackoffMs);
            continue;
          }
          throw lastError;
        }

        if (!res.ok) {
          throw new AppError({
            code: "INTERNAL",
            status: 502,
            message: `AI provider HTTP ${res.status}`,
            userMessageAr: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
            userMessageEn: "Analysis is temporarily unavailable. Please try again.",
          });
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) {
          throw new ValidationError("استجابة فارغة من مزود التحليل.", "Empty response from analysis provider.");
        }
        return {
          content,
          usage: parseUsage(json),
          latencyMs: Date.now() - started,
          model: input.model,
        };
      } catch (e) {
        if (e instanceof AppError) throw e;
        if (e instanceof Error && e.name === "AbortError") {
          throw new AppError({
            code: "INTERNAL",
            status: 504,
            message: "AI provider timeout",
            userMessageAr: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
            userMessageEn: "Analysis timed out. Please try again.",
          });
        }
        lastError = e;
        if (attempt < AI_LIMITS.maxRetries) {
          await sleep(AI_LIMITS.retryBackoffMs);
          continue;
        }
        throw lastError instanceof Error ? lastError : new Error("AI provider failed");
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("AI provider failed");
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
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        throw new ValidationError("تعذر قراءة استجابة التحليل.", "Could not parse analysis response.");
      }
      const value = input.schema.parse(parsed);
      return { value, usage: result.usage, model: result.model, latencyMs: result.latencyMs };
    },
  };
}
