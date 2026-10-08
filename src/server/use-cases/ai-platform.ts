"use server";

import "server-only";

import { getAuthContext } from "@/server/context";
import { requireUser } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  isAppError,
} from "@/lib/errors";
import { AuditService } from "@/server/services/audit.service";
import { logger } from "@/lib/logger";
import { getAiPlatformConfig, createPlatformAiProvider } from "@/modules/ai/config";
import { aiRuntimeConfigSnapshot } from "@/modules/ai/config-env";
import { canAnalyzeProjectAi, canUseAiCapability, canViewManagementAi } from "@/modules/ai/security/permissions";
import { assertAiRateLimit, withAiInflight } from "@/modules/ai/security/rate-limit";
import { mapToAiClientError, AI_ERROR_MESSAGE_AR } from "@/modules/ai/errors";
import { isAiProviderFailureCode } from "@/modules/ai/provider-errors";
import {
  assistantRequestSchema,
  documentIdRequestSchema,
  projectIdRequestSchema,
} from "@/modules/ai/schemas";
import { buildProjectIntelligence } from "@/modules/ai/services/project-intelligence";
import { answerProjectAssistant } from "@/modules/ai/services/assistant";
import { buildExecutiveReportAi } from "@/modules/ai/services/executive-report";
import { analyzeDocumentText } from "@/modules/ai/services/document-analysis";
import { explainManagementInsights } from "@/modules/ai/services/management-insights";
import { persistAiRun, hashAiInput } from "@/modules/ai/cache";
import { estimateChars } from "@/modules/ai/security/sanitize";
import { extractAuthorizedDocumentText } from "@/server/use-cases/document-ai-source";
import { loadAuthorizedProjectAiFacts } from "@/server/use-cases/ai-project-context";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { AI_DISCLAIMER_AR } from "@/modules/ai/limits";
import type { ProjectIntelligenceView } from "@/modules/ai/schemas";
import type { ExecutiveReport } from "@/modules/ai/schemas";
import type { AssistantAnswer } from "@/modules/ai/schemas";
import type { BusinessCaseAnalysis, DocumentAnalysis } from "@/modules/ai/schemas";
import type { ManagementInsight, ManagementInsightFacts } from "@/modules/ai/schemas";
import type { DocumentSourceClass } from "@/modules/ai/classify-source";

export type AiActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string };

function fail(error: unknown): AiActionResult<never> {
  if (isAppError(error) && error.details?.aiCode === "AI_DISABLED") {
    return { ok: false, code: "AI_DISABLED", error: AI_ERROR_MESSAGE_AR.AI_DISABLED };
  }
  const mapped = mapToAiClientError(error);
  const detailCode =
    isAppError(error) && typeof error.details?.aiCode === "string" ? String(error.details.aiCode) : null;
  return { ok: false, code: detailCode && detailCode !== "AI_DISABLED" ? detailCode : mapped.code, error: mapped.message };
}

async function requireAiActor() {
  return requireUser(await getAuthContext());
}

export async function getAiPlatformStatusAction(): Promise<{
  enabled: boolean;
  provider: string;
  model: string | null;
}> {
  const cfg = getAiPlatformConfig();
  return { enabled: cfg.enabled, provider: cfg.provider, model: cfg.model };
}

export async function analyzeProjectIntelligenceAction(input: unknown): Promise<
  AiActionResult<ProjectIntelligenceView>
