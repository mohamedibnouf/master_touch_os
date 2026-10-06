type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const safe = sanitizeLogContext(context);
  const entry = {
    ...safe,
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  if (level === "error") {
    console.error(entry);
    return;
  }
  if (level === "warn") {
    console.warn(entry);
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(entry);
  }
}

const BLOCKED_LOG_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "googleaccesstoken",
  "google_access_token",
  "refresh_token",
  "service_role",
  "api_key",
  "apikey",
  "resend",
  "authorization",
  "cookie",
  "secret",
  "prompt",
  "systemprompt",
  "userpayload",
  "documenttext",
  "extractedtext",
]);

function isSensitiveLogKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (BLOCKED_LOG_KEYS.has(key.toLowerCase()) || BLOCKED_LOG_KEYS.has(k)) return true;
  return k.includes("token") || k.includes("secret") || k.includes("authorization") || k.includes("bearer");
}

function looksLikeSecretValue(value: string): boolean {
  return /^(ya29\.|1\/\/|Bearer\s)/i.test(value.trim());
}

export function sanitizeLogContext(context?: LogContext): LogContext {
  if (!context) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) => {
      if (isSensitiveLogKey(key)) return [];
      if (typeof value === "string" && looksLikeSecretValue(value)) return [];
      return [[key, value]];
    }),
  );
}

export const logger = {
  debug(message: string, context?: LogContext) {
    emit("debug", message, context);
  },
  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    emit("error", message, context);
  },
};
