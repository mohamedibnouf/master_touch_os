import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planDeliveryChannels } from "./policy";
import { NotificationOrchestrator } from "./orchestrator";
import { MemoryHubStore } from "./memory-store";
import { DisabledWhatsAppProvider, MockEmailProvider, MockPushProvider, MockWhatsAppProvider } from "./providers";
import { whatsappAudienceFor } from "./whatsapp-policy";
import {
  assertWhatsAppTemplatePrivacy,
  buildWhatsAppParameters,
  WHATSAPP_TEMPLATE_PARAMETER_KEYS,
  whatsappTemplateIdForEvent,
} from "./whatsapp-templates";
import { resolveManagementWhatsAppE164, resolvePersonalWhatsAppE164 } from "./whatsapp-recipients";
import {
  authorizeManagementWhatsappChange,
  managementWhatsappAuditPayload,
  parseManagementNotificationWhatsapp,
} from "./management-whatsapp";
import { safeNotificationHref } from "./safety";
import { FUTURE_WHATSAPP_WEBHOOK_PATH } from "./whatsapp-policy";
import { ROLE_PERMISSION_MAP } from "@/lib/permissions/catalog";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const ENTITY = "44444444-4444-4444-8444-444444444444";
const SQL_PATH = join(process.cwd(), "supabase", "migrations", "072_whatsapp_foundation.sql");

function workEvent() {
  return {
    organizationId: ORG,
    eventType: "WORK_ASSIGNED" as const,
    entityType: "task",
    entityId: ENTITY,
    recipientIds: [USER_A],
    title: "مهمة جديدة",
    body: "راجع المهمة داخل النظام.",
    href: "/work",
    priority: "high" as const,
    occurredAt: new Date().toISOString(),
    deduplicationKey: `work:${ENTITY}:${USER_A}`,
  };
}

describe("072 WhatsApp foundation migration contract", () => {
  const sql = readFileSync(SQL_PATH, "utf8");

  it("is additive with default opt-in false and no phone backfill", () => {
    expect(sql).toContain("whatsapp_opt_in boolean not null default false");
    expect(sql).toContain("add column if not exists management_notification_whatsapp");
    expect(sql).toContain("management_notification_whatsapp is null");
    expect(sql).not.toMatch(/update public\.profiles\s+set/i);
    expect(sql).not.toMatch(/update public\.organizations\s+set/i);
    expect(sql).not.toMatch(/\bdelete\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).toContain("has_permission('settings.manage', new.id)");
    expect(sql).toContain("document_lifecycle_trusted_session()");
    expect(sql).toContain("revoke all on function public.protect_management_notification_whatsapp()");
    expect(sql.toLowerCase()).not.toContain("graph.facebook");
    expect(sql.toLowerCase()).not.toContain("access_token");
  });

  it("reports sha256 of the migration file", () => {
    const hash = createHash("sha256").update(sql, "utf8").digest("hex");
    expect(hash).toHaveLength(64);
  });
});

