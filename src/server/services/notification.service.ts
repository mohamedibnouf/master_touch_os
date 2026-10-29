import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationChannel, NotificationPriority } from "@/types/enums";
import { logger } from "@/lib/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { planDeliveryChannels } from "@/modules/notifications/policy";
import type { PreferenceRow } from "@/modules/notifications/catalog";
import { createEmailProvider, createPushProvider, createWhatsAppProvider } from "@/modules/notifications/providers";
import { personalWhatsAppDestinationAllowed } from "@/modules/notifications/whatsapp-recipients";
import { pickNotificationText, recipientLocale } from "@/modules/notifications/localize";
import type { Locale } from "@/lib/i18n/config";

export type NotificationPayload = {
  organizationId: string;
  recipientProfileId: string;
  type: string;
  /** Arabic text (default). */
  title: string;
  message: string;
  /** Optional English text, stored/sent instead when the recipient's locale is 'en'. */
  titleEn?: string | null;
  messageEn?: string | null;
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
    /* Email is queued via upsert_operational_notification and sent by cron. */
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

type RecipientProfileRow = {
  is_active: boolean;
  phone: string | null;
  whatsapp_opt_in?: boolean;
  locale?: string | null;
};

/** Newest columns first; older databases may lack `locale` / `whatsapp_opt_in`. */
const RECIPIENT_PROFILE_SELECTS = [
  "is_active, phone, whatsapp_opt_in, locale",
  "is_active, phone, whatsapp_opt_in",
  "is_active, phone",
] as const;

async function loadRecipientProfile(writer: SupabaseClient, profileId: string) {
  let res = await writer
    .from("profiles")
    .select(RECIPIENT_PROFILE_SELECTS[0])
    .eq("id", profileId)
    .maybeSingle<RecipientProfileRow>();
  for (const columns of RECIPIENT_PROFILE_SELECTS.slice(1)) {
    if (!(res.error && /whatsapp_opt_in|locale|schema cache|column/i.test(res.error.message ?? ""))) break;
    res = await writer.from("profiles").select(columns).eq("id", profileId).maybeSingle<RecipientProfileRow>();
  }
  return res;
}

async function resolveNotifyChannels(
  writer: SupabaseClient,
  payload: NotificationPayload,
): Promise<{ channels: Array<"in_app" | "email" | "whatsapp" | "push">; locale: Locale }> {
  const [memberRes, prefsRes] = await Promise.all([
    writer
      .from("organization_members")
      .select("status")
      .eq("organization_id", payload.organizationId)
      .eq("profile_id", payload.recipientProfileId)
      .maybeSingle<{ status: string }>(),
    writer
      .from("notification_preferences")
      .select("category, channel, enabled")
      .eq("organization_id", payload.organizationId)
      .eq("profile_id", payload.recipientProfileId),
  ]);

  const profileRes = await loadRecipientProfile(writer, payload.recipientProfileId);
  const locale = recipientLocale(profileRes.data?.locale);

  const preferences: PreferenceRow[] = ((prefsRes.data ?? []) as Array<{
    category: PreferenceRow["category"];
    channel: PreferenceRow["channel"];
    enabled: boolean;
  }>).map((row) => ({
    profileId: payload.recipientProfileId,
    category: row.category,
    channel: row.channel,
    enabled: row.enabled,
  }));

  const personalEmailAllowed = memberRes.data?.status === "active" && profileRes.data?.is_active === true;
  const personalWhatsAppAllowed = personalWhatsAppDestinationAllowed({
    phone: profileRes.data?.phone ?? null,
    optIn: profileRes.data?.whatsapp_opt_in === true,
    memberActive: personalEmailAllowed,
  });

  const channels = planDeliveryChannels({
    type: payload.type,
    recipientId: payload.recipientProfileId,
    preferences,
    personalEmailAllowed,
    personalWhatsAppAllowed,
    emailAvailable: createEmailProvider().enabled,
    pushAvailable: createPushProvider().enabled,
    whatsappAvailable: createWhatsAppProvider().enabled,
  });
  return { channels, locale };
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
   * Email is queued only; never sent synchronously.
   */
  async notify(payload: NotificationPayload): Promise<string | null> {
    let writer: SupabaseClient;
    try {
      writer = createAdminSupabaseClient();
    } catch (error) {
      logger.error("Failed to create admin client for notification", {
        detail: error instanceof Error ? error.message : String(error),
      });
      writer = this.supabase;
    }

    const dedup =
      payload.dedupKey ??
      (payload.entityId ? `${payload.type}:${payload.entityId}:${payload.recipientProfileId}` : null);

    let channels: Array<"in_app" | "email" | "whatsapp" | "push"> = ["in_app"];
    let locale: Locale = "ar";
    try {
      const plan = await resolveNotifyChannels(writer, payload);
      channels = plan.channels;
      locale = plan.locale;
      if (!channels.includes("in_app")) {
        channels = ["in_app", ...channels];
      }
    } catch (error) {
      logger.warn("Notification channel plan failed; in-app only", {
        detail: error instanceof Error ? error.message : String(error),
      });
      channels = ["in_app"];
    }

    // Store the text in the recipient's language (Arabic unless profiles.locale = 'en').
    const text = pickNotificationText(locale, payload);

    const { data: hubId, error: hubError } = await writer.rpc("upsert_operational_notification", {
      p_organization_id: payload.organizationId,
      p_recipient_profile_id: payload.recipientProfileId,
      p_event_type: payload.type,
      p_type: payload.type,
      p_title: text.title,
      p_message: text.message,
      p_entity_type: payload.entityType ?? null,
      p_entity_id: payload.entityId ?? null,
      p_href: payload.href ?? null,
      p_priority: payload.priority ?? "normal",
      p_dedup_key: dedup,
      p_channels: channels,
    });
    if (!hubError && hubId) {
      return String(hubId);
    }
    if (hubError && !/does not exist|schema cache|upsert_operational_notification/i.test(hubError.message ?? "")) {
      logger.warn("Hub notification RPC failed; using legacy insert", { detail: hubError.message });
    }

    const { data, error } = await writer
      .from("notifications")
      .insert({
        organization_id: payload.organizationId,
        recipient_profile_id: payload.recipientProfileId,
        type: payload.type,
        title: text.title,
        message: text.message,
        entity_type: payload.entityType ?? null,
        entity_id: payload.entityId ?? null,
        priority: payload.priority ?? "normal",
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !data) {
      logger.error("Failed to create in-app notification", { detail: error?.message });
      return null;
    }

    for (const channel of this.channels) {
      if (channel.channel !== "in_app") {
        continue;
      }
      await new InAppChannel(writer).send(data.id, payload);
    }

    return data.id;
  }
}

export function createNotificationService(supabase: SupabaseClient): NotificationService {
  return new NotificationService(supabase, [new InAppChannel(supabase)]);
}
