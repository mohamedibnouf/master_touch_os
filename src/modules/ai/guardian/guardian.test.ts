import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateRisks, evaluateRisksUncapped, emptyRiskInput } from "@/modules/management/risk/engine";
import { MANAGEMENT_RISK_RULES } from "@/modules/management/risk/rules";
import { MANAGEMENT_RISK_THRESHOLDS } from "@/modules/management/risk/thresholds";
import { canReadAiFinding, findingSensitivityClass, mayEmailFindingClass } from "./classification";
import { decideJobClaim, guardianWindowKey, isStaleGuardianLease, nextLeaseGeneration } from "./jobs";
import { mergeGuardianFindings, liveToDurableDraft } from "./lifecycle";
import { planGuardianNotifications } from "./notify";
import {
  emailPayloadForFinding,
  maySendCriticalEmail,
  sanitizeFindingEvidence,
  withinCooldown,
} from "./redact";
import {
  remainingOrganizationIds,
  shouldDispatchGuardianAlerts,
  shouldMarkGuardianWindowCompleted,
  shouldRecordBaseline,
} from "./scan-policy";
import { isAllowedGuardianTransition, reviewNoteRequired } from "./transitions";
import { findingVisibleForSections } from "./visibility";
import { GUARDIAN_ALL_SECTIONS } from "./snapshot";
import type { DurableFinding } from "./types";
import type { RiskFinding } from "@/modules/management/risk/types";

const ORG = "11111111-1111-1111-1111-111111111111";
const SRC = "22222222-2222-2222-2222-222222222222";

function live(partial: Partial<RiskFinding> = {}): RiskFinding {
  return {
    id: `PROJECT_PLANNED_END_OVERDUE:project:${SRC}`,
    ruleId: "PROJECT_PLANNED_END_OVERDUE",
    category: "PROJECT_DELAY",
    severity: "CRITICAL",
    titleAr: "تأخير",
    titleEn: "delay",
    explanationAr: "مشروع تجاوز التاريخ",
    explanationEn: "overdue",
    evidence: { overdue_days: 40, status: "active" },
    sourceType: "project",
    sourceId: SRC,
    href: `/projects/${SRC}`,
    effectiveSince: "2026-09-01",
    ageDays: 40,
    ...partial,
  };
}

function durable(partial: Partial<DurableFinding> = {}): DurableFinding {
  const draft = liveToDurableDraft(ORG, live(), "2026-10-08T12:00:00.000Z");
  return {
    ...draft,
    id: "33333333-3333-3333-3333-333333333333",
    ...partial,
  };
}

