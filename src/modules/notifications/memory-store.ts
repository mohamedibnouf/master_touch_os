import type { ActiveMember, PreferenceRow } from "./catalog";
import type { HubDelivery, HubNotification, HubStore } from "./orchestrator";

export class MemoryHubStore implements HubStore {
  notifications: HubNotification[] = [];
  deliveries: HubDelivery[] = [];
  members: ActiveMember[] = [];
  preferences: PreferenceRow[] = [];
  contacts = new Map<string, { email: string | null; phone: string | null; name: string | null }>();
  push = new Map<string, Array<{ endpoint: string }>>();
  managementEmail = new Map<string, string | null>();
  audits: string[] = [];
  deliverySeq = 0;

  async upsertNotification(input: Parameters<HubStore["upsertNotification"]>[0]): Promise<HubNotification> {
    const existing = this.notifications.find(
      (n) => n.organizationId === input.organizationId && n.recipientId === input.recipientId && n.dedupKey === input.dedupKey,
    );
    if (existing) return { ...existing, created: false };
    const row: HubNotification = {
      id: `n-${this.notifications.length + 1}`,
      organizationId: input.organizationId,
      recipientId: input.recipientId,
      eventType: input.eventType,
      dedupKey: input.dedupKey,
      title: input.title,
      body: input.body,
      href: input.href,
      created: true,
    };
    this.notifications.push(row);
    for (const channel of input.channels) {
      this.deliverySeq += 1;
      this.deliveries.push({
        id: `d-${this.deliverySeq}`,
        notificationId: row.id,
        organizationId: input.organizationId,
        recipientId: input.recipientId,
        channel,
        status: "pending",
        attemptCount: 1,
      });
    }
    return row;
  }

  async listActiveMembers(organizationId: string, profileIds: string[]): Promise<ActiveMember[]> {
    return this.members.filter((m) => m.organizationId === organizationId && profileIds.includes(m.profileId));
  }

  async listPreferences(organizationId: string, profileIds: string[]): Promise<PreferenceRow[]> {
    void organizationId;
    return this.preferences.filter((p) => profileIds.includes(p.profileId));
  }

  async getRecipientContact(profileId: string) {
    return this.contacts.get(profileId) ?? { email: null, phone: null, name: null };
  }

  async getNotification(notificationId: string) {
    return this.notifications.find((n) => n.id === notificationId) ?? null;
  }

  async getManagementEmail(organizationId: string) {
    return this.managementEmail.get(organizationId) ?? null;
  }

  async listPushEndpoints(organizationId: string, profileId: string) {
    return this.push.get(`${organizationId}:${profileId}`) ?? [];
  }

  async markDelivery(
    deliveryId: string,
    patch: {
      status: string;
      lastErrorCode?: string | null;
      providerMessageId?: string | null;
      nextAttemptAt?: string | null;
    },
  ) {
    const row = this.deliveries.find((d) => d.id === deliveryId);
    if (row) {
      row.status = patch.status;
      if (patch.lastErrorCode !== undefined) row.lastErrorCode = patch.lastErrorCode;
      if (patch.providerMessageId !== undefined) row.providerMessageId = patch.providerMessageId;
    }
  }

  async listPendingDeliveries(limit: number): Promise<HubDelivery[]> {
    return this.deliveries.filter((d) => d.status === "pending" || d.status === "failed").slice(0, limit);
  }

  async audit(action: string) {
    this.audits.push(action);
  }
}