> {
  const started = Date.now();
  try {
    const ctx = await requireAiActor();
    if (!canAnalyzeProjectAi(ctx)) throw new ForbiddenError();
    const parsed = projectIdRequestSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("معرّف المشروع غير صالح.", "Invalid project id.");

    const cfg = getAiPlatformConfig();
    const provider = createPlatformAiProvider();
    if (!cfg.enabled || !provider) {
      return { ok: false, code: "AI_DISABLED", error: AI_ERROR_MESSAGE_AR.AI_DISABLED };
    }

    assertAiRateLimit(ctx.profile.id, "analysis");
    const supabase = await createServerSupabaseClient();

    return await withAiInflight(`intel:${ctx.profile.id}:${parsed.data.projectId}`, async () => {
      const facts = await loadAuthorizedProjectAiFacts({
        supabase,
        ctx,
        projectId: parsed.data.projectId,
      });
      const forceRefresh = Boolean((input as { refresh?: boolean }).refresh);
      const view = await buildProjectIntelligence({ provider, facts, actor: ctx, forceRefresh });
      await persistAiRun({
        supabase,
        organizationId: ctx.organization.id,
        actorUserId: ctx.profile.id,
        projectId: facts.projectId,
        analysisType: "project_intelligence",
        provider: provider.id,
        model: provider.model,
        promptVersion: view.promptVersion,
        status: "succeeded",
        latencyMs: Date.now() - started,
        inputChars: estimateChars(facts),
        outputChars: estimateChars(view.intelligence),
        promptTokens: null,
        completionTokens: null,
        artifactKind: "project_intelligence",
        artifact: view.intelligence,
        inputHash: hashAiInput(facts.projectId),
      });
      await new AuditService(supabase).log({
        organizationId: ctx.organization.id,
        action: "ai.project.analyzed",
        entityType: "project",
        entityId: facts.projectId,
        newValues: { analysis_type: "project_intelligence", status: "succeeded" },
      });
      logger.info("ai.run", {
        operation: "project_intelligence",
        analysisType: "project_intelligence",
        provider: provider.id,
        model: provider.model,
        latency: Date.now() - started,
        success: true,
      });
      return { ok: true as const, data: view };
    });
  } catch (e) {
    logger.info("ai.run", { operation: "project_intelligence", success: false });
    return fail(e);
  }
}

export async function askProjectAssistantAction(input: unknown): Promise<
  AiActionResult<AssistantAnswer & { disclaimerAr: string }>
> {
  try {
    const ctx = await requireAiActor();
    if (!canAnalyzeProjectAi(ctx)) throw new ForbiddenError();
    const parsed = assistantRequestSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("طلب المساعد غير صالح.", "Invalid assistant request.");

    const cfg = getAiPlatformConfig();
    const provider = createPlatformAiProvider();
    if (!cfg.enabled || !provider) {
      return { ok: false, code: "AI_DISABLED", error: AI_ERROR_MESSAGE_AR.AI_DISABLED };
    }

    assertAiRateLimit(ctx.profile.id, "assistant");
    const supabase = await createServerSupabaseClient();
    const facts = await loadAuthorizedProjectAiFacts({
      supabase,
      ctx,
      projectId: parsed.data.projectId,
    });
    const answer = await answerProjectAssistant({
      provider,
      facts,
      question: parsed.data.question,
      history: parsed.data.history,
    });
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "ai.assistant.queried",
      entityType: "project",
      entityId: facts.projectId,
      newValues: { analysis_type: "assistant", status: "succeeded" },
    });
    return { ok: true, data: { answer_ar: answer.answer_ar, out_of_scope: answer.out_of_scope, disclaimerAr: answer.disclaimerAr } };
  } catch (e) {
    return fail(e);
  }
}

export async function generateExecutiveReportAction(input: unknown): Promise<
  AiActionResult<{ report: ExecutiveReport; cached: boolean; disclaimerAr: string }>
