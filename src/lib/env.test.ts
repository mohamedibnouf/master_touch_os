import { describe, expect, it, vi } from "vitest";
import {
  GET_SERVER_ENV_KEYS,
  SERVER_ENV_VALIDATION_FAILED_EVENT,
  emitServerEnvValidationFailed,
  parseServerEnvRecord,
  readServerEnvRecordFromProcess,
  serverEnvIssueDiagnostics,
} from "@/lib/env";

const validBase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_anon_key_value",
};

describe("getServerEnv parse keys vs Vercel-visible names", () => {
  it("parses CRON_SECRET as the Vercel Cron contract and omits live-test keys", () => {
    expect(GET_SERVER_ENV_KEYS).toContain("CRON_SECRET");
    expect(GET_SERVER_ENV_KEYS).toContain("NOTIFICATIONS_CRON_SECRET");
    expect(GET_SERVER_ENV_KEYS).not.toContain("LIVE_TEST_ENABLED");
    expect(GET_SERVER_ENV_KEYS).not.toContain("LIVE_TEST_PASSWORD_PREFIX");
    expect(Object.keys(readServerEnvRecordFromProcess())).not.toContain("LIVE_TEST_ENABLED");
    expect(Object.keys(readServerEnvRecordFromProcess())).not.toContain("LIVE_TEST_PASSWORD_PREFIX");
  });

  it("does parse the visible keys that can fail serverSchema", () => {
    expect(GET_SERVER_ENV_KEYS).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID",
        "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY",
        "NEXT_PUBLIC_GOOGLE_PICKER_ENABLED",
        "SUPABASE_SERVICE_ROLE_KEY",
        "BOOTSTRAP_ADMIN_EMAIL",
        "NOTIFICATIONS_CRON_SECRET",
      ]),
    );
  });
});

describe("serverEnvIssueDiagnostics", () => {
  it("reports names and codes only when BOOTSTRAP_ADMIN_EMAIL is an empty string", () => {
    const parsed = parseServerEnvRecord({
      ...validBase,
      BOOTSTRAP_ADMIN_EMAIL: "",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = serverEnvIssueDiagnostics(parsed.error);
    expect(issues.some((row) => row.name === "BOOTSTRAP_ADMIN_EMAIL")).toBe(true);
    const blob = JSON.stringify(issues);
    expect(blob).not.toMatch(/@/);
    expect(blob).not.toMatch(/BOOTSTRAP_ADMIN_EMAIL":"/);
    expect(issues[0]).toEqual({ name: expect.any(String), code: expect.any(String) });
    expect(Object.keys(issues[0] ?? {})).toEqual(["name", "code"]);
  });

  it("reports too_small when NOTIFICATIONS_CRON_SECRET is an empty string", () => {
    const parsed = parseServerEnvRecord({
      ...validBase,
      NOTIFICATIONS_CRON_SECRET: "",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = serverEnvIssueDiagnostics(parsed.error);
    expect(issues).toContainEqual({ name: "NOTIFICATIONS_CRON_SECRET", code: "too_small" });
    expect(JSON.stringify(issues)).not.toMatch(/change-me|eyJ|sk-/i);
  });

  it("treats omitted optional keys as valid and empty-string APP_URL as invalid", () => {
    expect(parseServerEnvRecord({ ...validBase }).success).toBe(true);
    const emptyApp = parseServerEnvRecord({ ...validBase, NEXT_PUBLIC_APP_URL: "" });
    expect(emptyApp.success).toBe(false);
    if (emptyApp.success) return;
    const issues = serverEnvIssueDiagnostics(emptyApp.error);
    expect(issues.some((row) => row.name === "NEXT_PUBLIC_APP_URL")).toBe(true);
  });

  it("does not copy Zod received/input values or error messages into diagnostics", () => {
    const parsed = parseServerEnvRecord({
      ...validBase,
      BOOTSTRAP_ADMIN_EMAIL: "not-an-email-value",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const safe = JSON.stringify(serverEnvIssueDiagnostics(parsed.error));
    expect(safe).not.toContain("not-an-email-value");
    expect(safe).not.toContain("Invalid email");
    expect(safe).not.toMatch(/@/);
    expect(Object.keys(serverEnvIssueDiagnostics(parsed.error)[0] ?? {}).sort()).toEqual(["code", "name"]);
  });
});

describe("logger reserved fields", () => {
  it("does not let context.message replace the logger message (Vercel-visible overwrite)", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger.error("form action unexpected failure", {
      message: "Missing or invalid server environment variables. Copy .env.example to .env.local.",
    });
    const entry = spy.mock.calls.at(-1)?.[0] as { message?: string };
    spy.mockRestore();
    expect(entry?.message).toBe("form action unexpected failure");
  });
});

describe("emitServerEnvValidationFailed", () => {
  it("writes event, variable name, and issue code to console.error without the env value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    emitServerEnvValidationFailed([{ name: "BOOTSTRAP_ADMIN_EMAIL", code: "invalid_format" }]);
    const payload = spy.mock.calls.find((call) => {
      const first = call[0];
      return Boolean(
        first &&
          typeof first === "object" &&
          (first as { event?: string }).event === SERVER_ENV_VALIDATION_FAILED_EVENT,
      );
    })?.[0] as { event?: string; issues?: Array<{ name: string; code: string }> } | undefined;
    spy.mockRestore();

    expect(payload?.event).toBe(SERVER_ENV_VALIDATION_FAILED_EVENT);
    expect(payload?.issues).toEqual([{ name: "BOOTSTRAP_ADMIN_EMAIL", code: "invalid_format" }]);
    const blob = JSON.stringify(payload);
    expect(blob).toContain("BOOTSTRAP_ADMIN_EMAIL");
    expect(blob).toContain("invalid_format");
    expect(blob).not.toContain("not-an-email-value");
    expect(blob).not.toMatch(/@mastertouch|eyJ|sk-/i);
  });
});

describe("resend env contract", () => {
  it("rejects resend without key, from, or public https app URL and does not echo secrets", () => {
    const parsed = parseServerEnvRecord({
      ...validBase,
      NOTIFICATION_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_xxxxxxxx",
      NOTIFICATION_EMAIL_FROM: "Master Touch OS <noreply@notify.example.com>",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = serverEnvIssueDiagnostics(parsed.error);
    expect(issues.some((row) => row.name === "NEXT_PUBLIC_APP_URL")).toBe(true);
    expect(JSON.stringify(issues)).not.toMatch(/re_test|noreply@notify/i);
  });

  it("accepts complete resend configuration with public https URL", () => {
    const parsed = parseServerEnvRecord({
      ...validBase,
      NEXT_PUBLIC_APP_URL: "https://app.mastertouch-ksa.com",
      NOTIFICATION_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_xxxxxxxx",
      NOTIFICATION_EMAIL_FROM: "Master Touch OS <noreply@notify.example.com>",
    });
    expect(parsed.success).toBe(true);
  });
});
