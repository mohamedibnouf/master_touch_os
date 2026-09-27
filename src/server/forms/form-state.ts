import { DatabaseError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

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

export function formActionFailure(err: unknown, unexpectedAr: string): FormActionState {
  if (isNextInterrupt(err)) throw err;
  if (isAppError(err)) {
    if (err.code === "FORBIDDEN") {
      return { ok: false, message: "ليس لديك صلاحية لتنفيذ هذه العملية." };
    }
    if (err.code === "UNAUTHORIZED") {
      return { ok: false, message: err.userMessageAr };
    }
    if (err.code === "VALIDATION") {
      return { ok: false, message: err.userMessageAr || "تحقق من البيانات المدخلة." };
    }
    if (err.code === "CONFLICT") {
      return { ok: false, message: err.userMessageAr || "لا يمكن تنفيذ العملية بسبب تعارض مع بيانات موجودة." };
    }
    if (err.code === "NOT_FOUND") {
      return { ok: false, message: err.userMessageAr };
    }
  }
  if (err instanceof DatabaseError) {
    const code = postgresCode(err);
    logger.error("form action database failure", { code, message: err.message });
    if (code === "23505") {
      return { ok: false, message: "هذه البيانات مستخدمة مسبقاً." };
    }
    if (code === "23503") {
      return { ok: false, message: "لا يمكن تنفيذ العملية لارتباطها ببيانات أخرى." };
    }
    if (code === "23P01") {
      return { ok: false, message: "لا يمكن تنفيذ العملية بسبب تعارض مع بيانات موجودة." };
    }
    if (code === "57014") {
      return { ok: false, message: "استغرق تحميل البيانات وقتاً أطول من المتوقع. حاول مرة أخرى." };
    }
    return { ok: false, message: err.userMessageAr };
  }
  logger.error("form action unexpected failure", {
    message: err instanceof Error ? err.message : "unknown",
  });
  return { ok: false, message: unexpectedAr };
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
    return formActionFailure(err, unexpectedAr);
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
