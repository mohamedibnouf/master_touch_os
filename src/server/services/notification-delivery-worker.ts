import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createNotificationService } from "@/server/services/notification.service";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createEmailProvider, createPushProvider, createWhatsAppProvider } from "@/modules/notifications/providers";
import { NotificationOrchestrator } from "@/modules/notifications/orchestrator";
import { MemoryHubStore } from "@/modules/notifications/memory-store";
import { nextRetryAt } from "@/modules/notifications/schedule";
import { logger } from "@/lib/logger";
import { formatRiyadhDateTimeAr } from "@/modules/projects/deadline";
import { workflowStepNotificationRecipients } from "@/modules/projects/workflow-responsibility";
import {
  WORKFLOW_ACTIVATION_FLUSH_LIMIT,
  workflowStepActivatedDedupKey,
  workflowStepActivatedMessage,
} from "@/modules/projects/workflow-activation-notify";

export async function processPendingNotificationDeliveries(
  admin: SupabaseClient,
  options?: { limit?: number; now?: Date },
): Promise<number> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? WORKFLOW_ACTIVATION_FLUSH_LIMIT;
  let deliveries = 0;
  const { data: claimed, error: claimErr } = await admin.rpc("claim_notification_deliveries", { p_limit: limit });
  if (claimErr || !Array.isArray(claimed)) return 0;

  const store = new MemoryHubStore();
  const orch = new NotificationOrchestrator(
    store,
    createEmailProvider(),
    createWhatsAppProvider(),
    createPushProvider(),
    process.env.NEXT_PUBLIC_APP_URL ?? "",
  );

  for (const row of claimed as Array<{
    id: string;
    notification_id: string;
    organization_id: string;
    recipient_profile_id: string;
    channel: "in_app" | "email" | "whatsapp" | "push";
    attempt_count: number;
    status: string;
  }>) {
    if (row.channel === "in_app") {
      await admin
        .from("notification_deliveries")
        .update({ status: "delivered", delivered_at: now.toISOString() })
        .eq("id", row.id);
      deliveries += 1;
      continue;
    }
    const { data: note } = await admin
      .from("notifications")
      .select("id, organization_id, recipient_profile_id, event_type, type, title, message, href, dedup_key")
      .eq("id", row.notification_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    store.notifications = note
      ? [
          {
            id: note.id as string,
            organizationId: note.organization_id as string,
            recipientId: note.recipient_profile_id as string,
            eventType: String(note.event_type ?? note.type ?? ""),
            dedupKey: String(note.dedup_key ?? ""),
            title: String(note.title ?? ""),
            body: String(note.message ?? ""),
            href: (note.href as string | null) ?? null,
            created: false,
          },
        ]
      : [];
    let destRes = await admin
      .from("organizations")
      .select("management_notification_email, management_notification_whatsapp")
      .eq("id", row.organization_id)
      .maybeSingle();
    if (destRes.error && /management_notification_whatsapp|schema cache|column/i.test(destRes.error.message ?? "")) {
      destRes = await admin
        .from("organizations")
        .select("management_notification_email")
        .eq("id", row.organization_id)
        .maybeSingle();
    }
    const managementEmail =
      destRes.error || typeof destRes.data?.management_notification_email !== "string"
        ? null
        : destRes.data.management_notification_email;
    const destWhatsapp = destRes.data as { management_notification_whatsapp?: string | null } | null;
    const managementWhatsApp =
      destRes.error || typeof destWhatsapp?.management_notification_whatsapp !== "string"
        ? null
        : destWhatsapp.management_notification_whatsapp;
    store.managementEmail.set(row.organization_id, managementEmail);
    store.managementWhatsApp.set(row.organization_id, managementWhatsApp);
    store.deliveries = [
      {
        id: row.id,
        notificationId: row.notification_id,
        organizationId: row.organization_id,
        recipientId: row.recipient_profile_id,
        channel: row.channel,
        status: row.status,
        attemptCount: row.attempt_count,
      },
    ];
    let profile = (
      await admin.from("profiles").select("full_name_ar, phone, whatsapp_opt_in").eq("id", row.recipient_profile_id).maybeSingle()
    ).data as { full_name_ar?: string | null; phone?: string | null; whatsapp_opt_in?: boolean } | null;
    if (!profile) {
      const fallback = await admin
        .from("profiles")
        .select("full_name_ar, phone")
        .eq("id", row.recipient_profile_id)
        .maybeSingle();
      profile = fallback.data;
    }
    store.contacts.set(row.recipient_profile_id, {
      email: null,
      phone: profile?.phone ?? null,
      name: profile?.full_name_ar ?? null,
      whatsappOptIn: profile?.whatsapp_opt_in === true,
    });
    try {
      const user = await admin.auth.admin.getUserById(row.recipient_profile_id);
      store.contacts.set(row.recipient_profile_id, {
        email: user.data.user?.email ?? null,
        phone: profile?.phone ?? null,
        name: profile?.full_name_ar ?? null,
        whatsappOptIn: profile?.whatsapp_opt_in === true,
      });
    } catch {
      /* email lookup is best-effort */
    }
    const outcome = await orch.processDelivery(store.deliveries[0]);
    const patch: Record<string, unknown> = { updated_at: now.toISOString() };
    if (outcome.status === "sent") {
      patch.status = row.channel === "email" ? "sent" : "delivered";
      if (row.channel === "email") patch.sent_at = now.toISOString();
      else patch.delivered_at = now.toISOString();
      patch.next_attempt_at = null;
      patch.last_error_code = null;
      if (outcome.providerMessageId) patch.provider_message_id = outcome.providerMessageId;
    } else if (outcome.status === "cancelled") {
      patch.status = "cancelled";
      patch.next_attempt_at = null;
      patch.last_error_code = outcome.lastErrorCode ?? "disabled";
    } else {
      patch.status = "failed";
      const next = nextRetryAt(row.attempt_count, now);
      patch.next_attempt_at = next ? next.toISOString() : null;
      patch.last_error_code = outcome.lastErrorCode ?? "transient";
    }
    await admin.from("notification_deliveries").update(patch).eq("id", row.id);
    deliveries += 1;
  }

  return deliveries;
}

