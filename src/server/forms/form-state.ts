import { DatabaseError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";

export type FormActionState = { ok: boolean; message?: string } | null;

function postgresCode(err: unknown): string | undefined {
  if (!(err instanceof DatabaseError)) return undefined;
  const cause = err.causeError as { code?: string; cause?: { code?: string } } | undefined;
  return cause?.code ?? cause?.cause?.code;
}

function isNextInterrupt(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = "digest" in err ? String((err as { digest?: unknown }).digest ?? "") : "";
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND");
}

const COPY = {
  forbidden: { ar: "ليس لديك صلاحية لتنفيذ هذه العملية.", en: "You do not have permission to perform this action." },
  validation: { ar: "تحقق من البيانات المدخلة.", en: "Please check the data you entered." },
  conflict: {
    ar: "لا يمكن تنفيذ العملية بسبب تعارض مع بيانات موجودة.",
    en: "This action conflicts with existing data.",
  },
  duplicate: { ar: "هذه البيانات مستخدمة مسبقاً.", en: "This value is already in use." },
  referenced: {
    ar: "لا يمكن تنفيذ العملية لارتباطها ببيانات أخرى.",
    en: "This action cannot be completed because the record is linked to other data.",
  },
  timeout: {
    ar: "استغرق تحميل البيانات وقتاً أطول من المتوقع. حاول مرة أخرى.",
    en: "Loading took longer than expected. Please try again.",
  },
  unexpected: { en: "Something went wrong. Please try again." },
} as const;

/**
 * Maps a thrown error to the form state shown to the user. `unexpectedAr` is the
 * call site's Arabic fallback; English uses a generic fallback.
 */
export function formActionFailure(err: unknown, unexpectedAr: string, locale: Locale = "ar"): FormActionState {
  if (isNextInterrupt(err)) throw err;
  const pick = (copy: { ar: string; en: string }) => copy[locale];
  if (isAppError(err)) {
    const own = locale === "en" ? err.userMessageEn : err.userMessageAr;
    if (err.code === "FORBIDDEN") {
      return { ok: false, message: pick(COPY.forbidden) };
    }
    if (err.code === "UNAUTHORIZED" || err.code === "NOT_FOUND") {
      return { ok: false, message: own };
    }
    if (err.code === "VALIDATION") {
      return { ok: false, message: own || pick(COPY.validation) };
    }
    if (err.code === "CONFLICT") {
      return { ok: false, message: own || pick(COPY.conflict) };
    }
  }
  if (err instanceof DatabaseError) {
    const code = postgresCode(err);
    logger.error("form action database failure", { code, errorMessage: err.message });
    if (code === "23505") return { ok: false, message: pick(COPY.duplicate) };
    if (code === "23503") return { ok: false, message: pick(COPY.referenced) };
    if (code === "23P01") return { ok: false, message: pick(COPY.conflict) };
    if (code === "57014") return { ok: false, message: pick(COPY.timeout) };
    return { ok: false, message: locale === "en" ? err.userMessageEn : err.userMessageAr };
  }
  logger.error("form action unexpected failure", {
    errorMessage: err instanceof Error ? err.message : "unknown",
  });
  return { ok: false, message: locale === "en" ? COPY.unexpected.en : unexpectedAr };
}

export async function runFormAction(
  unexpectedAr: string,
  impl: () => Promise<unknown>,
): Promise<FormActionState> {
  try {
    await impl();
    return { ok: true };
  } catch (err) {
    if (isNextInterrupt(err)) throw err;
    return formActionFailure(err, unexpectedAr, await getLocale());
  }
}

export function asFormAction(
  unexpectedAr: string,
  impl: (formData: FormData) => Promise<unknown>,
) {
  return async function formAction(_prev: FormActionState, formData: FormData): Promise<FormActionState> {
    return runFormAction(unexpectedAr, () => impl(formData));
  };
}
