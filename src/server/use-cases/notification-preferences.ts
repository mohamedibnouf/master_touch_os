"use server";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { AuditService } from "@/server/services/audit.service";
import { canDisablePreference } from "@/modules/notifications/policy";
import { normalizeManagementNotificationEmail, managementNotificationEmailCheckPasses } from "@/modules/notifications/management-email";
import {
  parseManagementNotificationWhatsapp,
  managementNotificationWhatsappCheckPasses,
  managementWhatsappAuditPayload,
} from "@/modules/notifications/management-whatsapp";
import { normalizePhoneToE164, isValidE164 } from "@/lib/phone/e164";
import type { NotificationCategory } from "@/modules/notifications/catalog";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from "@/modules/notifications/catalog";
import { validatePushSubscription } from "@/modules/notifications/safety";

function isHubSchemaError(message: string | undefined): boolean {
  return /does not exist|schema cache|notification_preferences|push_subscriptions/i.test(message ?? "");
}

export async function saveNotificationPreferenceAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ التفضيل. حاول مرة أخرى.", async () => {
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
  });
}

export async function saveManagementNotificationEmailAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ بريد الإدارة. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "settings.manage");
    const value = normalizeManagementNotificationEmail(String(formData.get("management_notification_email") ?? ""));
    if (value && !managementNotificationEmailCheckPasses(value)) {
      throw new ValidationError("البريد غير صالح.", "The email is not valid.");
    }
    const supabase = await createServerSupabaseClient();
    const { data: previous } = await supabase
      .from("organizations")
      .select("management_notification_email")
      .eq("id", ctx.organization.id)
      .maybeSingle<{ management_notification_email: string | null }>();
    const previousNorm = normalizeManagementNotificationEmail(previous?.management_notification_email);
    if (previousNorm === value) {
      revalidatePath("/settings");
      return;
    }
    const { error } = await supabase
      .from("organizations")
      .update({ management_notification_email: value })
      .eq("id", ctx.organization.id);
    if (error) {
      throw new ValidationError("تعذر حفظ البريد.", "Could not save the email.");
    }
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "organization.management_notification_email.changed",
      entityType: "organization",
      entityId: ctx.organization.id,
      previousValues: { set: previousNorm !== null },
      newValues: { set: value !== null },
    });
    revalidatePath("/settings");
  });
}

export async function saveManagementNotificationWhatsappAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ واتساب الإدارة. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "settings.manage");
    const parsed = parseManagementNotificationWhatsapp(String(formData.get("management_notification_whatsapp") ?? ""));
    if (!parsed.ok) {
      throw new ValidationError("رقم واتساب الإدارة غير صالح.", "The management WhatsApp number is not valid E.164.");
    }
    const value = parsed.value;
    if (value && !managementNotificationWhatsappCheckPasses(value)) {
      throw new ValidationError("رقم واتساب الإدارة غير صالح.", "The management WhatsApp number is not valid E.164.");
    }
    const supabase = await createServerSupabaseClient();
    const { data: previous } = await supabase
      .from("organizations")
      .select("management_notification_whatsapp")
      .eq("id", ctx.organization.id)
      .maybeSingle<{ management_notification_whatsapp: string | null }>();
    const previousParsed = parseManagementNotificationWhatsapp(previous?.management_notification_whatsapp);
    const previousNorm = previousParsed.ok ? previousParsed.value : null;
    if (previousNorm === value) {
      revalidatePath("/settings");
      return;
    }
    const { error } = await supabase
      .from("organizations")
      .update({ management_notification_whatsapp: value })
      .eq("id", ctx.organization.id);
    if (error) {
      throw new ValidationError("تعذر حفظ الرقم.", "Could not save the number.");
    }
    const auditFields = managementWhatsappAuditPayload(previousNorm, value);
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "organization.management_notification_whatsapp.changed",
      entityType: "organization",
      entityId: ctx.organization.id,
      previousValues: auditFields.previousValues,
      newValues: auditFields.newValues,
    });
    revalidatePath("/settings");
  });
}

export async function saveOwnContactPhoneAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ رقم الجوال. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "notification.read");
    const phoneResult = normalizePhoneToE164(String(formData.get("phone") ?? ""));
    if (!phoneResult.ok) {
      throw new ValidationError("رقم الجوال غير صالح.", "The mobile number is not a valid E.164 contact.");
    }
    const supabase = await createServerSupabaseClient();
    const patch: { phone: string | null; whatsapp_opt_in?: boolean } = { phone: phoneResult.e164 };
    if (phoneResult.e164 === null) {
      patch.whatsapp_opt_in = false;
    }
    const { error } = await supabase.from("profiles").update(patch).eq("id", ctx.userId);
    if (error) {
      throw new ValidationError("تعذر حفظ رقم الجوال.", "Could not save the mobile number.");
    }
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "profile.phone.changed",
      entityType: "profile",
      entityId: ctx.userId,
      newValues: { set: phoneResult.e164 !== null },
    });
    revalidatePath("/notifications/preferences");
  });
}

export async function saveWhatsAppOptInAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ موافقة واتساب. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "notification.read");
    const enabled = formData.get("whatsapp_opt_in") === "true" || formData.get("whatsapp_opt_in") === "on";
    const supabase = await createServerSupabaseClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone, whatsapp_opt_in")
      .eq("id", ctx.userId)
      .maybeSingle<{ phone: string | null; whatsapp_opt_in: boolean }>();
    const phone = profile?.phone ?? null;
    if (enabled && (!phone || !isValidE164(phone))) {
      throw new ValidationError(
        "أضف رقم جوال صالحاً أولاً لتفعيل إشعارات واتساب.",
        "Add a valid mobile number before enabling WhatsApp.",
      );
    }
    const { error } = await supabase
      .from("profiles")
      .update({ whatsapp_opt_in: enabled })
      .eq("id", ctx.userId);
    if (error) {
      throw new ValidationError("تعذر حفظ موافقة واتساب.", "Could not save WhatsApp consent.");
    }
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "profile.whatsapp_opt_in.changed",
      entityType: "profile",
      entityId: ctx.userId,
      newValues: { enabled },
    });
    revalidatePath("/notifications/preferences");
  });
}

export async function savePushSubscriptionAction(payload: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  try {
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
  } catch {
    return { ok: false as const, reason: "save_failed" };
  }
}

export async function revokePushSubscriptionAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ التفضيل. حاول مرة أخرى.", async () => {
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
  });
}
