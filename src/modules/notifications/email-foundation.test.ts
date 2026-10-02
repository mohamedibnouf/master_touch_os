import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { planDeliveryChannels } from "./policy";
import { emailAudienceFor } from "./event-compat";
import { NotificationOrchestrator } from "./orchestrator";
import { MemoryHubStore } from "./memory-store";
import {
  MockEmailProvider,
  MockPushProvider,
  MockWhatsAppProvider,
  ResendEmailProvider,
} from "./providers";
import { isPermanentProviderError, MAX_DELIVERY_ATTEMPTS, nextRetryAt } from "./schedule";
import { escapeHtml } from "./html";
import { buildNotificationEmailHref, resolveEmailAppBaseUrl } from "./app-url";
import { renderOperationalEmail } from "./email-render";
import { isNotificationsCronAuthorized, notificationsCronSecret } from "./cron-auth";
import { safeNotificationHref } from "./safety";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const ENTITY = "44444444-4444-4444-8444-444444444444";

function orch(store: MemoryHubStore, email = new MockEmailProvider(), base = "https://app.mastertouch-ksa.com") {
  return new NotificationOrchestrator(store, email, new MockWhatsAppProvider(), new MockPushProvider(), base);
}

function approvalEvent() {
  return {
    organizationId: ORG,
    eventType: "APPROVAL_ASSIGNED" as const,
    entityType: "approval_request",
    entityId: ENTITY,
    recipientIds: [USER_A],
    title: "طلب موافقة",
    body: "مطلوب إجراء موافقة",
    href: "/approvals",
    priority: "high" as const,
    occurredAt: new Date().toISOString(),
    deduplicationKey: `approval-assigned:${ENTITY}:${USER_A}`,
  };
}

describe("email eligibility matrix", () => {
  it("classifies personal, management, and no-email types", () => {
    expect(emailAudienceFor("approval.required")).toBe("personal");
    expect(emailAudienceFor("leave_request.approved")).toBe("personal");
    expect(emailAudienceFor("payroll.locked")).toBe("personal");
    expect(emailAudienceFor("ESCALATION_CREATED")).toBe("management");
    expect(emailAudienceFor("ncr.critical")).toBe("management");
    expect(emailAudienceFor("APPROVAL_REMINDER")).toBe("none");
    expect(emailAudienceFor("attendance.adjusted")).toBe("none");
    expect(emailAudienceFor("MANAGEMENT_DIGEST")).toBe("none");
  });
});

