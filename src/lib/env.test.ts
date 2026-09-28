import { describe, expect, it } from "vitest";
import {
  GET_SERVER_ENV_KEYS,
  parseServerEnvRecord,
  readServerEnvRecordFromProcess,
  serverEnvIssueDiagnostics,
} from "@/lib/env";

const validBase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_anon_key_value",
};

describe("getServerEnv parse keys vs Vercel-visible names", () => {
  it("does not parse CRON_SECRET, LIVE_TEST_ENABLED, or LIVE_TEST_PASSWORD_PREFIX", () => {
    expect(GET_SERVER_ENV_KEYS).not.toContain("CRON_SECRET");
    expect(GET_SERVER_ENV_KEYS).not.toContain("LIVE_TEST_ENABLED");
    expect(GET_SERVER_ENV_KEYS).not.toContain("LIVE_TEST_PASSWORD_PREFIX");
    expect(Object.keys(readServerEnvRecordFromProcess())).not.toContain("CRON_SECRET");
    expect(Object.keys(readServerEnvRecordFromProcess())).not.toContain("LIVE_TEST_ENABLED");
    expect(Object.keys(readServerEnvRecordFromProcess())).not.toContain("LIVE_TEST_PASSWORD_PREFIX");
  });

  it("does parse the visible keys that can fail serverSchema", () => {
    expect(GET_SERVER_ENV_KEYS).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_APP_URL",
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
