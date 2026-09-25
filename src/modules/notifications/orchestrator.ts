import type { NotificationEvent } from "./catalog";
import { EVENT_CATEGORY, notificationEventSchema } from "./catalog";
import type { ActiveMember, PreferenceRow } from "./catalog";
import { resolveActiveRecipients, selectChannels } from "./policy";
import { assertNoSensitivePayload, redactNotificationText, safeNotificationHref } from "./safety";
import type { EmailProvider, PushProvider, WhatsAppProvider } from "./providers";
import { isPermanentProviderError, MAX_DELIVERY_ATTEMPTS, nextRetryAt } from "./schedule";

export type HubNotification = {
  id: string;
  organizationId: string;
  recipientId: string;
  eventType: string;
  dedupKey: string;
  title: string;
  body: string;
  href: string | null;
  created: boolean;
};

export type HubDelivery = {
  id: string;
  notificationId: string;
  organizationId: string;
  recipientId: string;
  channel: "in_app" | "email" | "whatsapp" | "push";
  status: string;
  attemptCount: number;
};

export type HubStore = {
  upsertNotification(input: {
    organizationId: string;
    recipientId: string;
    eventType: string;
    type: string;
    title: string;
    body: string;
    entityType: string;
    entityId: string;
    href: string | null;
    priority: string;
    dedupKey: string;
    channels: Array<"in_app" | "email" | "whatsapp" | "push">;
  }): Promise<HubNotification>;
  listActiveMembers(organizationId: string, profileIds: string[]): Promise<ActiveMember[]>;
  listPreferences(organizationId: string, profileIds: string[]): Promise<PreferenceRow[]>;
  getRecipientContact(profileId: string): Promise<{ email: string | null; phone: string | null; name: string | null }>;
  listPushEndpoints(organizationId: string, profileId: string): Promise<Array<{ endpoint: string }>>;
  markDelivery(
    deliveryId: string,
    patch: { status: string; lastErrorCode?: string | null; providerMessageId?: string | null; nextAttemptAt?: string | null },
  ): Promise<void>;
  listPendingDeliveries(limit: number): Promise<HubDelivery[]>;
  audit(action: string, entityType: string, entityId: string, organizationId: string): Promise<void>;
};

export type OrchestratorResult = {
  notificationIds: string[];
  skipped: string[];
  deliveriesQueued: number;
};

export class NotificationOrchestrator {
  constructor(
    private readonly store: HubStore,
    private readonly email: EmailProvider,
    private readonly whatsapp: WhatsAppProvider,
    private readonly push: PushProvider,
    private readonly appBaseUrl: string,
  ) {}

  validate(raw: unknown): NotificationEvent {
    const parsed = notificationEventSchema.parse(raw);
    assertNoSensitivePayload(parsed.metadata);
    return {
      ...parsed,
      title: redactNotificationText(parsed.title),
      body: redactNotificationText(parsed.body),
      href: safeNotificationHref(parsed.href),
    };
  }

  async emit(raw: unknown): Promise<OrchestratorResult> {
    const event = this.validate(raw);
    const members = await this.store.listActiveMembers(event.organizationId, event.recipientIds);
    const recipients = resolveActiveRecipients({
      organizationId: event.organizationId,
      proposedIds: event.recipientIds,
      members,
    });
    const skipped = event.recipientIds.filter((id) => !recipients.includes(id));
    const prefs = await this.store.listPreferences(event.organizationId, recipients);
    const category = EVENT_CATEGORY[event.eventType];
    const notificationIds: string[] = [];
    let deliveriesQueued = 0;

    for (const recipientId of recipients) {
      const channels = selectChannels({
        category,
        preferences: prefs,
        recipientId,
        pushAvailable: this.push.enabled,
        emailAvailable: this.email.enabled,
        whatsappAvailable: this.whatsapp.enabled,
      });
      const row = await this.store.upsertNotification({
        organizationId: event.organizationId,
        recipientId,
        eventType: event.eventType,
        type: event.eventType,
        title: event.title,
        body: event.body,
        entityType: event.entityType,
        entityId: event.entityId,
        href: event.href ?? null,
        priority: event.priority,
        dedupKey: event.deduplicationKey,
        channels,
      });
      notificationIds.push(row.id);
      if (row.created) {
        await this.store.audit("notification.created", "notification", row.id, event.organizationId);
        deliveriesQueued += channels.length;
      }
    }

    return { notificationIds, skipped, deliveriesQueued };
  }

  async processDelivery(delivery: HubDelivery): Promise<"sent" | "failed" | "cancelled"> {
    if (delivery.attemptCount > MAX_DELIVERY_ATTEMPTS) {
      await this.store.markDelivery(delivery.id, { status: "cancelled", lastErrorCode: "max_attempts" });
      return "cancelled";
    }
    if (delivery.channel === "in_app") {
      await this.store.markDelivery(delivery.id, { status: "delivered" });
      return "sent";
    }

    const contact = await this.store.getRecipientContact(delivery.recipientId);
    let result: { ok: true; providerMessageId?: string } | { ok: false; code: string; retry: boolean };

    if (delivery.channel === "email") {
      if (!this.email.enabled || !contact.email) {
        await this.store.markDelivery(delivery.id, { status: "cancelled", lastErrorCode: "disabled" });
        return "cancelled";
      }
      result = await this.email.send({
        to: contact.email,
        subject: "Master Touch OS",
        text: "يوجد تنبيه تشغيلي يحتاج متابعتك داخل النظام.",
        href: this.appBaseUrl,
      });
    } else if (delivery.channel === "whatsapp") {
      if (!this.whatsapp.enabled || !contact.phone) {
        await this.store.markDelivery(delivery.id, { status: "cancelled", lastErrorCode: "disabled" });
        return "cancelled";
      }
      result = await this.whatsapp.send({
        toE164: contact.phone,
        templateId: "mt_operational_alert",
        parameters: [contact.name ?? ""],
      });
    } else {
      const endpoints = await this.store.listPushEndpoints(delivery.organizationId, delivery.recipientId);
      if (!this.push.enabled || endpoints.length === 0) {
        await this.store.markDelivery(delivery.id, { status: "cancelled", lastErrorCode: "disabled" });
        return "cancelled";
      }
      result = await this.push.send({
        endpoint: endpoints[0].endpoint,
        title: "Master Touch OS",
        body: "تنبيه تشغيلي",
        href: "/",
      });
    }

    if (result.ok) {
      await this.store.markDelivery(delivery.id, {
        status: delivery.channel === "email" ? "sent" : "delivered",
        providerMessageId: result.providerMessageId ?? null,
      });
      await this.store.audit("notification.delivery.sent", "notification_delivery", delivery.id, delivery.organizationId);
      return "sent";
    }
    if (!result.retry || isPermanentProviderError(result.code)) {
      await this.store.markDelivery(delivery.id, { status: "failed", lastErrorCode: result.code, nextAttemptAt: null });
      await this.store.audit("notification.delivery.failed", "notification_delivery", delivery.id, delivery.organizationId);
      return "failed";
    }
    const next = nextRetryAt(delivery.attemptCount);
    await this.store.markDelivery(delivery.id, {
      status: "failed",
      lastErrorCode: result.code,
      nextAttemptAt: next ? next.toISOString() : null,
    });
    await this.store.audit("notification.delivery.retried", "notification_delivery", delivery.id, delivery.organizationId);
    return "failed";
  }
}
