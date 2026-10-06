import { describe, expect, it } from "vitest";
import { notificationEventSchema } from "./catalog";
import { NotificationOrchestrator } from "./orchestrator";
import { MemoryHubStore } from "./memory-store";
import { MockEmailProvider, MockPushProvider, MockWhatsAppProvider, DisabledEmailProvider } from "./providers";
import { resolveActiveRecipients, selectChannels, canDisablePreference } from "./policy";
import { validatePushSubscription, redactNotificationText, safeNotificationHref, assertNoSensitivePayload } from "./safety";
import { buildApprovalReminderEvents } from "./scan";
import { nextRetryAt, reminderWindowReached, overdueReached, approachingDate, MAX_DELIVERY_ATTEMPTS } from "./schedule";
import { buildDeterministicDigest, maybeAiDigestSummary, formatPerformanceFacts } from "./digest";
import { isNotificationsCronAuthorized, notificationsCronSecret } from "./cron-auth";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ENTITY = "44444444-4444-4444-8444-444444444444";

function sampleEvent(over: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    eventType: "APPROVAL_ASSIGNED",
    entityType: "approval_request",
    entityId: ENTITY,
    recipientIds: [USER_A],
    title: "طلب موافقة",
    body: "مطلوب إجراء موافقة",
    href: "/approvals",
    priority: "high",
    occurredAt: new Date().toISOString(),
    deduplicationKey: `approval-assigned:${ENTITY}:${USER_A}`,
    ...over,
  };
}

function hub(store: MemoryHubStore, email = new MockEmailProvider()) {
  return new NotificationOrchestrator(store, email, new MockWhatsAppProvider(), new MockPushProvider(), "https://app.mastertouch.test");
}

describe("event validation", () => {
  it("accepts a well-formed event and rejects missing org", () => {
    expect(notificationEventSchema.safeParse(sampleEvent()).success).toBe(true);
    expect(notificationEventSchema.safeParse(sampleEvent({ organizationId: "nope" })).success).toBe(false);
  });
});

describe("recipient resolution", () => {
  it("drops cross-org and inactive members", () => {
    const ids = resolveActiveRecipients({
      organizationId: ORG,
      proposedIds: [USER_A, USER_B],
      members: [
        { profileId: USER_A, organizationId: ORG, status: "active", isActive: true },
        { profileId: USER_B, organizationId: "55555555-5555-5555-5555-555555555555", status: "active", isActive: true },
      ],
    });
    expect(ids).toEqual([USER_A]);
  });
});

describe("orchestrator", () => {
  it("deduplicates the same operational event", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    const o = hub(store);
    await o.emit(sampleEvent());
    await o.emit(sampleEvent());
    expect(store.notifications).toHaveLength(1);
  });

  it("does not deliver when provider is disabled", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    const email = new DisabledEmailProvider();
    const o = new NotificationOrchestrator(store, email, new MockWhatsAppProvider(), new MockPushProvider(), "https://x");
    await o.emit(sampleEvent());
    const mail = store.deliveries.find((d) => d.channel === "email");
    expect(mail).toBeUndefined();
    expect(store.deliveries.some((d) => d.channel === "in_app")).toBe(true);
  });

  it("retries transient email failure without duplicating the in-app row", async () => {
    const store = new MemoryHubStore();
    store.members = [{ profileId: USER_A, organizationId: ORG, status: "active", isActive: true }];
    store.contacts.set(USER_A, { email: "a@test.local", phone: null, name: "A" });
    const email = new MockEmailProvider();
    email.failNext = true;
    const o = hub(store, email);
    await o.emit(sampleEvent());
    const delivery = store.deliveries.find((d) => d.channel === "email");
    expect(delivery).toBeTruthy();
    const first = await o.processDelivery(delivery!);
    expect(first.status).toBe("failed");
    expect(store.notifications).toHaveLength(1);
    const second = await o.processDelivery({ ...delivery!, attemptCount: 2, status: "failed" });
    expect(second.status).toBe("sent");
    expect(email.sent).toHaveLength(1);
  });
});

