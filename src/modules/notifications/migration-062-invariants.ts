/** Pure semantics mirrored by 062 backfill / tenant / preference rules. Not a live DB test. */

export type LegacyDelivery = {
  id: string;
  notification_id: string | null;
  status: string;
  channel: string;
  attempted_at: string | null;
  delivered_at: string | null;
  sent_at: string | null;
  organization_id: string | null;
  recipient_profile_id: string | null;
};

export const ALLOWED_DELIVERY_STATUSES = [
  "pending",
  "processing",
  "sent",
  "delivered",
  "failed",
  "cancelled",
] as const;

export const ALLOWED_CHANNELS = ["in_app", "email", "whatsapp", "push"] as const;

export function incompatibleStatuses(rows: LegacyDelivery[]): string[] {
  return [...new Set(rows.filter((r) => !ALLOWED_DELIVERY_STATUSES.includes(r.status as (typeof ALLOWED_DELIVERY_STATUSES)[number])).map((r) => r.status))];
}

export function incompatibleChannels(rows: LegacyDelivery[]): string[] {
  return [...new Set(rows.filter((r) => !ALLOWED_CHANNELS.includes(r.channel as (typeof ALLOWED_CHANNELS)[number])).map((r) => r.channel))];
}

export function orphanDeliveries(rows: LegacyDelivery[], notificationIds: Set<string>): LegacyDelivery[] {
  return rows.filter((r) => !r.notification_id || !notificationIds.has(r.notification_id));
}

export function duplicateNotificationChannelGroups(rows: LegacyDelivery[]): Array<{ notification_id: string; channel: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.notification_id) continue;
    const key = `${r.notification_id}:${r.channel}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [notification_id, channel] = key.split(":");
      return { notification_id, channel, count };
    });
}

export function backfillTenant(
  row: LegacyDelivery,
  notification: { organization_id: string; recipient_profile_id: string } | null,
): { ok: true; organization_id: string; recipient_profile_id: string } | { ok: false; reason: "unresolved" } {
  if (!notification) return { ok: false, reason: "unresolved" };
  return {
    ok: true,
    organization_id: notification.organization_id,
    recipient_profile_id: notification.recipient_profile_id,
  };
}

/** Status-faithful timestamp backfill. Never fabricates delivered_at for failed/pending/processing. */
export function backfillTimestamps(row: LegacyDelivery): { delivered_at: string | null; sent_at: string | null } {
  let delivered_at = row.delivered_at;
  let sent_at = row.sent_at;
  if (row.status === "delivered" && !delivered_at && row.attempted_at) delivered_at = row.attempted_at;
  if (row.status === "sent" && !sent_at && row.attempted_at) sent_at = row.attempted_at;
  return { delivered_at, sent_at };
}

export function tenantBindingHolds(delivery: {
  notification_id: string;
  organization_id: string;
  recipient_profile_id: string;
}, notification: { id: string; organization_id: string; recipient_profile_id: string }): boolean {
  return (
    delivery.notification_id === notification.id &&
    delivery.organization_id === notification.organization_id &&
    delivery.recipient_profile_id === notification.recipient_profile_id
  );
}

export function pushOwnerTransferBlocked(existing: { profile_id: string; organization_id: string }, next: { profile_id: string; organization_id: string }): boolean {
  return existing.profile_id !== next.profile_id || existing.organization_id !== next.organization_id;
}
