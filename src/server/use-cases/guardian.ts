import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { runGuardianScan, type GuardianRunResult } from "@/modules/ai/guardian/scan";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { findingVisibleForSections } from "@/modules/ai/guardian/visibility";
import { isMissingGuardianSchema, rowToFinding, type AiFindingRow } from "@/modules/ai/guardian/persist";
import type { DurableFinding } from "@/modules/ai/guardian/types";
import { GUARDIAN_JOB_NAME } from "@/modules/ai/guardian/constants";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

export async function runGuardianJobs(): Promise<GuardianRunResult> {
  const admin = createAdminSupabaseClient();
  return runGuardianScan(admin);
}

export async function loadGuardianFindingsForViewer(): Promise<{
  schemaReady: boolean;
  findings: DurableFinding[];
  lastScan: { finishedAt: string | null; status: string | null; coverageComplete: boolean | null };
  alerts: { enabled: boolean; baselineCompletedAt: string | null };
}> {
  const ctx = await getAuthContext();
  if (!ctx) throw new UnauthorizedError();
  if (!ctx.profile.is_active || ctx.membershipStatus !== "active") throw new ForbiddenError();
  if (!canViewManagement(ctx)) throw new ForbiddenError();

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ai_findings")
    .select("*")
    .eq("organization_id", ctx.organization.id)
    .order("severity", { ascending: true })
    .order("last_seen_at", { ascending: false })
    .limit(400);

  const emptyAlerts = { enabled: false, baselineCompletedAt: null };
  if (error && isMissingGuardianSchema(error.message)) {
    return {
      schemaReady: false,
      findings: [],
      lastScan: { finishedAt: null, status: null, coverageComplete: null },
      alerts: emptyAlerts,
    };
  }
  if (error) {
    return {
      schemaReady: false,
      findings: [],
      lastScan: { finishedAt: null, status: null, coverageComplete: null },
      alerts: emptyAlerts,
    };
  }

  const sections = resolveManagementSections(ctx);
  const findings = ((data ?? []) as AiFindingRow[])
    .map(rowToFinding)
    .filter((row) => findingVisibleForSections(row.category, sections));

  const { data: job } = await supabase
    .from("notification_job_runs")
    .select("status, finished_at, details")
    .eq("job_name", GUARDIAN_JOB_NAME)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const details = (job?.details ?? {}) as { coverageComplete?: boolean };
  const { data: settings } = await supabase
    .from("ai_guardian_settings")
    .select("alerts_enabled, baseline_completed_at")
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  return {
    schemaReady: true,
    findings,
    lastScan: {
      finishedAt: (job?.finished_at as string | null) ?? null,
      status: (job?.status as string | null) ?? null,
      coverageComplete: typeof details.coverageComplete === "boolean" ? details.coverageComplete : null,
    },
    alerts: {
      enabled: Boolean(settings?.alerts_enabled),
      baselineCompletedAt: (settings?.baseline_completed_at as string | null) ?? null,
    },
  };
}
