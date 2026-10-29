import { AppError, isAppError } from "@/lib/errors";
import type { Locale } from "@/lib/i18n/config";
import {
  AI_PROVIDER_USER_MESSAGE_AR,
  AI_PROVIDER_USER_MESSAGE_EN,
  isAiProviderFailureCode,
} from "./provider-errors";

export type AiClientErrorCode =
  | "AI_DISABLED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DOCUMENT_UNSUPPORTED"
  | "NO_EXTRACTABLE_TEXT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "VALIDATION"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "INTERNAL";

export const AI_ERROR_MESSAGE_AR: Record<AiClientErrorCode, string> = {
  AI_DISABLED: "خدمة التحليل الذكي غير مفعلة حالياً.",
  FORBIDDEN: "ليس لديك صلاحية استخدام هذه الميزة.",
  NOT_FOUND: "العنصر المطلوب غير متاح.",
  DOCUMENT_UNSUPPORTED: "هذا النوع من المستندات غير مدعوم للتحليل حالياً.",
  NO_EXTRACTABLE_TEXT: "تعذر استخراج نص قابل للتحليل من هذا المستند.",
  RATE_LIMITED: "تم الوصول إلى حد الاستخدام المؤقت. حاول لاحقاً.",
  PROVIDER_UNAVAILABLE: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
  VALIDATION: "طلب التحليل غير صالح.",
  CONFLICT: "يوجد تحليل قيد التنفيذ. انتظر اكتماله.",
  UNAUTHORIZED: "يجب تسجيل الدخول للمتابعة.",
  INTERNAL: "تعذر إكمال التحليل حالياً. حاول مرة أخرى.",
};

export const AI_ERROR_MESSAGE_EN: Record<AiClientErrorCode, string> = {
  AI_DISABLED: "Intelligent analysis is not enabled right now.",
  FORBIDDEN: "You do not have permission to use this feature.",
  NOT_FOUND: "The requested item is not available.",
  DOCUMENT_UNSUPPORTED: "This document type is not supported for analysis yet.",
  NO_EXTRACTABLE_TEXT: "No analysable text could be extracted from this document.",
  RATE_LIMITED: "The temporary usage limit was reached. Try again later.",
  PROVIDER_UNAVAILABLE: "The analysis could not be completed right now. Please try again.",
  VALIDATION: "The analysis request is not valid.",
  CONFLICT: "An analysis is already running. Wait for it to finish.",
  UNAUTHORIZED: "Sign in to continue.",
  INTERNAL: "The analysis could not be completed right now. Please try again.",
};

function isAiClientErrorCode(value: unknown): value is AiClientErrorCode {
  return typeof value === "string" && value in AI_ERROR_MESSAGE_AR;
}

/**
 * User-facing message for an AI action error code in the given locale (Arabic by default).
 * Returns null for unknown codes so callers can fall back to the server-provided text.
 */
export function aiClientErrorMessage(code: string | null | undefined, locale: Locale = "ar"): string | null {
  if (isAiProviderFailureCode(code)) {
    return locale === "en" ? AI_PROVIDER_USER_MESSAGE_EN[code] : AI_PROVIDER_USER_MESSAGE_AR[code];
  }
  if (isAiClientErrorCode(code)) {
    return locale === "en" ? AI_ERROR_MESSAGE_EN[code] : AI_ERROR_MESSAGE_AR[code];
  }
  return null;
}

export function mapToAiClientError(error: unknown): { code: string; message: string } {
  if (isAppError(error)) {
    const hint = typeof error.details?.aiCode === "string" ? error.details.aiCode : null;
    if (isAiProviderFailureCode(hint)) {
      return { code: hint, message: AI_PROVIDER_USER_MESSAGE_AR[hint] };
    }
    if (error.code === "FORBIDDEN") return { code: "FORBIDDEN", message: AI_ERROR_MESSAGE_AR.FORBIDDEN };
    if (error.code === "UNAUTHORIZED") return { code: "UNAUTHORIZED", message: AI_ERROR_MESSAGE_AR.UNAUTHORIZED };
    if (error.code === "NOT_FOUND") return { code: "NOT_FOUND", message: AI_ERROR_MESSAGE_AR.NOT_FOUND };
    if (error.code === "RATE_LIMITED") return { code: "RATE_LIMITED", message: AI_ERROR_MESSAGE_AR.RATE_LIMITED };
    if (error.code === "VALIDATION") {
      if (hint === "DOCUMENT_UNSUPPORTED") {
        return { code: "DOCUMENT_UNSUPPORTED", message: AI_ERROR_MESSAGE_AR.DOCUMENT_UNSUPPORTED };
      }
      if (hint === "NO_EXTRACTABLE_TEXT") {
        return { code: "NO_EXTRACTABLE_TEXT", message: AI_ERROR_MESSAGE_AR.NO_EXTRACTABLE_TEXT };
      }
      return { code: "VALIDATION", message: error.userMessageAr || AI_ERROR_MESSAGE_AR.VALIDATION };
    }
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return { code: "PROVIDER_UNAVAILABLE", message: AI_ERROR_MESSAGE_AR.PROVIDER_UNAVAILABLE };
    }
    return { code: "INTERNAL", message: AI_ERROR_MESSAGE_AR.INTERNAL };
  }
  return { code: "INTERNAL", message: AI_ERROR_MESSAGE_AR.INTERNAL };
}

export function aiDisabledError(): AppError {
  return new AppError({
    code: "INTERNAL",
    status: 503,
    message: "AI_DISABLED",
    userMessageAr: AI_ERROR_MESSAGE_AR.AI_DISABLED,
    userMessageEn: "Intelligent analysis is not enabled.",
    details: { aiCode: "AI_DISABLED" },
  });
}