describe("guardian foundation", () => {
  it("registers all 22 management risk rules", () => {
    expect(MANAGEMENT_RISK_RULES).toHaveLength(22);
  });

  it("keeps the UI evaluator capped and the guardian evaluator uncapped", () => {
    const sections = { ...GUARDIAN_ALL_SECTIONS };
    const input = emptyRiskInput("2026-10-08", "2026-10-08T12:00:00.000Z", sections);
    input.projects = Array.from({ length: 160 }, (_, i) => ({
      id: `44444444-4444-4444-4444-${String(i).padStart(12, "0")}`,
      project_code: `P${i}`,
      name_ar: "م",
      status: "active",
      risk_level: "low",
      planned_end_date: "2026-01-01",
    }));
    const capped = evaluateRisks(input);
    const full = evaluateRisksUncapped(input);
    expect(capped.length).toBe(MANAGEMENT_RISK_THRESHOLDS.maxFindings);
    expect(full.length).toBeGreaterThan(MANAGEMENT_RISK_THRESHOLDS.maxFindings);
  });

  it("preserves dismissed rows on upsert instead of reopening them", () => {
    const prev = durable({ status: "dismissed", firstSeenAt: "2026-10-01T00:00:00.000Z" });
    const merged = mergeGuardianFindings({
      previous: [prev],
      live: [live()],
      organizationId: ORG,
      nowIso: "2026-10-08T12:00:00.000Z",
      coverage: { complete: true, truncatedFamilies: [] },
    });
    expect(merged.upserts[0]?.status).toBe("dismissed");
    expect(merged.resolveIds).toEqual([]);
  });

  it("does not duplicate live hits and preserves acknowledgment", () => {
    const prev = durable({ status: "acknowledged", firstSeenAt: "2026-10-01T00:00:00.000Z" });
    const merged = mergeGuardianFindings({
      previous: [prev],
      live: [live()],
      organizationId: ORG,
      nowIso: "2026-10-08T12:00:00.000Z",
      coverage: { complete: true, truncatedFamilies: [] },
    });
    expect(merged.upserts).toHaveLength(1);
    expect(merged.upserts[0]?.status).toBe("acknowledged");
    expect(merged.upserts[0]?.firstSeenAt).toBe("2026-10-01T00:00:00.000Z");
    expect(merged.resolveIds).toEqual([]);
  });

  it("does not resolve omitted rows on a partial scan", () => {
    const prev = durable({ status: "open" });
    const merged = mergeGuardianFindings({
      previous: [prev],
      live: [],
      organizationId: ORG,
      nowIso: "2026-10-08T12:00:00.000Z",
      coverage: { complete: false, truncatedFamilies: ["projects"] },
    });
    expect(merged.resolveIds).toEqual([]);
  });

  it("resolves cleared rows only after a complete scan", () => {
    const prev = durable({ status: "open" });
    const merged = mergeGuardianFindings({
      previous: [prev],
      live: [],
      organizationId: ORG,
      nowIso: "2026-10-08T12:00:00.000Z",
      coverage: { complete: true, truncatedFamilies: [] },
    });
    expect(merged.resolveIds).toEqual([prev.id]);
  });

  it("reopens a resolved finding when the source condition is still true", () => {
    const prev = durable({ status: "resolved", resolvedAt: "2026-10-07T00:00:00.000Z" });
    const merged = mergeGuardianFindings({
      previous: [prev],
      live: [live()],
      organizationId: ORG,
      nowIso: "2026-10-08T12:00:00.000Z",
      coverage: { complete: true, truncatedFamilies: [] },
    });
    expect(merged.upserts[0]?.status).toBe("open");
  });

  it("skips duplicate cron windows and takes over stale locks", () => {
    expect(
      decideJobClaim({
        existing: { status: "completed", startedAt: "2026-10-08T10:00:00.000Z" },
        nowMs: Date.parse("2026-10-08T10:10:00.000Z"),
      }),
    ).toBe("skip_completed");
    expect(
      decideJobClaim({
        existing: { status: "running", startedAt: "2026-10-08T10:00:00.000Z" },
        nowMs: Date.parse("2026-10-08T10:05:00.000Z"),
      }),
    ).toBe("skip_running");
    expect(
      decideJobClaim({
        existing: { status: "running", startedAt: "2026-10-08T08:00:00.000Z" },
        nowMs: Date.parse("2026-10-08T10:00:00.000Z"),
      }),
    ).toBe("takeover");
    expect(guardianWindowKey(new Date("2026-10-08T15:30:00.000Z"))).toBe("guardian:2026-10-08T15Z");
    expect(nextLeaseGeneration(1)).toBe(2);
    expect(isStaleGuardianLease("stale_guardian_lease")).toBe(true);
    expect(isStaleGuardianLease("other")).toBe(false);
  });

  it("emails CRITICAL rule findings and never emails model speculation", () => {
    const rule = durable({ detector: "rule", severity: "CRITICAL", lastEmailNotifiedAt: null });
    const model = durable({
      id: "55555555-5555-5555-5555-555555555555",
      detector: "model",
      severity: "CRITICAL",
      lastEmailNotifiedAt: null,
    });
    expect(maySendCriticalEmail(rule)).toBe(true);
    expect(maySendCriticalEmail(model)).toBe(false);
    const plans = planGuardianNotifications({
      findings: [rule, model],
      nowMs: Date.parse("2026-10-08T12:00:00.000Z"),
      alertsEnabled: true,
    });
    expect(plans.some((p) => p.type === "RISK_CRITICAL" && p.email)).toBe(true);
    expect(plans.every((p) => p.findingId !== model.id || p.email === false)).toBe(true);
    expect(emailPayloadForFinding(rule).message).not.toMatch(/iban|iqama|passport|net_pay|employee_id/i);
  });

  it("holds HIGH email until the escalation delay elapses", () => {
    const fresh = durable({
      detector: "rule",
      severity: "HIGH",
      firstSeenAt: "2026-10-08T12:00:00.000Z",
      lastInAppNotifiedAt: null,
      lastEmailNotifiedAt: null,
    });
    const aged = durable({
      ...fresh,
      firstSeenAt: "2026-10-08T06:00:00.000Z",
    });
    const now = Date.parse("2026-10-08T12:00:00.000Z");
    const freshPlan = planGuardianNotifications({ findings: [fresh], nowMs: now, alertsEnabled: true });
    const agedPlan = planGuardianNotifications({ findings: [aged], nowMs: now, alertsEnabled: true });
    expect(freshPlan[0]?.email).toBe(false);
    expect(freshPlan[0]?.inApp).toBe(true);
    expect(agedPlan[0]?.email).toBe(true);
  });

  it("enforces notification cooldown", () => {
    expect(withinCooldown("2026-10-08T10:00:00.000Z", Date.parse("2026-10-08T12:00:00.000Z"), 24 * 3600_000)).toBe(true);
    expect(withinCooldown("2026-10-01T10:00:00.000Z", Date.parse("2026-10-08T12:00:00.000Z"), 24 * 3600_000)).toBe(false);
  });

  it("redacts employee keys from evidence", () => {
    expect(sanitizeFindingEvidence({ overdue_days: 3, employee_id: SRC, iqama: "123" })).toEqual({ overdue_days: 3 });
  });

  it("hides payroll findings without payroll section", () => {
    expect(findingVisibleForSections("PAYROLL", { ...GUARDIAN_ALL_SECTIONS, payroll: false })).toBe(false);
    expect(findingVisibleForSections("PROJECT_DELAY", { ...GUARDIAN_ALL_SECTIONS, payroll: false })).toBe(true);
  });

  it("does not call OpenAI or mutate payroll/workflow from guardian modules", () => {
    const scan = readFileSync("src/modules/ai/guardian/scan.ts", "utf8");
    const route = readFileSync("src/app/api/internal/guardian/run/route.ts", "utf8");
    expect(scan).not.toContain("createOpenAIProvider");
    expect(scan).not.toContain("explainManagementInsights");
    expect(scan).not.toContain("complete_workflow_step");
    expect(scan).not.toContain("calculate_payroll_period");
    expect(route).toContain("isNotificationsCronAuthorized");
    expect(readFileSync("vercel.json", "utf8")).toContain("/api/internal/notifications/run");
    expect(readFileSync("vercel.json", "utf8")).toContain("/api/internal/guardian/run");
  });

  it("locks ai_findings down in the additive migration", () => {
    const sql = readFileSync("supabase/migrations/084_ai_findings_guardian.sql", "utf8");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("can_read_ai_finding");
    expect(sql).toContain("revoke all on table public.ai_findings from public, anon, authenticated");
    expect(sql).toContain("grant select on table public.ai_findings to authenticated");
    expect(sql).not.toMatch(/grant (insert|update|delete|all) on table public\.ai_findings to authenticated/i);
    expect(sql).toContain("detector in ('rule', 'model')");
    expect(sql).not.toContain("grant select on table public.ai_findings to anon");
  });
});

