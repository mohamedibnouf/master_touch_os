"use server";

import "server-only";

import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildDecisionBrief } from "@/modules/management/reports/decision-brief";
import { buildExecutiveReport, buildProjectReport, buildOperationsReport } from "@/modules/management/reports/builders";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import {
  buildManagementAIContext,
  filterRisksForMode,
  getManagementAIConfig,
  managementAIRequestSchema,
  runManagementAIAnalysis,
  type ManagementAIResult,
} from "@/modules/management/ai";
import { createManagementAIProvider } from "@/modules/management/ai/config";
import { assertManagementAIRateLimit } from "@/modules/management/ai/rate-limit";
import { ForbiddenError, UnauthorizedError, ValidationError, isAppError } from "@/lib/errors";

export type AnalyzeManagementActionResult =
  | { ok: true; result: ManagementAIResult }
  | { ok: false; error: string; code?: string };

export async function analyzeManagementAction(input: unknown): Promise<AnalyzeManagementActionResult> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();
    if (!canViewManagement(ctx)) throw new ForbiddenError();

    const parsed = managementAIRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("طلب التحليل غير صالح.", "Invalid analysis request.", {
        issues: parsed.error.issues.slice(0, 5),
      });
    }

    const { mode, locale } = parsed.data;
    let question = parsed.data.question ?? null;
    if (mode === "free_question" && !question) {
      throw new ValidationError("أدخل سؤالاً.", "Please enter a question.");
    }
    if (mode !== "free_question") {
      // Suggested modes use canned prompts; ignore arbitrary browser question text for modes.
      question = null;
    }

    assertManagementAIRateLimit(ctx.profile.id);

    const cfg = getManagementAIConfig();
    const provider = createManagementAIProvider();
    if (!cfg.enabled || !provider) {
      return {
        ok: false,
        code: "AI_UNAVAILABLE",
        error:
          locale === "en"
            ? "Management AI is not configured. Set MANAGEMENT_AI_PROVIDER (mock|openai) on the server."
            : "محلل الإدارة غير مُعدّ. عيّن MANAGEMENT_AI_PROVIDER (mock|openai) على الخادم.",
      };
    }

    const sections = resolveManagementSections(ctx);
    const supabase = await createServerSupabaseClient();
    const repo = new ManagementRepository(supabase);
    const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);
    const reportCtx = createReportContext(ctx, sections);
    const executive = buildExecutiveReport({ context: reportCtx, snapshot });

    const today = riyadhTodayYmd();
    const riskInput = await repo.loadRiskInputSnapshot(
      ctx.organization.id,
      sections,
      today,
      new Date().toISOString(),
    );
    const projectReport = sections.projects
      ? buildProjectReport({ context: reportCtx, snapshot, riskInput })
      : null;
    const opsReport =
      sections.approvals || sections.procurement
        ? buildOperationsReport({ context: reportCtx, snapshot, riskInput })
        : null;

    const filteredRisks = filterRisksForMode(snapshot.risks, mode);
    const scopedSnapshot = { ...snapshot, risks: filteredRisks };

    const aiContext = buildManagementAIContext({
      mode,
      question,
      locale,
      snapshot: scopedSnapshot,
      decisionBrief: buildDecisionBrief({
        snapshot: scopedSnapshot,
        sections: {
          projects: sections.projects,
          approvals: sections.approvals,
          procurement: sections.procurement,
          finance: sections.finance,
          people: sections.people,
          attendanceLeave: sections.attendanceLeave,
          payroll: sections.payroll,
        },
      }),
      metrics: executive.metrics,
      organizationNameAr: ctx.organization.name_ar,
      organizationNameEn: ctx.organization.name_en,
      asOfDate: snapshot.asOfDate,
      generatedAt: reportCtx.generatedAt,
      projectOverdue: projectReport?.overdueProjects,
      oldestApprovals: opsReport?.oldestApprovals,
    });

    const result = await runManagementAIAnalysis({ provider, context: aiContext });
    return { ok: true, result };
  } catch (e) {
    if (isAppError(e)) {
      return { ok: false, code: e.code, error: e.userMessageAr };
    }
    return {
      ok: false,
      code: "INTERNAL",
      error: "حدث خطأ غير متوقع أثناء التحليل.",
    };
  }
}

export async function getManagementAIStatusAction(): Promise<{
  enabled: boolean;
  provider: string;
  model: string | null;
}> {
  const cfg = getManagementAIConfig();
  return { enabled: cfg.enabled, provider: cfg.provider, model: cfg.model };
}
