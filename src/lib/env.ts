import { z } from "zod";
import { logger } from "@/lib/logger";

const optionalEmpty = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? undefined : value),
  z.string().min(1).optional(),
);

const optionalPublicString = optionalEmpty;

const optionalKey = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? undefined : value),
  z.string().min(8).optional(),
);

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: optionalPublicString,
  NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: optionalPublicString,
  NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: optionalPublicString,
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  LIVE_TEST_ENABLED: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
  LIVE_TEST_PASSWORD_PREFIX: z.string().min(8).optional(),
  DATABASE_URL: z.string().url().optional(),
  /** none | mock | openai — default none (analyst unavailable). */
  MANAGEMENT_AI_PROVIDER: z.enum(["none", "mock", "openai"]).optional(),
  MANAGEMENT_AI_API_KEY: z.string().min(8).optional(),
  MANAGEMENT_AI_MODEL: z.string().min(1).optional(),
  MANAGEMENT_AI_BASE_URL: z.string().url().optional(),
  AI_ENABLED: z.preprocess(
    (value) => (value === "" || value === undefined || value === null ? undefined : value),
    z.enum(["true", "false", "1", "0"]).optional(),
  ),
  AI_PROVIDER: z.preprocess(
    (value) => (value === "" || value === undefined || value === null ? undefined : value),
    z.enum(["none", "mock", "openai"]).optional(),
  ),
  OPENAI_API_KEY: optionalKey,
  AI_MODEL: optionalEmpty,
  AI_DOCUMENT_MODEL: optionalEmpty,
  NOTIFICATION_EMAIL_PROVIDER: z.enum(["none", "mock", "resend"]).optional(),
  NOTIFICATION_WHATSAPP_PROVIDER: z.enum(["none", "mock"]).optional(),
  NOTIFICATION_PUSH_PROVIDER: z.enum(["none", "mock"]).optional(),
  RESEND_API_KEY: z.string().min(8).optional(),
  NOTIFICATION_EMAIL_FROM: z.string().optional(),
  NOTIFICATION_EMAIL_REPLY_TO: z.preprocess(
    (value) => (value === "" || value === undefined || value === null ? undefined : value),
    z.string().email().optional(),
  ),
  RESEND_TIMEOUT_MS: z.string().optional(),
  NOTIFICATIONS_CRON_SECRET: z.string().min(16).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.NOTIFICATION_EMAIL_PROVIDER !== "resend") return;
  if (!data.RESEND_API_KEY || data.RESEND_API_KEY.length < 8) {
    ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"] });
  }
  if (!data.NOTIFICATION_EMAIL_FROM || !data.NOTIFICATION_EMAIL_FROM.includes("@")) {
    ctx.addIssue({ code: "custom", path: ["NOTIFICATION_EMAIL_FROM"] });
  }
  try {
    const url = new URL(data.NEXT_PUBLIC_APP_URL ?? "");
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".local")
    ) {
      ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_APP_URL"] });
    }
  } catch {
    ctx.addIssue({ code: "custom", path: ["NEXT_PUBLIC_APP_URL"] });
  }
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

/** Keys actually passed into serverSchema by getServerEnv — not every field declared on the schema. */
export const GET_SERVER_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID",
  "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY",
  "NEXT_PUBLIC_GOOGLE_PICKER_ENABLED",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BOOTSTRAP_ADMIN_EMAIL",
  "MANAGEMENT_AI_PROVIDER",
  "MANAGEMENT_AI_API_KEY",
  "MANAGEMENT_AI_MODEL",
  "MANAGEMENT_AI_BASE_URL",
  "AI_ENABLED",
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "AI_MODEL",
  "AI_DOCUMENT_MODEL",
  "NOTIFICATION_EMAIL_PROVIDER",
  "NOTIFICATION_WHATSAPP_PROVIDER",
  "NOTIFICATION_PUSH_PROVIDER",
  "RESEND_API_KEY",
  "NOTIFICATION_EMAIL_FROM",
  "NOTIFICATION_EMAIL_REPLY_TO",
  "RESEND_TIMEOUT_MS",
  "NOTIFICATIONS_CRON_SECRET",
  "CRON_SECRET",
  "VAPID_PRIVATE_KEY",
] as const;

export type ServerEnvIssueDiagnostic = { name: string; code: string };

export const SERVER_ENV_VALIDATION_FAILED_EVENT = "server_env_validation_failed" as const;