> {
  const started = Date.now();
  try {
    const ctx = await requireAiActor();
    if (!canUseAiCapability(ctx, "ai.report.generate") || !hasPermission(ctx, "project.read")) {
      throw new ForbiddenError();
    }
    const parsed = projectIdRequestSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("معرّف المشروع غير صالح.", "Invalid project id.");

    const cfg = getAiPlatformConfig();
    const provider = createPlatformAiProvider();
    if (!cfg.enabled || !provider) {
      return { ok: false, code: "AI_DISABLED", error: AI_ERROR_MESSAGE_AR.AI_DISABLED };
    }

    assertAiRateLimit(ctx.profile.id, "report");
    const supabase = await createServerSupabaseClient();
    const facts = await loadAuthorizedProjectAiFacts({
      supabase,
      ctx,
      projectId: parsed.data.projectId,
    });
    const result = await buildExecutiveReportAi({
      provider,
      facts,
      organizationId: ctx.organization.id,
      forceRefresh: Boolean((input as { refresh?: boolean }).refresh),
    });
    await persistAiRun({
      supabase,
      organizationId: ctx.organization.id,
      actorUserId: ctx.profile.id,
      projectId: facts.projectId,
      analysisType: "executive_report",
      provider: provider.id,
      model: provider.model,
      promptVersion: "executive-report:v1",
      status: "succeeded",
      latencyMs: Date.now() - started,
      inputChars: estimateChars(facts),
      outputChars: estimateChars(result.report),
      promptTokens: null,
      completionTokens: null,
      artifactKind: "executive_report",
      artifact: result.report,
    });
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "ai.report.generated",
      entityType: "project",
      entityId: facts.projectId,
      newValues: { analysis_type: "executive_report", status: "succeeded" },
    });
    return { ok: true, data: result };
  } catch (e) {
    return fail(e);
  }
}

export async function analyzeDocumentAiAction(input: unknown): Promise<
  AiActionResult<{
    document?: DocumentAnalysis;
    businessCase?: BusinessCaseAnalysis;
    cached: boolean;
    disclaimerAr: string;
    sourceClass: DocumentSourceClass;
  }>
