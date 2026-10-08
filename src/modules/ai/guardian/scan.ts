import type { SupabaseClient } from "@supabase/supabase-js";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { evaluateRisksUncapped } from "@/modules/management/risk/engine";
import { createNotificationService } from "@/server/services/notification.service";
import { processPendingNotificationDeliveries } from "@/server/services/notification-delivery-worker";
import {
  findingSensitivityClass,
  HR_FINDING_PERMISSIONS,
  MANAGEMENT_VIEW_PERMISSIONS,
  PAYROLL_FINDING_PERMISSIONS,
  type GuardianSensitivityClass,
} from "./classification";
import { GUARDIAN_DETECTION_VERSION, GUARDIAN_JOB_NAME, GUARDIAN_STALE_LOCK_MS } from "./constants";
import { guardianWindowKey, isStaleGuardianLease, previousGuardianWindowKey } from "./jobs";
import { mergeGuardianFindings } from "./lifecycle";
import { emailPayloadForFinding, planGuardianNotifications } from "./notify";
import { findingToRow, isMissingGuardianSchema, rowToFinding, type AiFindingRow } from "./persist";
import {
  remainingOrganizationIds,
  shouldDispatchGuardianAlerts,
  shouldMarkGuardianWindowCompleted,
  shouldRecordBaseline,
} from "./scan-policy";
import { GUARDIAN_ALL_SECTIONS, loadGuardianRiskInput } from "./snapshot";
import type { DurableFinding } from "./types";

export type GuardianRunResult = {
  ok: boolean;
  skippedReason?: string;
  schemaReady: boolean;
  organizations: number;
  upserts: number;
  resolved: number;
  notifications: number;
  coverageComplete: boolean;
  missedPreviousWindow: boolean;
};

async function listActiveOrganizations(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from("organizations").select("id").eq("status", "active");
  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}

async function loadPreviousFindings(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ rows: DurableFinding[]; missing: boolean }> {
  const { data, error } = await admin
    .from("ai_findings")
    .select("*")
    .eq("organization_id", organizationId);
  if (error) {
    return { rows: [], missing: isMissingGuardianSchema(error.message) };
  }
  return { rows: (data as AiFindingRow[]).map(rowToFinding), missing: false };
}