/** Names + Zod codes only. Never include issue.message or received/input values. */
export function serverEnvIssueDiagnostics(error: z.ZodError): ServerEnvIssueDiagnostic[] {
  return error.issues.map((issue) => ({
    name: issue.path.length > 0 ? issue.path.map(String).join(".") : "unknown",
    code: String(issue.code),
  }));
}

export function emitServerEnvValidationFailed(issues: ServerEnvIssueDiagnostic[]): void {
  const payload = {
    event: SERVER_ENV_VALIDATION_FAILED_EVENT,
    issues,
  };
  console.error(payload);
  logger.error(SERVER_ENV_VALIDATION_FAILED_EVENT, payload);
}

export function parseServerEnvRecord(record: Record<string, unknown>) {
  return serverSchema.safeParse(record);
}

export function readServerEnvRecordFromProcess(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
    MANAGEMENT_AI_PROVIDER: process.env.MANAGEMENT_AI_PROVIDER,
    MANAGEMENT_AI_API_KEY: process.env.MANAGEMENT_AI_API_KEY,
    MANAGEMENT_AI_MODEL: process.env.MANAGEMENT_AI_MODEL,
    MANAGEMENT_AI_BASE_URL: process.env.MANAGEMENT_AI_BASE_URL,
    AI_ENABLED: process.env.AI_ENABLED,
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_DOCUMENT_MODEL: process.env.AI_DOCUMENT_MODEL,
    NOTIFICATION_EMAIL_PROVIDER: process.env.NOTIFICATION_EMAIL_PROVIDER,
    NOTIFICATION_WHATSAPP_PROVIDER: process.env.NOTIFICATION_WHATSAPP_PROVIDER,
    NOTIFICATION_PUSH_PROVIDER: process.env.NOTIFICATION_PUSH_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NOTIFICATION_EMAIL_FROM: process.env.NOTIFICATION_EMAIL_FROM,
    NOTIFICATION_EMAIL_REPLY_TO: process.env.NOTIFICATION_EMAIL_REPLY_TO,
    RESEND_TIMEOUT_MS: process.env.RESEND_TIMEOUT_MS,
    NOTIFICATIONS_CRON_SECRET: process.env.NOTIFICATIONS_CRON_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
    NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_PICKER_ENABLED,
  };
}

function isBuildTime(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function readPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
    NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_PICKER_ENABLED,
  });

  if (!parsed.success) {
    if (isBuildTime()) {
      return {
        NEXT_PUBLIC_SUPABASE_URL: "https://build.placeholder.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_build_placeholder_key_value",
      };
    }
    throw new Error(
      "Missing or invalid public environment variables. Copy .env.example to .env.local.",
    );
  }

  return parsed.data;
}

let cachedPublic: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  if (!cachedPublic) {
    cachedPublic = readPublicEnv();
  }
  return cachedPublic;
}

export function getServerEnv(): ServerEnv {
  const parsed = parseServerEnvRecord(readServerEnvRecordFromProcess());

  if (!parsed.success) {
    emitServerEnvValidationFailed(serverEnvIssueDiagnostics(parsed.error));
    throw new Error(
      "Missing or invalid server environment variables. Copy .env.example to .env.local.",
    );
  }

  return parsed.data;
}

export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return key;
}

export function hasSupabaseConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export type EnvClassification = {
  name: string;
  scope: "public" | "server" | "optional" | "dev-only";
  required: boolean;
  description: string;
};

