import { AppError, ValidationError } from "@/lib/errors";

export type AiProviderFailureCode =
  | "AI_PROVIDER_BAD_REQUEST"
  | "AI_PROVIDER_AUTH_FAILED"
  | "AI_PROVIDER_FORBIDDEN"
  | "AI_PROVIDER_MODEL_NOT_FOUND"
  | "AI_PROVIDER_RATE_LIMITED"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_SERVER_ERROR"
  | "AI_PROVIDER_NETWORK_ERROR"
  | "AI_PROVIDER_INVALID_RESPONSE"
  | "AI_PROVIDER_SCHEMA_ERROR";

export const AI_PROVIDER_USER_MESSAGE_AR: Record<AiProviderFailureCode, string> = {
  AI_PROVIDER_BAD_REQUEST: "تعذر إكمال التحليل بسبب إعداد غير صالح لخدمة الذكاء الاصطناعي. حاول مرة أخرى.",
  AI_PROVIDER_AUTH_FAILED: "تعذر التحقق من إعدادات خدمة الذكاء الاصطناعي. يرجى مراجعة مفتاح OpenAI.",
  AI_PROVIDER_FORBIDDEN: "خدمة الذكاء الاصطناعي رفضت الطلب. يرجى مراجعة صلاحيات المفتاح.",
  AI_PROVIDER_MODEL_NOT_FOUND: "نموذج الذكاء الاصطناعي المحدد غير متاح. يرجى مراجعة إعدادات النموذج.",
  AI_PROVIDER_RATE_LIMITED:
    "تم الوصول إلى حد استخدام خدمة الذكاء الاصطناعي مؤقتاً. يرجى المحاولة لاحقاً أو مراجعة رصيد الخدمة.",
  AI_PROVIDER_TIMEOUT: "استغرقت خدمة الذكاء الاصطناعي وقتاً أطول من المتوقع. حاول مرة أخرى.",
  AI_PROVIDER_SERVER_ERROR: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
  AI_PROVIDER_NETWORK_ERROR: "تعذر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.",
  AI_PROVIDER_INVALID_RESPONSE: "تم استلام استجابة غير صالحة من خدمة الذكاء الاصطناعي. حاول مرة أخرى.",
  AI_PROVIDER_SCHEMA_ERROR: "تم استلام استجابة غير صالحة من خدمة الذكاء الاصطناعي. حاول مرة أخرى.",
};

export const AI_PROVIDER_USER_MESSAGE_EN: Record<AiProviderFailureCode, string> = {
  AI_PROVIDER_BAD_REQUEST: "The analysis request was rejected by the AI service. Please try again.",
  AI_PROVIDER_AUTH_FAILED: "AI service credentials could not be verified. Review the OpenAI API key.",
  AI_PROVIDER_FORBIDDEN: "The AI service refused this request. Review API key permissions.",
  AI_PROVIDER_MODEL_NOT_FOUND: "The configured AI model is not available. Review model settings.",
  AI_PROVIDER_RATE_LIMITED: "The AI service rate or quota limit was reached. Try later or review billing.",
  AI_PROVIDER_TIMEOUT: "The AI service took too long to respond. Please try again.",
  AI_PROVIDER_SERVER_ERROR: "The AI service is temporarily unavailable. Please try again.",
  AI_PROVIDER_NETWORK_ERROR: "Could not reach the AI service. Please try again.",
  AI_PROVIDER_INVALID_RESPONSE: "The AI service returned an invalid response. Please try again.",
  AI_PROVIDER_SCHEMA_ERROR: "The AI service returned an invalid response. Please try again.",
};

const SAFE_PROVIDER_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

export function isAiProviderFailureCode(value: unknown): value is AiProviderFailureCode {
  return typeof value === "string" && value in AI_PROVIDER_USER_MESSAGE_AR;
}

export function classifyOpenAiHttpStatus(status: number): AiProviderFailureCode {
  if (status === 401) return "AI_PROVIDER_AUTH_FAILED";
  if (status === 403) return "AI_PROVIDER_FORBIDDEN";
  if (status === 404) return "AI_PROVIDER_MODEL_NOT_FOUND";
  if (status === 408) return "AI_PROVIDER_TIMEOUT";
  if (status === 429) return "AI_PROVIDER_RATE_LIMITED";
  if (status === 400) return "AI_PROVIDER_BAD_REQUEST";
  if (status >= 500) return "AI_PROVIDER_SERVER_ERROR";
  if (status >= 400) return "AI_PROVIDER_BAD_REQUEST";
  return "AI_PROVIDER_SERVER_ERROR";
}

