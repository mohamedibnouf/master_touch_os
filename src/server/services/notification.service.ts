import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationChannel, NotificationPriority } from "@/types/enums";
import { logger } from "@/lib/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type NotificationPayload = {
  organizationId: string;
  recipientProfileId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  priority?: NotificationPriority;
  dedupKey?: string | null;
  href?: string | null;
};

export interface NotificationChannelAdapter {
  readonly channel: NotificationChannel;
  send(notificationId: string, payload: NotificationPayload): Promise<void>;
}

export class InAppChannel implements NotificationChannelAdapter {
  readonly channel = "in_app" as const;

  constructor(private readonly supabase: SupabaseClient) {}

  async send(notificationId: string, payload: NotificationPayload): Promise<void> {
    void payload;
    const at = new Date().toISOString();
    await this.supabase.from("notification_deliveries").insert({
      notification_id: notificationId,
      organization_id: payload.organizationId,
      recipient_profile_id: payload.recipientProfileId,
      channel: this.channel,
      status: "delivered",
      attempted_at: at,
      delivered_at: at,
    });
  }
}

export class EmailChannel implements NotificationChannelAdapter {
  readonly channel = "email" as const;
  async send(): Promise<void> {
    // Phase 8
  }
}

export class WhatsAppChannel implements NotificationChannelAdapter {
  readonly channel = "whatsapp" as const;
  async send(): Promise<void> {
    // Phase 8
  }
}

export class PushChannel implements NotificationChannelAdapter {
  readonly channel = "push" as const;
  async send(): Promise<void> {
    // Future channel
  }
}

export class NotificationService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly channels: NotificationChannelAdapter[],
  ) {}

  /**
   * In-app notifications are written with the service-role client.
   * Authenticated RLS intentionally has no INSERT on `notifications`
   * (recipients may only read/update their own rows).
   */
  async notify(payload: NotificationPayload): Promise<string | null> {
    let writer: SupabaseClient;
    try {
      writer = createAdminSupabaseClient();
    } catch (error) {
      logger.error("Failed to create admin client for notification", {
        message: error instanceof Error ? error.message : String(error),
      });
      writer = this.supabase;
    }

    const dedup =
      payload.dedupKey ??
      (payload.entityId ? `${payload.type}:${payload.entityId}:${payload.recipientProfileId}` : null);

    const { data: hubId, error: hubError } = await writer.rpc("upsert_operational_notification", {
      p_organization_id: payload.organizationId,
      p_recipient_profile_id: payload.recipientProfileId,
      p_event_type: payload.type,
      p_type: payload.type,
      p_title: payload.title,
      p_message: payload.message,
      p_entity_type: payload.entityType ?? null,
      p_entity_id: payload.entityId ?? null,
      p_href: payload.href ?? null,
      p_priority: payload.priority ?? "normal",
      p_dedup_key: dedup,
      p_channels: ["in_app"],
    });
    if (!hubError && hubId) {
      return String(hubId);
    }
    if (hubError && !/does not exist|schema cache|upsert_operational_notification/i.test(hubError.message ?? "")) {
      logger.warn("Hub notification RPC failed; using legacy insert", { message: hubError.message });
    }

    const { data, error } = await writer
      .from("notifications")
      .insert({
        organization_id: payload.organizationId,
        recipient_profile_id: payload.recipientProfileId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        entity_type: payload.entityType ?? null,
        entity_id: payload.entityId ?? null,
        priority: payload.priority ?? "normal",
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !data) {
      logger.error("Failed to create in-app notification", { message: error?.message });
      return null;
    }

    for (const channel of this.channels) {
      if (channel.channel !== "in_app") {
        continue;
      }
      // Deliveries also lack authenticated INSERT RLS — use the same writer.
      await new InAppChannel(writer).send(data.id, payload);
    }

    return data.id;
  }
}

export function createNotificationService(supabase: SupabaseClient): NotificationService {
  return new NotificationService(supabase, [new InAppChannel(supabase)]);
}