/** Documented environment variable contract for operators and CI. */
export const ENV_CATALOG: readonly EnvClassification[] = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    scope: "public",
    required: true,
    description: "Supabase project URL",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    scope: "public",
    required: true,
    description: "Supabase anon/publishable key",
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    scope: "public",
    required: false,
    description: "Canonical app URL for redirects",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    scope: "server",
    required: false,
    description: "Service role — admin user bootstrap and user creation only",
  },
  {
    name: "BOOTSTRAP_ADMIN_EMAIL",
    scope: "server",
    required: false,
    description: "First-login platform admin email (normalized lowercase)",
  },
  {
    name: "LIVE_TEST_ENABLED",
    scope: "dev-only",
    required: false,
    description: "Enable live Supabase integration tests",
  },
  {
    name: "LIVE_TEST_PASSWORD_PREFIX",
    scope: "dev-only",
    required: false,
    description: "Prefix for ephemeral test-user passwords",
  },
  {
    name: "DATABASE_URL",
    scope: "dev-only",
    required: false,
    description: "Direct Postgres URL for migration scripts",
  },
  {
    name: "MANAGEMENT_AI_PROVIDER",
    scope: "server",
    required: false,
    description: "Management analyst provider: none | mock | openai (default none)",
  },
  {
    name: "MANAGEMENT_AI_API_KEY",
    scope: "server",
    required: false,
    description: "Server-only LLM API key (never NEXT_PUBLIC_*)",
  },
  {
    name: "MANAGEMENT_AI_MODEL",
    scope: "server",
    required: false,
    description: "Model id e.g. gpt-4o-mini (default when openai)",
  },
  {
    name: "MANAGEMENT_AI_BASE_URL",
    scope: "server",
    required: false,
    description: "OpenAI-compatible API base URL (optional)",
  },
  {
    name: "AI_ENABLED",
    scope: "server",
    required: false,
    description: "Kill switch for Master Touch Intelligence (true|false). false disables all AI including mock.",
  },
  {
    name: "AI_PROVIDER",
    scope: "server",
    required: false,
    description: "Unified AI provider: none | mock | openai",
  },
  {
    name: "OPENAI_API_KEY",
    scope: "server",
    required: false,
    description: "Server-only OpenAI API key (never NEXT_PUBLIC_*)",
  },
  {
    name: "AI_MODEL",
    scope: "server",
    required: false,
    description: "Configured OpenAI model id (do not hardcode in application code)",
  },
  {
    name: "AI_DOCUMENT_MODEL",
    scope: "server",
    required: false,
    description: "Optional document-analysis model override",
  },
  {
    name: "NOTIFICATION_EMAIL_PROVIDER",
    scope: "server",
    required: false,
    description: "Email adapter: none | mock | resend",
  },
  {
    name: "RESEND_API_KEY",
    scope: "server",
    required: false,
    description: "Resend API key — server only",
  },
  {
    name: "NOTIFICATION_EMAIL_FROM",
    scope: "server",
    required: false,
    description: "From address for operational email",
  },
  {
    name: "NOTIFICATION_EMAIL_REPLY_TO",
    scope: "server",
    required: false,
    description: "Optional Reply-To (not a login identity)",
  },
  {
    name: "RESEND_TIMEOUT_MS",
    scope: "server",
    required: false,
    description: "Resend fetch timeout milliseconds (default 8000)",
  },
  {
    name: "NOTIFICATION_WHATSAPP_PROVIDER",
    scope: "server",
    required: false,
    description: "WhatsApp adapter: none | mock (no production credentials in repo)",
  },
  {
    name: "NOTIFICATION_PUSH_PROVIDER",
    scope: "server",
    required: false,
    description: "Web Push adapter: none | mock",
  },
  {
    name: "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    scope: "public",
    required: false,
    description: "VAPID public key for browser PushManager.subscribe",
  },
  {
    name: "VAPID_PRIVATE_KEY",
    scope: "server",
    required: false,
    description: "VAPID private key — never NEXT_PUBLIC",
  },
  {
    name: "NOTIFICATIONS_CRON_SECRET",
    scope: "server",
    required: false,
    description: "Optional alias bearer for /api/internal/notifications/run",
  },
  {
    name: "CRON_SECRET",
    scope: "server",
    required: false,
    description: "Vercel Cron Authorization Bearer secret (≥16). Preferred cron contract.",
  },
  {
    name: "NEXT_PUBLIC_GOOGLE_PICKER_ENABLED",
    scope: "public",
    required: false,
    description: "Enable Google Picker when true and public Google identifiers are set",
  },
  {
    name: "NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID",
    scope: "public",
    required: false,
    description: "Google OAuth Web client ID for GIS token client (browser identifier)",
  },
  {
    name: "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY",
    scope: "public",
    required: false,
    description: "HTTP-referrer-restricted Google Picker API key (browser identifier)",
  },
] as const;

export function isLiveTestEnabled(): boolean {
  const v = process.env.LIVE_TEST_ENABLED;
  return v === "true" || v === "1";
}

export function getLiveTestPassword(role: string): string {
  const prefix = process.env.LIVE_TEST_PASSWORD_PREFIX ?? "MtTest1!";
  return `${prefix}${role}`;
}
