import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createNotificationService } from "@/server/services/notification.service";
import { createEmailProvider, createPushProvider, createWhatsAppProvider } from "@/modules/notifications/providers";
import { NotificationOrchestrator } from "@/modules/notifications/orchestrator";
import { MemoryHubStore } from "@/modules/notifications/memory-store";
import { buildApprovalReminderEvents, buildProjectDeadlineEvents } from "@/modules/notifications/scan";
import {
  buildWorkflowDeadlineEvents,
  formatOverdueSinceAr,
  formatRemainingAr,
  formatRiyadhDateTimeAr,
  uniqueProfileIds,
} from "@/modules/projects/deadline";
import { maybeAiDigestSummary, type DigestFacts } from "@/modules/notifications/digest";
import { nextRetryAt } from "@/modules/notifications/schedule";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { logger } from "@/lib/logger";

/**
 * Daily cron remains retry/recovery (`0 6 * * *`). W3 WhatsApp near-real-time
 * should await a bounded in-process claim/process for the persisted
 * notification_id (same admin client, SKIP LOCKED). Do not fire-and-forget HTTP.
 */

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

  const { data: wfSteps } = await admin
    .from("workflow_instance_steps")
    .select(
      "id, organization_id, instance_id, status, due_at, assigned_user_id, assigned_role_id, workflow_steps(name_ar, warning_hours)",
    )
    .in("status", ["ready", "in_progress"])
    .not("due_at", "is", null)
    .limit(200);

  const instanceIds = [...new Set((wfSteps ?? []).map((s) => s.instance_id as string))];
  const instanceById = new Map<string, { entity_type: string; entity_id: string; status: string }>();
  if (instanceIds.length) {
    const { data: instances } = await admin
      .from("workflow_instances")
      .select("id, entity_type, entity_id, status")
      .in("id", instanceIds);
    for (const inst of instances ?? []) {
      instanceById.set(inst.id as string, {
        entity_type: inst.entity_type as string,
        entity_id: inst.entity_id as string,
        status: inst.status as string,
      });
    }
  }

  const roleIds = [
    ...new Set(
      (wfSteps ?? [])
        .map((s) => s.assigned_role_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const holdersByRole = new Map<string, string[]>();
  if (roleIds.length) {
    const { data: grants } = await admin
      .from("user_roles")
      .select("role_id, profile_id, organization_id")
      .in("role_id", roleIds);
    const memberIds = [...new Set((grants ?? []).map((g) => g.profile_id as string))];
    const active = new Set<string>();
    if (memberIds.length) {
      const { data: members } = await admin
        .from("organization_members")
        .select("profile_id, organization_id, status")
        .in("profile_id", memberIds)
        .eq("status", "active");
      for (const m of members ?? []) active.add(`${m.organization_id}:${m.profile_id}`);
    }
    for (const g of grants ?? []) {
      const key = `${g.organization_id}:${g.profile_id}`;
      if (!active.has(key)) continue;
      const list = holdersByRole.get(g.role_id as string) ?? [];
      list.push(g.profile_id as string);
      holdersByRole.set(g.role_id as string, list);
    }
  }

  const projectIds = [
    ...new Set(
      (wfSteps ?? [])
        .map((s) => {
          const row = instanceById.get(s.instance_id as string);
          return row?.entity_type === "project" ? row.entity_id : null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const managerByProject = new Map<string, string | null>();
  if (projectIds.length) {
    const { data: projects } = await admin.from("projects").select("id, project_manager_id").in("id", projectIds);
    for (const p of projects ?? []) managerByProject.set(p.id as string, (p.project_manager_id as string | null) ?? null);
  }

  const nowIso = now.toISOString();
  const wfEvents = buildWorkflowDeadlineEvents(
    (wfSteps ?? []).flatMap((s) => {
      const row = instanceById.get(s.instance_id as string);
      if (row?.status === "completed" || row?.status === "cancelled") return [];
      const projectId = row?.entity_type === "project" ? row.entity_id : null;
      const def = s.workflow_steps as { name_ar?: string; warning_hours?: number | null } | { name_ar?: string; warning_hours?: number | null }[] | null;
      const defOne = Array.isArray(def) ? def[0] : def;
      const roleHolders = s.assigned_role_id ? (holdersByRole.get(s.assigned_role_id as string) ?? []) : [];
      return [
        {
          id: s.id as string,
          organizationId: s.organization_id as string,
          projectId,
          nameAr: defOne?.name_ar ?? "مرحلة",
          status: s.status as string,
          dueAt: (s.due_at as string | null) ?? null,
          warningHours: defOne?.warning_hours ?? null,
          recipientIds: uniqueProfileIds([
            s.assigned_user_id as string | null,
            ...roleHolders,
            projectId ? managerByProject.get(projectId) ?? null : null,
          ]),
        },
      ];
    }),
    nowIso,
  );

  for (const ev of wfEvents) {
    const dueLabel = formatRiyadhDateTimeAr(ev.dueAt);
    const remaining = formatRemainingAr(ev.dueAt, nowIso);
    const late = formatOverdueSinceAr(ev.dueAt, nowIso);
    const warning = ev.eventType === "workflow.step.deadline_warning";
    await notify.notify({
      organizationId: ev.organizationId,
      recipientProfileId: ev.recipientId,
      type: ev.eventType,
      title: warning ? "تنبيه: اقترب موعد انتهاء مرحلة" : "تنبيه تأخير مرحلة",
      message: warning
        ? `المرحلة: ${ev.nameAr} — موعد الإغلاق: ${dueLabel}${remaining ? ` — متبقي ${remaining}` : ""}`
        : `المرحلة: ${ev.nameAr} — كان موعد الإغلاق: ${dueLabel}${late ? ` — متأخرة منذ ${late}` : ""}`,
      entityType: ev.projectId ? "project" : "workflow_instance_step",
      entityId: ev.projectId ?? ev.entityId,
      href: ev.projectId ? `/projects/${ev.projectId}?tab=stages` : null,
      priority: warning ? "high" : "urgent",
      dedupKey: ev.dedupKey,
    });
    reminders += 1;
  }

  const overdueOrgs = [...new Set(wfEvents.filter((e) => e.eventType === "workflow.step.overdue").map((e) => e.organizationId))];
  for (const organizationId of overdueOrgs) {
    const sample = wfEvents.find((e) => e.organizationId === organizationId && e.eventType === "workflow.step.overdue");
    if (!sample) continue;
    await notify.notify({
      organizationId,
      recipientProfileId: sample.recipientId,
      type: "workflow.step.overdue.management",
      title: "تنبيه تأخير مرحلة",
      message: `المرحلة: ${sample.nameAr} — كان موعد الإغلاق: ${formatRiyadhDateTimeAr(sample.dueAt)}`,
      entityType: sample.projectId ? "project" : "workflow_instance_step",
      entityId: sample.projectId ?? sample.entityId,
      href: sample.projectId ? `/projects/${sample.projectId}?tab=stages` : null,
      priority: "urgent",
      dedupKey: `workflow.step.overdue.management:${sample.entityId}:${sample.dueAt}`,
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
        await admin
          .from("profiles")
          .select("full_name_ar, phone, whatsapp_opt_in")
          .eq("id", row.recipient_profile_id)
          .maybeSingle()
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
  }

  if (options?.digestFacts) {
    const summary = await maybeAiDigestSummary(options.digestFacts);
    logger.info("management digest generated", { source: summary.source, length: summary.text.length });
  }

  return { ok: true, hubSchema: true, reminders, deliveries };
}