describe("preferences and channels", () => {
  it("I. mandatory in-app survives preference absence", () => {
    for (const category of ["WORK", "APPROVALS", "PAYROLL"] as const) {
      expect(
        selectChannels({
          category,
          preferences: [],
          recipientId: USER_A,
          pushAvailable: false,
          emailAvailable: false,
          whatsappAvailable: false,
        }),
      ).toEqual(["in_app"]);
    }
  });

  it("J. mandatory in-app survives preference deletion (enabled false)", () => {
    expect(
      selectChannels({
        category: "WORK",
        preferences: [{ profileId: USER_A, category: "WORK", channel: "in_app", enabled: false }],
        recipientId: USER_A,
        pushAvailable: false,
        emailAvailable: false,
        whatsappAvailable: false,
      }),
    ).toContain("in_app");
  });

  it("keeps mandatory in-app and respects optional WhatsApp off by default", () => {
    const channels = selectChannels({
      category: "APPROVALS",
      preferences: [],
      recipientId: USER_A,
      pushAvailable: true,
      emailAvailable: true,
      whatsappAvailable: true,
    });
    expect(channels).toContain("in_app");
    expect(channels).toContain("email");
    expect(channels).not.toContain("whatsapp");
    expect(canDisablePreference("APPROVALS", "in_app", false)).toBe(false);
  });

  it("strips push/whatsapp from payroll category", () => {
    const channels = selectChannels({
      category: "PAYROLL",
      preferences: [
        { profileId: USER_A, category: "PAYROLL", channel: "push", enabled: true },
        { profileId: USER_A, category: "PAYROLL", channel: "whatsapp", enabled: true },
        { profileId: USER_A, category: "PAYROLL", channel: "email", enabled: true },
      ],
      recipientId: USER_A,
      pushAvailable: true,
      emailAvailable: true,
      whatsappAvailable: true,
    });
    expect(channels).toEqual(["in_app", "email"]);
  });
});

describe("redaction and href", () => {
  it("redacts amounts and long numbers", () => {
    expect(redactNotificationText("صافي 12000 SAR IBAN SA123")).toMatch(/redacted|withheld/i);
  });
  it("rejects unsafe hrefs", () => {
    expect(safeNotificationHref("https://evil.test")).toBeNull();
    expect(safeNotificationHref("//evil.test")).toBeNull();
    expect(safeNotificationHref("/approvals")).toBe("/approvals");
    expect(safeNotificationHref("/projects/x?tab=stages")).toBe("/projects/x?tab=stages");
    expect(safeNotificationHref("javascript:alert(1)")).toBeNull();
  });
  it("validates push subscriptions", () => {
    expect(() => validatePushSubscription({ endpoint: "http://x", keys: { p256dh: "12345678", auth: "12345678" } })).toThrow();
    expect(
      validatePushSubscription({
        endpoint: "https://push.example/sub",
        keys: { p256dh: "abcdefgh", auth: "ijklmnop" },
      }).endpoint,
    ).toBe("https://push.example/sub");
  });
  it("rejects sensitive metadata", () => {
    expect(() => assertNoSensitivePayload({ net_pay: 1 })).toThrow();
  });
});

describe("retry reminder escalation windows", () => {
  it("caps retries and computes backoff", () => {
    expect(nextRetryAt(MAX_DELIVERY_ATTEMPTS)).toBeNull();
    expect(nextRetryAt(1)?.getTime()).toBeGreaterThan(Date.now());
  });
  it("reminder and overdue are date-authoritative", () => {
    const due = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(reminderWindowReached(due, new Date(), 24)).toBe(true);
    expect(overdueReached(due)).toBe(false);
    expect(approachingDate("2026-09-28", "2026-09-25", 7)).toBe(true);
    expect(approachingDate("2026-10-20", "2026-09-25", 7)).toBe(false);
  });
});