export function safeProviderErrorToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!SAFE_PROVIDER_TOKEN.test(trimmed)) return null;
  if (/ya29|bearer|refresh_token|cookie|prompt|sk-[a-z0-9]/i.test(trimmed)) return null;
  return trimmed;
}

export function extractSafeOpenAiError(payload: unknown): { code: string | null; type: string | null } {
  if (!payload || typeof payload !== "object") return { code: null, type: null };
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return { code: null, type: null };
  const rec = error as { code?: unknown; type?: unknown };
  return {
    code: safeProviderErrorToken(rec.code),
    type: safeProviderErrorToken(rec.type),
  };
}

export function classifyThrownProviderFailure(error: unknown): {
  code: AiProviderFailureCode;
  httpStatus: number | null;
} {
  if (error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError") {
    return { code: "AI_PROVIDER_TIMEOUT", httpStatus: 408 };
  }
  return { code: "AI_PROVIDER_NETWORK_ERROR", httpStatus: null };
}

function appStatusFor(code: AiProviderFailureCode, httpStatus: number | null): number {
  if (code === "AI_PROVIDER_RATE_LIMITED") return 429;
  if (code === "AI_PROVIDER_TIMEOUT") return 504;
  if (code === "AI_PROVIDER_AUTH_FAILED") return 502;
  if (code === "AI_PROVIDER_FORBIDDEN") return 502;
  if (code === "AI_PROVIDER_MODEL_NOT_FOUND") return 502;
  if (code === "AI_PROVIDER_BAD_REQUEST") return 502;
  if (code === "AI_PROVIDER_NETWORK_ERROR") return 502;
  if (httpStatus && httpStatus >= 500) return 502;
  return 502;
}

export function providerFailureAppError(input: {
  code: AiProviderFailureCode;
  httpStatus?: number | null;
  model?: string | null;
  latencyMs?: number | null;
  providerErrorCode?: string | null;
  providerErrorType?: string | null;
  operation?: string | null;
}): AppError {
  const httpStatus = input.httpStatus ?? null;
  return new AppError({
    code: input.code === "AI_PROVIDER_RATE_LIMITED" ? "RATE_LIMITED" : "INTERNAL",
    status: appStatusFor(input.code, httpStatus),
    message: `AI provider ${input.code}${httpStatus != null ? ` HTTP ${httpStatus}` : ""}`,
    userMessageAr: AI_PROVIDER_USER_MESSAGE_AR[input.code],
    userMessageEn: AI_PROVIDER_USER_MESSAGE_EN[input.code],
    details: {
      aiCode: input.code,
      httpStatus,
      model: input.model ?? null,
      latencyMs: input.latencyMs ?? null,
      providerErrorCode: input.providerErrorCode ?? null,
      providerErrorType: input.providerErrorType ?? null,
      operation: input.operation ?? null,
    },
  });
}

export function invalidProviderResponseError(
  kind: "AI_PROVIDER_INVALID_RESPONSE" | "AI_PROVIDER_SCHEMA_ERROR",
  extra?: Record<string, unknown>,
): ValidationError {
  return new ValidationError(AI_PROVIDER_USER_MESSAGE_AR[kind], AI_PROVIDER_USER_MESSAGE_EN[kind], {
    aiCode: kind,
    ...extra,
  });
}

export function providerFailureLogFields(error: unknown): {
  event: "ai.provider.failed";
  httpStatus: number | null;
  errorCode: string | null;
  model: string | null;
  latencyMs: number | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  operation: string | null;
} {
  const details =
    error instanceof AppError && error.details && typeof error.details === "object" ? error.details : {};
  const aiCode = isAiProviderFailureCode(details.aiCode) ? details.aiCode : null;
  return {
    event: "ai.provider.failed",
    httpStatus: typeof details.httpStatus === "number" ? details.httpStatus : null,
    errorCode: aiCode,
    model: typeof details.model === "string" ? details.model : null,
    latencyMs: typeof details.latencyMs === "number" ? details.latencyMs : null,
    providerErrorCode: typeof details.providerErrorCode === "string" ? details.providerErrorCode : null,
    providerErrorType: typeof details.providerErrorType === "string" ? details.providerErrorType : null,
    operation: typeof details.operation === "string" ? details.operation : null,
  };
}