describe("channel selection vs preferences", () => {
  it("queues email when approval preference default/on", () => {
    const channels = planDeliveryChannels({
      type: "approval.required",
      recipientId: USER_A,
      preferences: [],
      personalEmailAllowed: true,
      emailAvailable: true,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toContain("in_app");
    expect(channels).toContain("email");
  });

  it("does not queue email when preference disabled", () => {
    const channels = planDeliveryChannels({
      type: "approval.required",
      recipientId: USER_A,
      preferences: [{ profileId: USER_A, category: "APPROVALS", channel: "email", enabled: false }],
      personalEmailAllowed: true,
      emailAvailable: true,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toContain("in_app");
    expect(channels).not.toContain("email");
  });

  it("keeps mandatory in-app for payroll and skips email without preference", () => {
    const channels = planDeliveryChannels({
      type: "payroll.locked",
      recipientId: USER_A,
      preferences: [],
      personalEmailAllowed: true,
      emailAvailable: true,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toEqual(["in_app"]);
  });

  it("queues management email independently of personal preference", () => {
    const channels = planDeliveryChannels({
      type: "ESCALATION_CREATED",
      recipientId: USER_A,
      preferences: [{ profileId: USER_A, category: "APPROVALS", channel: "email", enabled: false }],
      personalEmailAllowed: false,
      emailAvailable: true,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toContain("in_app");
    expect(channels).toContain("email");
  });

  it("does not queue personal email for inactive recipients", () => {
    const channels = planDeliveryChannels({
      type: "approval.required",
      recipientId: USER_A,
      preferences: [],
      personalEmailAllowed: false,
      emailAvailable: true,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toContain("in_app");
    expect(channels).not.toContain("email");
  });

  it("provider none + email preference enabled does not enqueue email", () => {
    const channels = planDeliveryChannels({
      type: "approval.required",
      recipientId: USER_A,
      preferences: [],
      personalEmailAllowed: true,
      emailAvailable: false,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toEqual(["in_app"]);
  });

  it("management email also respects provider-none gate", () => {
    const channels = planDeliveryChannels({
      type: "ESCALATION_CREATED",
      recipientId: USER_A,
      preferences: [],
      personalEmailAllowed: true,
      emailAvailable: false,
      pushAvailable: false,
      whatsappAvailable: false,
    });
    expect(channels).toContain("in_app");
    expect(channels).not.toContain("email");
  });
});

describe("delivery outcomes", () => {
  it("persists provider_message_id on success", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, { email: "user@test.local", phone: null, name: "A" });
    const email = new MockEmailProvider();
    const o = orch(store, email);
    await o.emit(approvalEvent());
    const row = store.deliveries.find((d) => d.channel === "email")!;
    const outcome = await o.processDelivery(row);
    expect(outcome.status).toBe("sent");
    expect(outcome.providerMessageId).toMatch(/^mock-email-/);
    expect(store.deliveries.find((d) => d.id === row.id)?.providerMessageId).toMatch(/^mock-email-/);
  });

  it("cancels when personal email is missing", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, { email: null, phone: null, name: "A" });
    const o = orch(store);
    await o.emit(approvalEvent());
    const row = store.deliveries.find((d) => d.channel === "email")!;
    const outcome = await o.processDelivery(row);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.lastErrorCode).toBe("missing_email");
  });

  it("cancels management email when destination is missing", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    const o = orch(store);
    await o.emit({
      ...approvalEvent(),
      eventType: "ESCALATION_CREATED",
      deduplicationKey: `esc:${ENTITY}`,
    });
    const row = store.deliveries.find((d) => d.channel === "email")!;
    const outcome = await o.processDelivery(row);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.lastErrorCode).toBe("missing_management_destination");
  });

  it("sends management email to org destination not the actor", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, { email: "actor@test.local", phone: null, name: "A" });
    store.managementEmail.set(ORG, "ops@notify.example.com");
    const email = new MockEmailProvider();
    const o = orch(store, email);
    await o.emit({
      ...approvalEvent(),
      eventType: "ESCALATION_CREATED",
      deduplicationKey: `esc:${ENTITY}`,
    });
    const row = store.deliveries.find((d) => d.channel === "email")!;
    await o.processDelivery(row);
    expect(email.sent[0]?.to).toBe("ops@notify.example.com");
  });

  it("does not create a second email row on retry", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, { email: "user@test.local", phone: null, name: "A" });
    const email = new MockEmailProvider();
    email.failNext = true;
    const o = orch(store, email);
    await o.emit(approvalEvent());
    await o.emit(approvalEvent());
    expect(store.deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
    const row = store.deliveries.find((d) => d.channel === "email")!;
    await o.processDelivery(row);
    await o.processDelivery({ ...row, attemptCount: 2 });
    expect(store.deliveries.filter((d) => d.channel === "email")).toHaveLength(1);
  });

  it("classifies 401/403 terminal and 429/5xx/timeout retryable", async () => {
    expect(isPermanentProviderError("auth")).toBe(true);
    expect(isPermanentProviderError("http_429")).toBe(false);
    expect(isPermanentProviderError("http_500")).toBe(false);
    expect(isPermanentProviderError("timeout")).toBe(false);
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, { email: "user@test.local", phone: null, name: "A" });
    const email = new MockEmailProvider();
    email.nextError = { ok: false, code: "auth", retry: false };
    const o = orch(store, email);
    await o.emit(approvalEvent());
    const row = store.deliveries.find((d) => d.channel === "email")!;
    const authOut = await o.processDelivery(row);
    expect(authOut.status).toBe("failed");
    expect(authOut.lastErrorCode).toBe("auth");
    expect(nextRetryAt(MAX_DELIVERY_ATTEMPTS)).toBeNull();
    const cap = await o.processDelivery({ ...row, attemptCount: MAX_DELIVERY_ATTEMPTS + 1 });
    expect(cap.status).toBe("cancelled");
    expect(cap.lastErrorCode).toBe("max_attempts");
  });

  it("preserves adapter error codes instead of collapsing to transient", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, { email: "user@test.local", phone: null, name: "A" });
    const email = new MockEmailProvider();
    email.nextError = { ok: false, code: "http_429", retry: true };
    const o = orch(store, email);
    await o.emit(approvalEvent());
    const row = store.deliveries.find((d) => d.channel === "email")!;
    const out = await o.processDelivery(row);
    expect(out.lastErrorCode).toBe("http_429");
    expect(store.deliveries.find((d) => d.channel === "email")?.lastErrorCode).toBe("http_429");
  });
});

