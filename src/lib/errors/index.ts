export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DATABASE"
  | "STORAGE"
  | "RATE_LIMITED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly userMessageAr: string;
  readonly userMessageEn: string;
  readonly details?: Record<string, unknown>;
  readonly causeError?: unknown;

  constructor(input: {
    code: AppErrorCode;
    status: number;
    message: string;
    userMessageAr: string;
    userMessageEn: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "AppError";
    this.code = input.code;
    this.status = input.status;
    this.userMessageAr = input.userMessageAr;
    this.userMessageEn = input.userMessageEn;
    this.details = input.details;
    this.causeError = input.cause;
  }

  toPublic(locale: "ar" | "en" = "ar"): { code: AppErrorCode; message: string } {
    return {
      code: this.code,
      message: locale === "en" ? this.userMessageEn : this.userMessageAr,
    };
  }
}

export class UnauthorizedError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Authentication required",
      userMessageAr: "يجب تسجيل الدخول للمتابعة.",
      userMessageEn: "You must sign in to continue.",
      details,
    });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super({
      code: "FORBIDDEN",
      status: 403,
      message: "Insufficient permissions",
      userMessageAr: "ليست لديك صلاحية لتنفيذ هذا الإجراء.",
      userMessageEn: "You do not have permission to perform this action.",
      details,
    });
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(userMessageAr: string, userMessageEn: string, details?: Record<string, unknown>) {
    super({
      code: "VALIDATION",
      status: 400,
      message: "Validation failed",
      userMessageAr,
      userMessageEn,
      details,
    });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(entityAr: string, entityEn: string) {
    super({
      code: "NOT_FOUND",
      status: 404,
      message: `${entityEn} not found`,
      userMessageAr: `${entityAr} غير موجود.`,
      userMessageEn: `${entityEn} was not found.`,
    });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(userMessageAr: string, userMessageEn: string, details?: Record<string, unknown>) {
    super({
      code: "CONFLICT",
      status: 409,
      message: "Conflict",
      userMessageAr,
      userMessageEn,
      details,
    });
    this.name = "ConflictError";
  }
}

export class DatabaseError extends AppError {
  constructor(cause?: unknown) {
    super({
      code: "DATABASE",
      status: 500,
      message: "Database operation failed",
      userMessageAr: "حدث خطأ أثناء حفظ البيانات. حاول مرة أخرى.",
      userMessageEn: "A data error occurred. Please try again.",
      cause,
    });
    this.name = "DatabaseError";
  }
}

export class StorageError extends AppError {
  constructor(cause?: unknown) {
    super({
      code: "STORAGE",
      status: 500,
      message: "Storage operation failed",
      userMessageAr: "تعذر رفع أو الوصول إلى الملف.",
      userMessageEn: "The file could not be uploaded or accessed.",
      cause,
    });
    this.name = "StorageError";
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds?: number) {
    super({
      code: "RATE_LIMITED",
      status: 429,
      message: "Rate limited",
      userMessageAr: "تم تجاوز حد طلبات التحليل. حاول بعد قليل.",
      userMessageEn: "Analysis rate limit exceeded. Please try again shortly.",
      details: retryAfterSeconds != null ? { retryAfterSeconds } : undefined,
    });
    this.name = "RateLimitedError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError({
    code: "INTERNAL",
    status: 500,
    message: "Unexpected error",
    userMessageAr: "حدث خطأ غير متوقع. حاول مرة أخرى لاحقاً.",
    userMessageEn: "An unexpected error occurred. Please try again later.",
    cause: error,
  });
}