> {
  const started = Date.now();
  let persistFailure:
    | {
        supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
        organizationId: string;
        actorUserId: string;
        projectId: string | null;
        documentId: string;
        providerId: string;
        model: string | null;
        analysisType: string;
      }
    | null = null;
  try {
    const ctx = await requireAiActor();
    if (!canUseAiCapability(ctx, "ai.document.analyze")) throw new ForbiddenError();
    if (!hasPermission(ctx, "document.read") && !hasPermission(ctx, "document_control.read")) {
      throw new ForbiddenError();
    }
    const parsed = documentIdRequestSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError("معرّف المستند غير صالح.", "Invalid document id.");

    const cfg = getAiPlatformConfig();
    const provider = createPlatformAiProvider();
    logger.warn("ai.config.runtime", { ...aiRuntimeConfigSnapshot(), operation: "document_analysis" });
    if (!cfg.enabled || !provider) {
      return { ok: false, code: "AI_DISABLED", error: AI_ERROR_MESSAGE_AR.AI_DISABLED };
    }

    assertAiRateLimit(ctx.profile.id, "analysis");
    const supabase = await createServerSupabaseClient();
    const { data: doc } = await supabase
      .from("documents")
      .select("id, organization_id, project_id, title, category, archived_at")
      .eq("id", parsed.data.documentId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    if (!doc) throw new NotFoundError("المستند", "Document");

    const { data: version } = await supabase
      .from("document_versions")
      .select(
        "id, document_id, file_path, file_name, mime_type, size_bytes, file_source, is_current, external_file_id, external_provider",
      )
      .eq("document_id", doc.id)
      .eq("organization_id", ctx.organization.id)
      .eq("is_current", true)
      .maybeSingle();
    if (!version) throw new NotFoundError("إصدار المستند", "Document version");

    const analysisType =
      parsed.data.analysisType ??
      (doc.category === "business_case" || doc.category === "BUSINESS_CASE" ? "business_case" : "document");
    persistFailure = {
      supabase,
      organizationId: ctx.organization.id,
      actorUserId: ctx.profile.id,
      projectId: doc.project_id,
      documentId: doc.id,
      providerId: provider.id,
      model: provider.model,
      analysisType: analysisType === "business_case" ? "business_case" : "document_analysis",
    };

    const extracted = await extractAuthorizedDocumentText({
      supabase,
      ctx,
      documentId: doc.id,
      documentOrgId: doc.organization_id,
      hasDocumentRead: hasPermission(ctx, "document.read") || hasPermission(ctx, "document_control.read"),
      hasAiDocumentAnalyze: canUseAiCapability(ctx, "ai.document.analyze"),
      version,
      googleAccessToken: parsed.data.googleAccessToken,
      browserFileId: (input as { fileId?: string }).fileId ?? null,
      browserMime: (input as { mimeType?: string }).mimeType ?? null,
    });

    const result = await analyzeDocumentText({
      provider,
      organizationId: ctx.organization.id,
      documentId: doc.id,
      versionId: version.id,
      analysisType,
      text: extracted.text,
      pageCount: extracted.pageCount ?? null,
      forceRefresh: Boolean((input as { refresh?: boolean }).refresh),
    });

    await persistAiRun({
      supabase,
      organizationId: ctx.organization.id,
      actorUserId: ctx.profile.id,
      projectId: doc.project_id,
      documentId: doc.id,
      analysisType: persistFailure.analysisType,
      provider: provider.id,
      model: provider.model,
      promptVersion: result.promptVersion,
      status: "succeeded",
      latencyMs: Date.now() - started,
      inputChars: extracted.characterCount ?? extracted.text.length,
      outputChars: estimateChars(result.document ?? result.businessCase),
      promptTokens: null,
      completionTokens: null,
      artifactKind: analysisType === "business_case" ? "business_case" : "document_analysis",
      artifact: result.document ?? result.businessCase,
    });
    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "ai.document.analyzed",
      entityType: "document",
      entityId: doc.id,
      newValues: { analysis_type: analysisType, status: "succeeded" },
    });
    return {
      ok: true,
      data: {
        document: result.document,
        businessCase: result.businessCase,
        cached: result.cached,
        disclaimerAr: result.disclaimerAr,
        sourceClass: extracted.sourceClass,
      },
    };
  } catch (e) {
    if (persistFailure && isAppError(e) && isAiProviderFailureCode(e.details?.aiCode)) {
      await persistAiRun({
        supabase: persistFailure.supabase,
        organizationId: persistFailure.organizationId,
        actorUserId: persistFailure.actorUserId,
        projectId: persistFailure.projectId,
        documentId: persistFailure.documentId,
        analysisType: persistFailure.analysisType,
        provider: persistFailure.providerId,
        model: persistFailure.model,
        promptVersion: "document-analysis:v1",
        status: "failed",
        latencyMs: Date.now() - started,
        inputChars: 0,
        outputChars: 0,
        promptTokens: null,
        completionTokens: null,
        errorCategory: String(e.details?.aiCode),
      });
    }
    return fail(e);
  }
}