describe("WhatsApp allowlist and PAYROLL exclusion", () => {
  it("allowlists action and alert events the app emits", () => {
    expect(whatsappAudienceFor("WORK_ASSIGNED")).toBe("personal");
    expect(whatsappAudienceFor("approval.created")).toBe("personal");
    expect(whatsappAudienceFor("APPROVAL_ASSIGNED")).toBe("personal");
    expect(whatsappAudienceFor("RISK_CRITICAL")).toBe("management");
    expect(whatsappAudienceFor("ncr.critical")).toBe("management");
    expect(whatsappAudienceFor("ESCALATION_CREATED")).toBe("management");
  });

  it("excludes overdue scan spam, payroll, attendance, digest, and reminders", () => {
    expect(whatsappAudienceFor("PROJECT_OVERDUE")).toBe("none");
    expect(whatsappAudienceFor("MANAGEMENT_DIGEST")).toBe("none");
    expect(whatsappAudienceFor("APPROVAL_REMINDER")).toBe("none");
    expect(whatsappAudienceFor("payroll.locked")).toBe("none");
    expect(whatsappAudienceFor("PAYROLL_REVIEW_REQUIRED")).toBe("none");
    expect(whatsappAudienceFor("attendance.checked_in")).toBe("none");
  });

  it("never queues WhatsApp for PAYROLL even with mock provider, opt-in, phone, and preference", () => {
    const channels = planDeliveryChannels({
      type: "payroll.locked",
      recipientId: USER_A,
      preferences: [{ profileId: USER_A, category: "PAYROLL", channel: "whatsapp", enabled: true }],
      personalEmailAllowed: true,
      personalWhatsAppAllowed: true,
      emailAvailable: true,
      pushAvailable: false,
      whatsappAvailable: true,
    });
    expect(channels).not.toContain("whatsapp");
  });

  it("category preference alone does not authorize personal WhatsApp", () => {
    const channels = planDeliveryChannels({
      type: "WORK_ASSIGNED",
      recipientId: USER_A,
      preferences: [{ profileId: USER_A, category: "WORK", channel: "whatsapp", enabled: true }],
      personalEmailAllowed: true,
      personalWhatsAppAllowed: false,
      emailAvailable: false,
      pushAvailable: false,
      whatsappAvailable: true,
    });
    expect(channels).not.toContain("whatsapp");
  });

  it("provider disabled never queues WhatsApp", () => {
    const channels = planDeliveryChannels({
      type: "WORK_ASSIGNED",
      recipientId: USER_A,
      preferences: [{ profileId: USER_A, category: "WORK", channel: "whatsapp", enabled: true }],
      personalEmailAllowed: true,
      personalWhatsAppAllowed: true,
      emailAvailable: false,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).not.toContain("whatsapp");
  });

  it("queues personal WhatsApp when provider, allowlist, opt-in, phone, and category preference align", () => {
    const channels = planDeliveryChannels({
      type: "WORK_ASSIGNED",
      recipientId: USER_A,
      preferences: [{ profileId: USER_A, category: "WORK", channel: "whatsapp", enabled: true }],
      personalEmailAllowed: true,
      personalWhatsAppAllowed: true,
      emailAvailable: false,
      pushAvailable: false,
      whatsappAvailable: true,
    });
    expect(channels).toContain("whatsapp");
  });

  it("does not queue WhatsApp for non-allowlisted personal events", () => {
    const channels = planDeliveryChannels({
      type: "leave_request.approved",
      recipientId: USER_A,
      preferences: [{ profileId: USER_A, category: "HR", channel: "whatsapp", enabled: true }],
      personalEmailAllowed: true,
      personalWhatsAppAllowed: true,
      emailAvailable: false,
      pushAvailable: false,
      whatsappAvailable: true,
    });
    expect(channels).not.toContain("whatsapp");
  });
});

describe("recipient resolution", () => {
  it("requires opt-in for personal destination and never infers management from personal", () => {
    expect(resolvePersonalWhatsAppE164({ phone: "+966501234567", optIn: false })).toBeNull();
    expect(resolvePersonalWhatsAppE164({ phone: "+966501234567", optIn: true })).toBe("+966501234567");
    expect(resolveManagementWhatsAppE164(null)).toBeNull();
    expect(resolveManagementWhatsAppE164("+966501111111")).toBe("+966501111111");
  });
});

describe("management WhatsApp authorization and audit privacy", () => {
  it("normalizes management destination and rejects invalid input without treating it as clear", () => {
    expect(parseManagementNotificationWhatsapp("")).toEqual({ ok: true, value: null });
    expect(parseManagementNotificationWhatsapp("0501234567")).toEqual({ ok: true, value: "+966501234567" });
    expect(parseManagementNotificationWhatsapp("not-a-phone").ok).toBe(false);
  });

  it("authorizes settings.manage and denies others", () => {
    expect(
      authorizeManagementWhatsappChange({
        trustedSession: false,
        authUid: "user-a",
        hasSettingsManageOnTargetOrg: true,
        previous: null,
        next: "+966501234567",
      }),
    ).toBe("allow");
    expect(
      authorizeManagementWhatsappChange({
        trustedSession: false,
        authUid: "user-a",
        hasSettingsManageOnTargetOrg: false,
        previous: null,
        next: "+966501234567",
      }),
    ).toBe("deny");
    expect(ROLE_PERMISSION_MAP.employee).not.toContain("settings.manage");
  });

  it("audits set true/false without storing numbers", () => {
    const payload = managementWhatsappAuditPayload(null, "+966501234567");
    expect(payload).toEqual({ previousValues: { set: false }, newValues: { set: true } });
    expect(JSON.stringify(payload)).not.toContain("966");
  });
});

describe("templates, safe links, mock send", () => {
  it("maps events to internal templates without sensitive variables", () => {
    expect(whatsappTemplateIdForEvent("WORK_ASSIGNED")).toBe("master_touch_action_required");
    expect(whatsappTemplateIdForEvent("RISK_CRITICAL")).toBe("master_touch_alert");
    expect(WHATSAPP_TEMPLATE_PARAMETER_KEYS).toEqual(["title", "context", "href"]);
    expect(assertWhatsAppTemplatePrivacy()).toBeUndefined();
  });

  it("builds links from app origin and safe paths only", () => {
    expect(safeNotificationHref("https://evil.example")).toBeNull();
    expect(safeNotificationHref("javascript:alert(1)")).toBeNull();
    expect(safeNotificationHref("//evil.example")).toBeNull();
    const params = buildWhatsAppParameters({
      title: "تنبيه",
      body: "سياق قصير",
      href: "/approvals",
      appBaseUrl: "https://app.mastertouch-ksa.com",
    });
    expect(params.href).toBe("https://app.mastertouch-ksa.com/approvals");
  });

  it("sends mock WhatsApp to personal E.164 when eligible and never uses Graph", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.preferences = [{ profileId: USER_A, category: "WORK", channel: "whatsapp", enabled: true }];
    store.contacts.set(USER_A, {
      email: null,
      phone: "+966501234567",
      name: "A",
      whatsappOptIn: true,
    });
    const wa = new MockWhatsAppProvider();
    const orch = new NotificationOrchestrator(
      store,
      new MockEmailProvider(),
      wa,
      new MockPushProvider(),
      "https://app.mastertouch-ksa.com",
    );
    await orch.emit(workEvent());
    const row = store.deliveries.find((d) => d.channel === "whatsapp")!;
    const outcome = await orch.processDelivery(row);
    expect(outcome.status).toBe("sent");
    expect(wa.sent[0]?.toE164).toBe("+966501234567");
    expect(wa.sent[0]?.templateId).toBe("master_touch_action_required");
    expect(JSON.stringify(wa.sent[0])).not.toMatch(/salary|iban|iqama/i);
  });

  it("sends management WhatsApp to org destination not the actor phone", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, {
      email: null,
      phone: "+966509999999",
      name: "A",
      whatsappOptIn: true,
    });
    store.managementWhatsApp.set(ORG, "+966501111111");
    const wa = new MockWhatsAppProvider();
    const orch = new NotificationOrchestrator(
      store,
      new MockEmailProvider(),
      wa,
      new MockPushProvider(),
      "https://app.mastertouch-ksa.com",
    );
    await orch.emit({
      ...workEvent(),
      eventType: "RISK_CRITICAL",
      deduplicationKey: `risk:${ENTITY}`,
    });
    const row = store.deliveries.find((d) => d.channel === "whatsapp")!;
    await orch.processDelivery(row);
    expect(wa.sent[0]?.toE164).toBe("+966501111111");
    expect(wa.sent[0]?.toE164).not.toBe("+966509999999");
  });

  it("cancels WhatsApp when the disabled provider is used at send time", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.deliveries = [
      {
        id: "d-1",
        notificationId: "n-1",
        organizationId: ORG,
        recipientId: USER_A,
        channel: "whatsapp",
        status: "pending",
        attemptCount: 1,
      },
    ];
    store.notifications = [
      {
        id: "n-1",
        organizationId: ORG,
        recipientId: USER_A,
        eventType: "WORK_ASSIGNED",
        dedupKey: "x",
        title: "t",
        body: "b",
        href: "/work",
        created: true,
      },
    ];
    store.contacts.set(USER_A, { email: null, phone: "+966501234567", name: "A", whatsappOptIn: true });
    const orch = new NotificationOrchestrator(
      store,
      new MockEmailProvider(),
      new DisabledWhatsAppProvider(),
      new MockPushProvider(),
      "https://app.mastertouch-ksa.com",
    );
    const outcome = await orch.processDelivery(store.deliveries[0]);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.lastErrorCode).toBe("disabled");
  });

  it("documents webhook path without implementing a live route", () => {
    expect(FUTURE_WHATSAPP_WEBHOOK_PATH).toBe("/api/internal/whatsapp/webhook");
  });
});