describe("digest and performance", () => {
  it("builds deterministic digest and falls back when AI throws", async () => {
    const facts = {
      asOfDate: "2026-09-25",
      overdueApprovals: 2,
      projectsNeedingAttention: 1,
      highRisks: 3,
      criticalRisks: 1,
      payrollUnderReview: 0,
      attendanceExceptions: 4,
      attentionTitles: ["مشروع متأخر"],
    };
    expect(buildDeterministicDigest(facts)).toContain("موافقات متأخرة: 2");
    const fallback = await maybeAiDigestSummary(facts, async () => {
      throw new Error("down");
    });
    expect(fallback.source).toBe("deterministic");
  });

  it("formats measurable approval facts without scores", () => {
    const text = formatPerformanceFacts([
      { profileId: USER_A, displayName: "أحمد", assignedApprovals: 4, completedApprovals: 2, overdueApprovals: 1 },
    ]);
    expect(text).toContain("مسند 4");
    expect(text.toLowerCase()).not.toContain("score");
  });
});

describe("mock multi-channel pipeline", () => {
  it("in_app delivered + external mock send without salary/IBAN", async () => {
    const store = new MemoryHubStore();
    store.members = [
      {
        profileId: USER_A,
        organizationId: ORG,
        status: "active",
        isActive: true,
      },
    ];
    store.preferences = [
      { profileId: USER_A, category: "WORK", channel: "whatsapp", enabled: true },
      { profileId: USER_A, category: "WORK", channel: "push", enabled: true },
    ];
    store.contacts.set(USER_A, { email: "a@test.local", phone: "+966500000000", name: "A" });
    store.push.set(`${ORG}:${USER_A}`, [{ endpoint: "https://push.example/a" }]);
    const email = new MockEmailProvider();
    const wa = new MockWhatsAppProvider();
    const push = new MockPushProvider();
    const orch = new NotificationOrchestrator(store, email, wa, push, "https://app.mastertouch.test");
    const validated = orch.validate(
      sampleEvent({
        eventType: "WORK_ASSIGNED",
        title: "تنبيه عمل",
        body: "راجع المهمة داخل النظام.",
        metadata: { kind: "work" },
      }),
    );
    expect(validated.body).not.toMatch(/iban|راتب|salary/i);
    const emitted = await orch.emit(
      sampleEvent({
        eventType: "WORK_ASSIGNED",
        title: "تنبيه عمل",
        body: "راجع المهمة داخل النظام.",
      }),
    );
    expect(emitted.notificationIds).toHaveLength(1);
    const emailRow = store.deliveries.find((d) => d.channel === "email")!;
    const sent = await orch.processDelivery(emailRow);
    expect(sent.status).toBe("sent");
    expect(email.sent[0]?.text).not.toMatch(/iban|راتب|\d{8,}/i);
    expect(email.sent[0]?.text).toContain("داخل النظام");
  });
});

describe("cron authorization helper", () => {
  it("rejects missing/short secret and wrong bearer", () => {
    const prevA = process.env.NOTIFICATIONS_CRON_SECRET;
    const prevB = process.env.CRON_SECRET;
    delete process.env.NOTIFICATIONS_CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect(notificationsCronSecret()).toBeNull();
    expect(isNotificationsCronAuthorized("Bearer xxxxxxxxxxxxxxxx")).toBe(false);
    process.env.NOTIFICATIONS_CRON_SECRET = "sixteen-chars-ok";
    expect(isNotificationsCronAuthorized(null)).toBe(false);
    expect(isNotificationsCronAuthorized("Bearer wrong-secret-value")).toBe(false);
    expect(isNotificationsCronAuthorized("Bearer sixteen-chars-ok")).toBe(true);
    if (prevA === undefined) delete process.env.NOTIFICATIONS_CRON_SECRET;
    else process.env.NOTIFICATIONS_CRON_SECRET = prevA;
    if (prevB === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevB;
  });
});

describe("reminder scan", () => {
  it("does not escalate without an authoritative manager", () => {
    const due = new Date(Date.now() - 60_000).toISOString();
    const events = buildApprovalReminderEvents(
      [
        {
          id: ENTITY,
          organizationId: ORG,
          requestId: ENTITY,
          userId: USER_A,
          dueAt: due,
          status: "pending",
          managerProfileId: null,
        },
      ],
      new Date(),
      "2026-09-25",
    );
    expect(events.some((e) => e.eventType === "ESCALATION_CREATED")).toBe(false);
    expect(events.some((e) => e.eventType === "APPROVAL_OVERDUE")).toBe(true);
  });
});