export async function refreshManagementInsightsAction(input?: {
  refresh?: boolean;
}): Promise<AiActionResult<{ insight: ManagementInsight; facts: ManagementInsightFacts; cached: boolean; disclaimerAr: string }>> {
  try {
    const ctx = await requireAiActor();
    if (!canViewManagementAi(ctx)) throw new ForbiddenError();

    const cfg = getAiPlatformConfig();
    const provider = createPlatformAiProvider();
    if (!cfg.enabled || !provider) {
      return { ok: false, code: "AI_DISABLED", error: AI_ERROR_MESSAGE_AR.AI_DISABLED };
    }

    assertAiRateLimit(ctx.profile.id, "analysis");
    const supabase = await createServerSupabaseClient();
    const orgId = ctx.organization.id;
    const nowIso = new Date().toISOString();
    const canProjects = hasPermission(ctx, "project.read");

    const [projectsRes, overdueRes, pendingRes] = await Promise.all([
      canProjects
        ? supabase.from("projects").select("id, name_ar, status, planned_end_date").eq("organization_id", orgId).limit(80)
        : Promise.resolve({ data: [] as Array<{ id: string; name_ar: string; status: string; planned_end_date: string | null }> }),
      canProjects
        ? supabase
            .from("workflow_instance_steps")
            .select("id, instance_id")
            .eq("organization_id", orgId)
            .in("status", ["ready", "in_progress"])
            .lt("due_at", nowIso)
            .limit(40)
        : Promise.resolve({ data: [] as Array<{ id: string }> }),
      hasPermission(ctx, "approval.review") || canViewManagementAi(ctx)
        ? supabase
            .from("approval_requests")
            .select("id, title, entity_id")
            .eq("organization_id", orgId)
            .in("status", ["pending", "in_progress"])
            .limit(40)
        : Promise.resolve({ data: [] as Array<{ id: string; title: string; entity_id: string | null }> }),
    ]);

    const overdueCount = overdueRes.data?.length ?? 0;
    const pendingCount = pendingRes.data?.length ?? 0;
    const projectNotes = (projectsRes.data ?? []).slice(0, 5).map((p) => ({
      id: p.id,
      nameAr: p.name_ar,
      reasonAr:
        p.planned_end_date && p.planned_end_date < riyadhTodayYmd()
          ? "تجاوز تاريخ الانتهاء المخطط"
          : "ضمن المشاريع المصرّح بعرضها",
      href: `/projects/${p.id}`,
    }));

    const facts: ManagementInsightFacts = {
      followUpProjects: projectNotes.length,
      overdueStages: overdueCount,
      pendingApprovals: pendingCount,
      projectNotes,
      dataAsOf: riyadhTodayYmd(),
    };

    const explained = await explainManagementInsights({
      provider,
      organizationId: orgId,
      facts,
      forceRefresh: Boolean(input?.refresh),
    });
    return { ok: true, data: explained };
  } catch (e) {
    return fail(e);
  }
}

export async function getManagementInsightFactsAction(): Promise<
  AiActionResult<{ facts: ManagementInsightFacts; disclaimerAr: string; enabled: boolean }>
> {
  try {
    const ctx = await requireAiActor();
    if (!canViewManagementAi(ctx)) throw new ForbiddenError();
    const cfg = getAiPlatformConfig();
    const supabase = await createServerSupabaseClient();
    const orgId = ctx.organization.id;
    const nowIso = new Date().toISOString();
    const canProjects = hasPermission(ctx, "project.read");
    const [overdueRes, pendingRes, projectsRes] = await Promise.all([
      canProjects
        ? supabase
            .from("workflow_instance_steps")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["ready", "in_progress"])
            .lt("due_at", nowIso)
        : Promise.resolve({ count: 0 }),
      hasPermission(ctx, "approval.review") || canViewManagementAi(ctx)
        ? supabase
            .from("approval_requests")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["pending", "in_progress"])
        : Promise.resolve({ count: 0 }),
      canProjects
        ? supabase.from("projects").select("id, name_ar").eq("organization_id", orgId).eq("status", "active").limit(8)
        : Promise.resolve({ data: [] as Array<{ id: string; name_ar: string }> }),
    ]);
    const facts: ManagementInsightFacts = {
      followUpProjects: projectsRes.data?.length ?? 0,
      overdueStages: overdueRes.count ?? 0,
      pendingApprovals: pendingRes.count ?? 0,
      projectNotes: (projectsRes.data ?? []).map((p) => ({
        id: p.id,
        nameAr: p.name_ar,
        reasonAr: "مشروع نشط مصرّح بعرضه",
        href: `/projects/${p.id}`,
      })),
      dataAsOf: riyadhTodayYmd(),
    };
    return { ok: true, data: { facts, disclaimerAr: AI_DISCLAIMER_AR, enabled: cfg.enabled } };
  } catch (e) {
    return fail(e);
  }
}
