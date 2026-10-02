import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeManagementEmailChange,
  managementNotificationEmailCheckPasses,
  normalizeManagementNotificationEmail,
} from "./management-email";
import { emailAudienceFor } from "./event-compat";
import { ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";
import { DisabledEmailProvider, MockEmailProvider, ResendEmailProvider } from "./providers";

const SQL_PATH = join(process.cwd(), "supabase", "migrations", "071_organization_management_notification_email.sql");

describe("071 management notification email contract", () => {
  const sql = readFileSync(SQL_PATH, "utf8");

  it("is additive, nullable, no backfill, no login mailbox default", () => {
    expect(sql).toContain("add column if not exists management_notification_email text");
    expect(sql).toContain("management_notification_email is null");
    expect(sql).not.toMatch(/info@mastertouch-ksa\.com/i);
    expect(sql).not.toMatch(/BOOTSTRAP_ADMIN_EMAIL/);
    expect(sql).not.toMatch(/\bdelete\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/update public\.organizations\s+set/i);
    expect(sql).toContain("has_permission('settings.manage', new.id)");
    expect(sql).toContain("document_lifecycle_trusted_session()");
    expect(sql).toContain("revoke all on function public.protect_management_notification_email()");
  });

  it("normalizes and validates emails like the CHECK/trigger", () => {
    expect(normalizeManagementNotificationEmail(null)).toBeNull();
    expect(normalizeManagementNotificationEmail("")).toBeNull();
    expect(normalizeManagementNotificationEmail("   ")).toBeNull();
    expect(normalizeManagementNotificationEmail("  Ops@Notify.Example.COM ")).toBe("ops@notify.example.com");
    expect(managementNotificationEmailCheckPasses(null)).toBe(true);
    expect(managementNotificationEmailCheckPasses("ops@notify.example.com")).toBe(true);
    expect(managementNotificationEmailCheckPasses("user+tag@mail.company.com")).toBe(true);
    expect(managementNotificationEmailCheckPasses("ops@sub.notify.example.com")).toBe(true);
    expect(managementNotificationEmailCheckPasses("no-at-sign")).toBe(false);
    expect(managementNotificationEmailCheckPasses("missing-domain@")).toBe(false);
    expect(managementNotificationEmailCheckPasses("@missing-local.com")).toBe(false);
    expect(managementNotificationEmailCheckPasses("ops@localhost")).toBe(false);
    expect(managementNotificationEmailCheckPasses("ops @notify.example.com")).toBe(false);
  });

  it("authorizes same-org settings.manage and denies others", () => {
    expect(
      authorizeManagementEmailChange({
        trustedSession: false,
        authUid: "user-a",
        hasSettingsManageOnTargetOrg: true,
        previous: null,
        next: "ops@notify.example.com",
      }),
    ).toBe("allow");
    expect(
      authorizeManagementEmailChange({
        trustedSession: false,
        authUid: "user-a",
        hasSettingsManageOnTargetOrg: false,
        previous: null,
        next: "ops@notify.example.com",
      }),
    ).toBe("deny");
    expect(
      authorizeManagementEmailChange({
        trustedSession: false,
        authUid: null,
        hasSettingsManageOnTargetOrg: true,
        previous: null,
        next: "ops@notify.example.com",
      }),
    ).toBe("deny");
    expect(
      authorizeManagementEmailChange({
        trustedSession: false,
        authUid: "user-a",
        hasSettingsManageOnTargetOrg: false,
        previous: "ops@notify.example.com",
        next: "ops@notify.example.com",
      }),
    ).toBe("allow");
    expect(
      authorizeManagementEmailChange({
        trustedSession: true,
        authUid: null,
        hasSettingsManageOnTargetOrg: false,
        previous: null,
        next: "ops@notify.example.com",
      }),
    ).toBe("allow");
  });

  it("does not couple management destination to login identity", () => {
    expect(emailAudienceFor("ESCALATION_CREATED")).toBe("management");
    expect(sql.toLowerCase()).not.toContain("auth.users");
    expect(ROLE_PERMISSION_MAP.general_manager).not.toContain("settings.manage");
    expect(ROLE_PERMISSION_MAP.super_admin).toContain("settings.manage");
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("settings.manage");
    expect(new DisabledEmailProvider().enabled).toBe(false);
    expect(new MockEmailProvider().enabled).toBe(true);
    expect(new ResendEmailProvider("re_test_xxxxxxxx", "Master Touch OS <noreply@notify.example.com>").enabled).toBe(true);
  });

  it("reports sha256 of the migration file", () => {
    const hash = createHash("sha256").update(sql, "utf8").digest("hex");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(createHash("sha256").update(readFileSync(SQL_PATH)).digest("hex"));
  });
});