export async function flushWorkflowActivationDeliveries(): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    await processPendingNotificationDeliveries(admin, { limit: WORKFLOW_ACTIVATION_FLUSH_LIMIT });
  } catch (error) {
    logger.warn("workflow activation delivery flush failed", {
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

type ReadyStepRow = {
  id: string;
  assigned_user_id: string | null;
  assigned_role_id: string | null;
  responsible_user_id: string | null;
  due_at: string | null;
  workflow_steps: { name_ar: string } | { name_ar: string }[] | null;
};

export async function notifyWorkflowReadyAssignees(input: {
  supabase: SupabaseClient;
  organizationId: string;
  instanceId: string;
  projectId: string | null;
  roleHolderIds: (roleId: string | null) => Promise<string[]>;
}): Promise<void> {
  const { data: ready } = await input.supabase
    .from("workflow_instance_steps")
    .select("id, assigned_user_id, assigned_role_id, responsible_user_id, due_at, workflow_steps(name_ar)")
    .eq("instance_id", input.instanceId)
    .eq("status", "ready");
  const href = input.projectId ? `/projects/${input.projectId}?tab=stages` : null;
  const notifications = createNotificationService(input.supabase);
  for (const row of (ready ?? []) as ReadyStepRow[]) {
    const stepRel = row.workflow_steps;
    const name = Array.isArray(stepRel) ? stepRel[0]?.name_ar : stepRel?.name_ar;
    const dueLabel = row.due_at ? formatRiyadhDateTimeAr(row.due_at) : null;
    const recipients = workflowStepNotificationRecipients({
      responsibleUserId: row.responsible_user_id,
      assignedUserId: row.assigned_user_id,
      roleHolderIds: await input.roleHolderIds(row.assigned_role_id),
    });
    for (const userId of recipients) {
      await notifications.notify({
        organizationId: input.organizationId,
        recipientProfileId: userId,
        type: "workflow.step.activated",
        title: "تم إسناد مرحلة جديدة إليك",
        message: workflowStepActivatedMessage({ nameAr: name ?? null, dueLabel }),
        entityType: input.projectId ? "project" : "workflow_instance_step",
        entityId: input.projectId ?? row.id,
        href,
        priority: "normal",
        dedupKey: workflowStepActivatedDedupKey(row.id, userId),
      });
    }
  }
  await flushWorkflowActivationDeliveries();
}