async function recipientsByPermissionKeys(
  admin: SupabaseClient,
  organizationId: string,
  keys: readonly string[],
): Promise<string[]> {
  const { data: perms } = await admin.from("role_permissions").select("role_id").in("permission_key", [...keys]);
  const roleIds = [...new Set((perms ?? []).map((p) => p.role_id as string))];
  if (!roleIds.length) return [];
  const { data: grants } = await admin
    .from("user_roles")
    .select("profile_id")
    .eq("organization_id", organizationId)
    .in("role_id", roleIds);
  const ids = [...new Set((grants ?? []).map((g) => g.profile_id as string))];
  if (!ids.length) return [];
  const { data: members } = await admin
    .from("organization_members")
    .select("profile_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("profile_id", ids);
  const activeMembers = new Set((members ?? []).map((m) => m.profile_id as string));
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, is_active")
    .in("id", [...activeMembers])
    .eq("is_active", true);
  return (profiles ?? []).map((p) => p.id as string);
}

async function recipientsForClass(
  admin: SupabaseClient,
  organizationId: string,
  cls: GuardianSensitivityClass,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const cacheKey = `${organizationId}:${cls}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const management = await recipientsByPermissionKeys(admin, organizationId, MANAGEMENT_VIEW_PERMISSIONS);
  if (cls === "operations") {
    cache.set(cacheKey, management);
    return management;
  }
  const extraKeys = cls === "payroll" ? PAYROLL_FINDING_PERMISSIONS : HR_FINDING_PERMISSIONS;
  const extra = new Set(await recipientsByPermissionKeys(admin, organizationId, extraKeys));
  const filtered = management.filter((id) => extra.has(id));
  cache.set(cacheKey, filtered);
  return filtered;
}

async function loadGuardianSettings(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ alertsEnabled: boolean; baselineCompletedAt: string | null }> {
  const { data } = await admin
    .from("ai_guardian_settings")
    .select("alerts_enabled, baseline_completed_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return {
    alertsEnabled: Boolean(data?.alerts_enabled),
    baselineCompletedAt: (data?.baseline_completed_at as string | null) ?? null,
  };
}

async function claimWindow(
  admin: SupabaseClient,
  now: Date,
): Promise<{
  run: boolean;
  jobId: string | null;
  missedPrevious: boolean;
  processedOrganizationIds: string[];
  leaseGeneration: number;
  skip?: string;
}> {
  const windowKey = guardianWindowKey(now);
  const prevKey = previousGuardianWindowKey(now);
  const { data: prev } = await admin
    .from("notification_job_runs")
    .select("status")
    .eq("job_name", GUARDIAN_JOB_NAME)
    .eq("window_key", prevKey)
    .maybeSingle();
  const missedPrevious = !prev || prev.status !== "completed";

  const claimed = await admin.rpc("claim_guardian_job", {
    p_window_key: windowKey,
    p_stale_seconds: Math.round(GUARDIAN_STALE_LOCK_MS / 1000),
    p_details: { detection_version: GUARDIAN_DETECTION_VERSION },
  });
  if (claimed.error) {
    return {
      run: false,
      jobId: null,
      missedPrevious,
      processedOrganizationIds: [],
      leaseGeneration: 0,
      skip: "claim_conflict",
    };
  }
  const payload = (claimed.data ?? {}) as {
    run?: boolean;
    job_id?: string | null;
    skip?: string | null;
    lease_generation?: number;
    processed_organization_ids?: unknown;
  };
  const processedOrganizationIds = Array.isArray(payload.processed_organization_ids)
    ? payload.processed_organization_ids.filter((id): id is string => typeof id === "string")
    : [];
  return {
    run: Boolean(payload.run),
    jobId: payload.job_id ?? null,
    missedPrevious,
    processedOrganizationIds,
    leaseGeneration: typeof payload.lease_generation === "number" ? payload.lease_generation : 0,
    skip: payload.skip ?? undefined,
  };
}

export async function runGuardianScan(admin: SupabaseClient, now = new Date()): Promise<GuardianRunResult> {
  const probe = await admin.from("ai_findings").select("id").limit(1);
  if (probe.error && isMissingGuardianSchema(probe.error.message)) {
    return {
      ok: true,
      schemaReady: false,
      organizations: 0,
      upserts: 0,
      resolved: 0,
      notifications: 0,
      coverageComplete: true,
      missedPreviousWindow: false,
      skippedReason: "migration_084_unapplied",
    };
  }

  const claim = await claimWindow(admin, now);
  if (!claim.run) {
    return {
      ok: true,
      schemaReady: true,
      organizations: 0,
      upserts: 0,
      resolved: 0,
      notifications: 0,
      coverageComplete: true,
      missedPreviousWindow: claim.missedPrevious,
      skippedReason: claim.skip,
    };
  }

  const asOfDate = riyadhTodayYmd();
  const nowIso = now.toISOString();
  const orgIds = await listActiveOrganizations(admin);
  const pendingOrgIds = remainingOrganizationIds(orgIds, claim.processedOrganizationIds);
  let upserts = 0;
  let resolved = 0;
  let notifications = 0;
  const processed = [...claim.processedOrganizationIds];
  let coverageComplete = processed.length === orgIds.length;
  const recipientCache = new Map<string, string[]>();
  const notify = createNotificationService(admin);

  try {
    for (const organizationId of pendingOrgIds) {
      const previous = await loadPreviousFindings(admin, organizationId);
      if (previous.missing) {
        throw new Error("migration_084_unapplied");
      }

      const { input, coverage } = await loadGuardianRiskInput(
        admin,
        organizationId,
        asOfDate,
        nowIso,
        GUARDIAN_ALL_SECTIONS,
      );
      if (!coverage.complete) coverageComplete = false;
      const live = evaluateRisksUncapped(input);
      const merged = mergeGuardianFindings({
        previous: previous.rows,
        live,
        organizationId,
        nowIso,
        coverage,
      });

      const settings = await loadGuardianSettings(admin, organizationId);
      const recordBaseline =
        shouldRecordBaseline(coverage.complete) && !settings.baselineCompletedAt;
      const nextProcessed = coverage.complete ? [...processed, organizationId] : processed;
      const committed = await admin.rpc("guardian_commit_org_scan", {
        p_job_id: claim.jobId,
        p_lease_generation: claim.leaseGeneration,
        p_organization_id: organizationId,
        p_now: nowIso,
        p_upserts: merged.upserts.map(findingToRow),
        p_resolve_ids: merged.resolveIds,
        p_checkpoint: {
          last_organization_id: organizationId,
          processed_organization_ids: nextProcessed,
          coverageComplete,
        },
        p_record_baseline: recordBaseline,
      });
      if (committed.error) throw new Error(committed.error.message);
      if (coverage.complete) processed.push(organizationId);
      upserts += merged.upserts.length;
      resolved += merged.resolveIds.length;

      const dispatch = shouldDispatchGuardianAlerts({
        alertsEnabled: settings.alertsEnabled,
        baselineCompletedAt: settings.baselineCompletedAt,
      });

      const { data: stored } = await admin
        .from("ai_findings")
        .select("*")
        .eq("organization_id", organizationId)
        .in("status", ["open", "acknowledged", "in_review"]);
      const durable = ((stored ?? []) as AiFindingRow[]).map(rowToFinding);
      const plans = planGuardianNotifications({
        findings: durable,
        nowMs: now.getTime(),
        alertsEnabled: dispatch,
      });

      for (const plan of plans) {
        const finding = durable.find((f) => f.id === plan.findingId || f.dedupKey === plan.findingId);
        if (!finding) continue;
        const marked = await admin.rpc("guardian_mark_notified", {
          p_job_id: claim.jobId,
          p_lease_generation: claim.leaseGeneration,
          p_finding_id: finding.id,
          p_now: nowIso,
          p_email: plan.email,
        });
        if (marked.error) throw new Error(marked.error.message);
        const payload = emailPayloadForFinding(finding);
        const recipients = await recipientsForClass(
          admin,
          organizationId,
          findingSensitivityClass(finding.category),
          recipientCache,
        );
        for (const recipientProfileId of recipients) {
          await notify.notify({
            organizationId,
            recipientProfileId,
            type: plan.type,
            title: payload.title,
            message: payload.message,
            entityType: "ai_finding",
            entityId: finding.id,
            href: payload.href,
            priority: plan.type === "RISK_CRITICAL" ? "urgent" : "high",
            dedupKey: `${plan.type}:${finding.dedupKey}:${asOfDate}`,
          });
          notifications += 1;
        }
      }
    }

    coverageComplete = processed.length === orgIds.length;
    const windowComplete = shouldMarkGuardianWindowCompleted({ coverageComplete, failed: false });

    if (notifications > 0) {
      await processPendingNotificationDeliveries(admin, { limit: 25, now });
    }

    if (claim.jobId) {
      const finished = await admin.rpc("guardian_finish_job", {
        p_job_id: claim.jobId,
        p_lease_generation: claim.leaseGeneration,
        p_status: windowComplete ? "completed" : "failed",
        p_error_code: windowComplete ? null : "incomplete_coverage",
        p_details: { organizations: orgIds.length, upserts, resolved, coverageComplete, processed_organization_ids: processed },
      });
      if (finished.error) throw new Error(finished.error.message);
    }

    return {
      ok: true,
      schemaReady: true,
      organizations: orgIds.length,
      upserts,
      resolved,
      notifications,
      coverageComplete,
      missedPreviousWindow: claim.missedPrevious,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: string }).message)
          : String(error);
    if (isStaleGuardianLease(message)) {
      return {
        ok: true,
        schemaReady: true,
        organizations: orgIds.length,
        upserts,
        resolved,
        notifications,
        coverageComplete: false,
        missedPreviousWindow: claim.missedPrevious,
        skippedReason: "stale_guardian_lease",
      };
    }
    if (claim.jobId && claim.leaseGeneration > 0) {
      await admin.rpc("guardian_finish_job", {
        p_job_id: claim.jobId,
        p_lease_generation: claim.leaseGeneration,
        p_status: "failed",
        p_error_code: message.slice(0, 180),
        p_details: { processed_organization_ids: processed },
      });
    }
    throw error;
  }
}