describe("guardian security gate", () => {
  const sql = readFileSync("supabase/migrations/084_ai_findings_guardian.sql", "utf8");
  const sql062 = readFileSync("supabase/migrations/062_phase5_notification_communication_hub.sql", "utf8");

  it("separates HR and payroll findings from management-only SELECT", () => {
    expect(canReadAiFinding({
      category: "PROJECT_DELAY",
      hasManagementView: true,
      hasPayrollAuthorization: false,
      hasHrAuthorization: false,
    })).toBe(true);
    expect(canReadAiFinding({
      category: "PAYROLL",
      hasManagementView: true,
      hasPayrollAuthorization: false,
      hasHrAuthorization: true,
    })).toBe(false);
    expect(canReadAiFinding({
      category: "ATTENDANCE",
      hasManagementView: true,
      hasPayrollAuthorization: true,
      hasHrAuthorization: false,
    })).toBe(false);
    expect(canReadAiFinding({
      category: "PAYROLL",
      hasManagementView: false,
      hasPayrollAuthorization: true,
      hasHrAuthorization: true,
    })).toBe(false);
    expect(findingSensitivityClass("COMPLIANCE")).toBe("hr");
    expect(sql).toMatch(/when p_category = 'PAYROLL' then/);
    expect(sql).toMatch(/payroll\.view_all/);
    expect(sql).toMatch(/attendance\.view_all/);
    expect(sql).toContain("using (public.can_read_ai_finding(organization_id, category))");
    expect(sql).toContain("is_organization_member");
  });

  it("never grants cross-org SELECT: membership is required before management view", () => {
    expect(sql).toContain("select public.is_organization_member(p_organization_id)");
    expect(sql).toContain("has_management_ai_view");
  });

  it("blocks authenticated PostgREST UPDATE of identity and evidence columns", () => {
    expect(sql).toContain("ai_findings identity columns are immutable");
    expect(sql).toContain("ai_findings row updates must use review_ai_finding()");
    expect(sql).not.toContain("ai.guardian.mutating");
    expect(sql).not.toMatch(/set_config\('ai\.guardian/);
    expect(sql).toContain("if current_user not in ('postgres', 'supabase_admin')");
    expect(sql).toContain("for update");
    expect(sql).toContain("claim_guardian_job");
    expect(sql).toContain("lease_generation");
    expect(sql).toContain("stale_guardian_lease");
    expect(sql).toContain("guardian_commit_org_scan");
    expect(sql).toContain("guardian_finish_job");
    expect(sql).toContain("revoke all on function public.claim_guardian_job(text, integer, jsonb) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.claim_guardian_job(text, integer, jsonb) to service_role");
    expect(sql).toContain("new.evidence := old.evidence");
    expect(sql).toContain("new.severity := old.severity");
    expect(sql).toContain("new.detector := old.detector");
    expect(sql).toContain("new.dedup_key is distinct from old.dedup_key");
    expect(sql).not.toContain("create policy ai_findings_update");
    expect(sql).toContain("drop policy if exists ai_findings_update");
    expect(sql).toContain("drop policy if exists ai_findings_insert");
    expect(sql).toContain("grant execute on function public.review_ai_finding(uuid, text, text) to authenticated");
  });

  it("validates review transitions and requires dismiss/resolve notes", () => {
    expect(isAllowedGuardianTransition("open", "acknowledged")).toBe(true);
    expect(isAllowedGuardianTransition("open", "in_review")).toBe(true);
    expect(isAllowedGuardianTransition("resolved", "open")).toBe(false);
    expect(isAllowedGuardianTransition("dismissed", "acknowledged")).toBe(false);
    expect(reviewNoteRequired("dismissed")).toBe(true);
    expect(reviewNoteRequired("resolved")).toBe(true);
    expect(reviewNoteRequired("acknowledged")).toBe(false);
    expect(sql).toContain("invalid finding transition");
    expect(sql).toContain("dismiss requires a reason");
    expect(sql).toContain("resolve requires a verification note");
    expect(sql).toContain("perform public.log_audit(");
    expect(sql).toContain("'guardian.finding.status'");
  });

  it("does not treat partial or failed scans as complete coverage", () => {
    expect(shouldMarkGuardianWindowCompleted({ coverageComplete: false, failed: false })).toBe(false);
    expect(shouldMarkGuardianWindowCompleted({ coverageComplete: true, failed: true })).toBe(false);
    expect(shouldMarkGuardianWindowCompleted({ coverageComplete: true, failed: false })).toBe(true);
    expect(shouldRecordBaseline(false)).toBe(false);
    expect(remainingOrganizationIds(["a", "b"], ["a"])).toEqual(["b"]);
    expect(readFileSync("src/modules/ai/guardian/scan.ts", "utf8")).toContain("processed_organization_ids");
    expect(readFileSync("src/modules/ai/guardian/scan.ts", "utf8")).toContain('rpc("claim_guardian_job"');
    expect(readFileSync("src/modules/ai/guardian/scan.ts", "utf8")).toContain('rpc("guardian_commit_org_scan"');
    expect(readFileSync("src/modules/ai/guardian/scan.ts", "utf8")).toContain("stale_guardian_lease");
  });

  it("keeps baseline scans silent until alerts are explicitly enabled", () => {
    expect(shouldDispatchGuardianAlerts({ alertsEnabled: false, baselineCompletedAt: "2026-10-08T12:00:00.000Z" })).toBe(false);
    expect(shouldDispatchGuardianAlerts({ alertsEnabled: true, baselineCompletedAt: null })).toBe(false);
    expect(shouldDispatchGuardianAlerts({ alertsEnabled: true, baselineCompletedAt: "2026-10-08T12:00:00.000Z" })).toBe(true);
    const storm = planGuardianNotifications({
      findings: [durable({ detector: "rule", severity: "CRITICAL" })],
      nowMs: Date.parse("2026-10-08T12:00:00.000Z"),
      alertsEnabled: false,
    });
    expect(storm).toEqual([]);
    expect(sql).toContain("alerts_enabled boolean not null default false");
    expect(sql).toContain("baseline scan required before enabling alerts");
  });

  it("never emails payroll or attendance findings even after activation", () => {
    expect(mayEmailFindingClass("PAYROLL")).toBe(false);
    expect(mayEmailFindingClass("ATTENDANCE")).toBe(false);
    const payroll = durable({
      category: "PAYROLL",
      ruleId: "PAYROLL_UNPAID_ENTRIES",
      detector: "rule",
      severity: "CRITICAL",
    });
    const plans = planGuardianNotifications({
      findings: [payroll],
      nowMs: Date.parse("2026-10-08T12:00:00.000Z"),
      alertsEnabled: true,
    });
    expect(plans[0]?.email).toBe(false);
    expect(emailPayloadForFinding(payroll).message).not.toMatch(/iban|iqama|passport|net_pay|employee_id/i);
    expect(emailPayloadForFinding(payroll).title).not.toMatch(/PAYROLL|unpaid/i);
  });

  it("deduplicates notifications and preserves the daily Resend cron", () => {
    const vercel = readFileSync("vercel.json", "utf8");
    expect(vercel).toContain("/api/internal/notifications/run");
    expect(vercel).toContain("/api/internal/guardian/run");
    expect(vercel).toContain("0 6 * * *");
    expect(vercel).toContain("0 * * * *");
    expect(sql062).toContain("unique (job_name, window_key)");
    expect(sql).toContain("add column if not exists details jsonb");
    expect(sql).not.toContain("drop table public.notification_job_runs");
    const actions = readFileSync("src/server/use-cases/guardian-actions.ts", "utf8");
    expect(actions).toContain('rpc("review_ai_finding"');
    expect(actions).not.toContain('.from("ai_findings")');
    expect(actions).toContain('rpc("enable_guardian_alerts"');
  });

  it("hardens function search_path and evidence keys", () => {
    const definerFns = sql.match(/security definer/g) ?? [];
    expect(definerFns.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain("employee_id");
    expect(sql).toContain("ai_findings_evidence_no_restricted_keys_chk");
  });
});