describe("html, urls, reply-to, resend config", () => {
  it("escapes user-controlled HTML", () => {
    const raw = `<script>alert(1)</script> & "quotes"`;
    const escaped = escapeHtml(raw);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&amp;");
    expect(escaped).toContain("&quot;");
    const rendered = renderOperationalEmail({
      title: raw,
      body: raw,
      href: "https://app.mastertouch-ksa.com/approvals",
    });
    expect(rendered.html).not.toContain("<script>alert");
    expect(rendered.html).toContain("&lt;script&gt;");
  });

  it("rejects localhost for production https requirement and builds deep links", () => {
    expect(resolveEmailAppBaseUrl("http://localhost:3000", { requirePublicHttps: true }).ok).toBe(false);
    expect(resolveEmailAppBaseUrl("https://app.mastertouch-ksa.com", { requirePublicHttps: true }).ok).toBe(true);
    const base = new URL("https://app.mastertouch-ksa.com");
    expect(buildNotificationEmailHref(base, "/approvals")).toBe("https://app.mastertouch-ksa.com/approvals");
    expect(buildNotificationEmailHref(base, "https://evil.test")).toBe("https://app.mastertouch-ksa.com/");
    expect(safeNotificationHref("//evil")).toBeNull();
  });

  it("maps reply_to and stays disabled without config", async () => {
    const disabled = new ResendEmailProvider("", "");
    expect(disabled.enabled).toBe(false);
    expect(await disabled.send({ to: "a@b.c", subject: "s", text: "t" })).toEqual({
      ok: false,
      code: "disabled",
      retry: false,
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.NOTIFICATION_EMAIL_REPLY_TO = "ops@notify.example.com";
    const provider = new ResendEmailProvider("re_test_xxxxxxxx", "Master Touch OS <noreply@notify.example.com>");
    const result = await provider.send({
      to: "user@test.local",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
      replyTo: process.env.NOTIFICATION_EMAIL_REPLY_TO,
    });
    expect(result.ok).toBe(true);
    const rawBody = (fetchMock.mock.calls as unknown as Array<[string, { body?: string }]>)[0]?.[1]?.body;
    const body = JSON.parse(String(rawBody));
    expect(body.reply_to).toBe("ops@notify.example.com");
    expect(body.from).toContain("noreply@notify.example.com");
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_EMAIL_REPLY_TO;
  });

  it("classifies abort as timeout retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const err = new Error("aborted");
        err.name = "AbortError";
        if (init?.signal?.aborted) throw err;
        await new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(err));
        });
        return new Response("{}", { status: 200 });
      }),
    );
    const provider = new ResendEmailProvider("re_test_xxxxxxxx", "noreply@notify.example.com", 20);
    const result = await provider.send({ to: "user@test.local", subject: "s", text: "t" });
    expect(result).toEqual({ ok: false, code: "timeout", retry: true });
    vi.unstubAllGlobals();
  });
});

describe("cron secret and source hygiene", () => {
  it("accepts Vercel CRON_SECRET bearer and does not log secrets", () => {
    const prevA = process.env.NOTIFICATIONS_CRON_SECRET;
    const prevB = process.env.CRON_SECRET;
    delete process.env.NOTIFICATIONS_CRON_SECRET;
    process.env.CRON_SECRET = "vercel-cron-secret-ok";
    expect(notificationsCronSecret()).toBe("vercel-cron-secret-ok");
    expect(isNotificationsCronAuthorized("Bearer vercel-cron-secret-ok")).toBe(true);
    expect(isNotificationsCronAuthorized("Bearer wrong-secret-value")).toBe(false);
    if (prevA === undefined) delete process.env.NOTIFICATIONS_CRON_SECRET;
    else process.env.NOTIFICATIONS_CRON_SECRET = prevA;
    if (prevB === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevB;
  });

  it("does not hardcode info@ as sender or destination in notification modules", () => {
    const dir = join(process.cwd(), "src", "modules", "notifications");
    const files = [
      "providers.ts",
      "orchestrator.ts",
      "event-compat.ts",
      "email-render.ts",
      "policy.ts",
    ];
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text.toLowerCase()).not.toContain("info@mastertouch-ksa.com");
    }
  });
});
