import { AppError, isAppError } from "@/lib/errors";
import { AI_PROVIDER_USER_MESSAGE_AR, isAiProviderFailureCode } from "./provider-errors";

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
