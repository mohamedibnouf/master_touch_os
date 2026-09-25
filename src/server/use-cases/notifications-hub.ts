import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createNotificationService } from "@/server/services/notification.service";
import { createEmailProvider, createPushProvider, createWhatsAppProvider } from "@/modules/notifications/providers";
import { NotificationOrchestrator } from "@/modules/notifications/orchestrator";
import { MemoryHubStore } from "@/modules/notifications/memory-store";
import { buildApprovalReminderEvents, buildProjectDeadlineEvents } from "@/modules/notifications/scan";
import { maybeAiDigestSummary, type DigestFacts } from "@/modules/notifications/digest";
import { nextRetryAt } from "@/modules/notifications/schedule";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { logger } from "@/lib/logger";

function isHubSchemaError(message: string | undefined): boolean {
  return /does not exist|schema cache|notification_preferences|upsert_operational/i.test(message ?? "");
}

export type NotificationJobResult = {
  ok: boolean;
  hubSchema: boolean;
  reminders: number;
  deliveries: number;
  skippedReason?: string;
};

export async function runNotificationJobs(options?: { digestFacts?: DigestFacts }): Promise<NotificationJobResult> {
  let admin;
  try {
    admin = createAdminSupabaseClient();
  } catch {
    return { ok: false, hubSchema: false, reminders: 0, deliveries: 0, skippedReason: "no_admin" };
  }

  const { error: probe } = await admin.from("notification_preferences").select("id").limit(1);
  if (probe && isHubSchemaError(probe.message)) {
    return { ok: true, hubSchema: false, reminders: 0, deliveries: 0, skippedReason: "migration_062_unapplied" };
  }

  const today = riyadhTodayYmd();
  const now = new Date();
  const notify = createNotificationService(admin);
  let reminders = 0;

  const { data: steps } = await admin
    .from("approval_steps")
    .select("id, organization_id, request_id, user_id, due_at, status")
    .in("status", ["pending", "in_progress"])
    .not("due_at", "is", null)
    .limit(200);

  const managerByEmployeeProfile = new Map<string, string>();
  const profileIds = [...new Set((steps ?? []).map((s) => s.user_id).filter(Boolean))] as string[];
  if (profileIds.length) {
    const { data: emps } = await admin
      .from("employees")
      .select("profile_id, direct_manager_employee_id")
      .in("profile_id", profileIds);
    const managerEmpIds = [...new Set((emps ?? []).map((e) => e.direct_manager_employee_id).filter(Boolean))] as string[];
    const managerProfiles = new Map<string, string>();
    if (managerEmpIds.length) {
      const { data: mgrs } = await admin.from("employees").select("id, profile_id").in("id", managerEmpIds);
      for (const m of mgrs ?? []) managerProfiles.set(m.id as string, m.profile_id as string);
    }
    for (const e of emps ?? []) {
      if (e.direct_manager_employee_id) {
        const mid = managerProfiles.get(e.direct_manager_employee_id as string);
        if (mid) managerByEmployeeProfile.set(e.profile_id as string, mid);
      }
    }
  }

  const scan = buildApprovalReminderEvents(
    (steps ?? []).map((s) => ({
      id: s.id as string,
      organizationId: s.organization_id as string,
      requestId: s.request_id as string,
      userId: (s.user_id as string | null) ?? null,
      dueAt: (s.due_at as string | null) ?? null,
      status: s.status as string,
      managerProfileId: s.user_id ? managerByEmployeeProfile.get(s.user_id as string) ?? null : null,
    })),
    now,
    today,
  );

  for (const ev of scan) {
    await notify.notify({
      organizationId: ev.organizationId,
      recipientProfileId: ev.recipientId,
      type: ev.eventType,
      title: ev.eventType === "ESCALATION_CREATED" ? "تصعيد موافقة" : "تذكير موافقة",
      message: "هناك طلب موافقة يحتاج متابعة داخل النظام.",
      entityType: "approval_request",
      entityId: ev.entityId,
      priority: "high",
      dedupKey: ev.dedupKey,
      href: "/approvals",
    });
    reminders += 1;
  }

  const { data: projects } = await admin
    .from("projects")
    .select("id, organization_id, project_manager_id, planned_end_date")
    .in("status", ["active", "on_hold"])
    .not("planned_end_date", "is", null)
    .limit(200);

  const projectEvents = buildProjectDeadlineEvents(
    (projects ?? []).map((p) => ({
      id: p.id as string,
      organizationId: p.organization_id as string,
      ownerProfileId: (p.project_manager_id as string | null) ?? null,
      plannedEndDate: (p.planned_end_date as string | null) ?? null,
    })),
    today,
  );
  for (const ev of projectEvents) {
    await notify.notify({
      organizationId: ev.organizationId,
      recipientProfileId: ev.recipientId,
      type: ev.eventType,
      title: ev.eventType === "PROJECT_OVERDUE" ? "مشروع متأخر" : "اقتراب موعد مشروع",
      message: "راجع جدول المشروع داخل النظام.",
      entityType: "project",
      entityId: ev.entityId,
      priority: "high",
      dedupKey: ev.dedupKey,
      href: `/projects/${ev.entityId}`,
    });
    reminders += 1;
  }

  let deliveries = 0;
  const { data: claimed, error: claimErr } = await admin.rpc("claim_notification_deliveries", { p_limit: 25 });
  if (!claimErr && Array.isArray(claimed)) {
    const store = new MemoryHubStore();
    const orch = new NotificationOrchestrator(
      store,
      createEmailProvider(),
      createWhatsAppProvider(),
      createPushProvider(),
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
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
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name_ar, phone")
        .eq("id", row.recipient_profile_id)
        .maybeSingle();
      store.contacts.set(row.recipient_profile_id, {
        email: null,
        phone: profile?.phone ?? null,
        name: profile?.full_name_ar ?? null,
      });
      try {
        const user = await admin.auth.admin.getUserById(row.recipient_profile_id);
        store.contacts.set(row.recipient_profile_id, {
          email: user.data.user?.email ?? null,
          phone: profile?.phone ?? null,
          name: profile?.full_name_ar ?? null,
        });
      } catch {
        /* email lookup is best-effort */
      }
      const outcome = await orch.processDelivery(store.deliveries[0]);
      const patch: Record<string, unknown> = { updated_at: now.toISOString() };
      if (outcome === "sent") {
        patch.status = row.channel === "email" ? "sent" : "delivered";
        if (row.channel === "email") patch.sent_at = now.toISOString();
        else patch.delivered_at = now.toISOString();
        patch.next_attempt_at = null;
      } else if (outcome === "cancelled") {
        patch.status = "cancelled";
        patch.next_attempt_at = null;
        patch.last_error_code = "disabled";
      } else {
        patch.status = "failed";
        const next = nextRetryAt(row.attempt_count, now);
        patch.next_attempt_at = next ? next.toISOString() : null;
        patch.last_error_code = "transient";
      }
      await admin.from("notification_deliveries").update(patch).eq("id", row.id);
      deliveries += 1;
    }
  }

  if (options?.digestFacts) {
    const summary = await maybeAiDigestSummary(options.digestFacts);
    logger.info("management digest generated", { source: summary.source, length: summary.text.length });
  }

  return { ok: true, hubSchema: true, reminders, deliveries };
}
