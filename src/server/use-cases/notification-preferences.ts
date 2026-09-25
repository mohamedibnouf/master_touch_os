"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import { AuditService } from "@/server/services/audit.service";
import { canDisablePreference } from "@/modules/notifications/policy";
import type { NotificationCategory } from "@/modules/notifications/catalog";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from "@/modules/notifications/catalog";
import { validatePushSubscription } from "@/modules/notifications/safety";

function isHubSchemaError(message: string | undefined): boolean {
  return /does not exist|schema cache|notification_preferences|push_subscriptions/i.test(message ?? "");
}

export async function saveNotificationPreferenceAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "notification.read");
  const category = String(formData.get("category") ?? "") as NotificationCategory;
  const channel = String(formData.get("channel") ?? "") as (typeof NOTIFICATION_CHANNELS)[number];
  const enabled = formData.get("enabled") === "true" || formData.get("enabled") === "on";
  if (!NOTIFICATION_CATEGORIES.includes(category) || !NOTIFICATION_CHANNELS.includes(channel)) {
    throw new ValidationError("تفضيل غير صالح.", "Invalid preference.");
  }
  if (!canDisablePreference(category, channel, enabled)) {
    throw new ValidationError("لا يمكن إيقاف التنبيه داخل التطبيق لهذه الفئة.", "In-app is mandatory for this category.");
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      organization_id: ctx.organization.id,
      profile_id: ctx.userId,
      category,
      channel,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,profile_id,category,channel" },
  );
  if (error) {
    if (isHubSchemaError(error.message)) {
      throw new ValidationError("ترحيل 062 غير مطبّق بعد.", "Migration 062 is not applied.");
    }
    throw new ValidationError("تعذر حفظ التفضيل.", "Could not save preference.");
  }
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "notification.preference.changed",
    entityType: "notification_preference",
    entityId: ctx.userId,
    newValues: { category, channel, enabled },
  });
  revalidatePath("/notifications/preferences");
}

export async function savePushSubscriptionAction(payload: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  const ctx = authorize(await getAuthContext(), "notification.read");
  const parsed = validatePushSubscription(payload);
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      organization_id: ctx.organization.id,
      profile_id: ctx.userId,
      endpoint: parsed.endpoint,
      p256dh: parsed.p256dh,
      auth: parsed.auth,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    if (isHubSchemaError(error.message)) {
      return { ok: false as const, reason: "migration_062" };
    }
    return { ok: false as const, reason: "save_failed" };
  }
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "push.subscription.created",
    entityType: "push_subscription",
    entityId: ctx.userId,
  });
  revalidatePath("/notifications/preferences");
  return { ok: true as const };
}

export async function revokePushSubscriptionAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "notification.read");
  const endpoint = String(formData.get("endpoint") ?? "");
  const supabase = await createServerSupabaseClient();
  await supabase
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", ctx.userId)
    .eq("endpoint", endpoint);
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "push.subscription.revoked",
    entityType: "push_subscription",
    entityId: ctx.userId,
  });
  revalidatePath("/notifications/preferences");
}
