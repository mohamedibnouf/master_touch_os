"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  isAppError,
} from "@/lib/errors";
import { AuditService } from "@/server/services/audit.service";
import { DocumentIntelligenceRepository } from "@/server/repositories/document-intelligence.repository";
import { assertDocumentAIRateLimit } from "@/modules/document-intelligence/rate-limit";
import { extractAuthorizedDocumentText } from "@/server/use-cases/document-ai-source";
import { canUseAiCapability } from "@/modules/ai/security/permissions";
import { chunkDocumentText } from "@/modules/document-intelligence/chunking";
import { extractBusinessCaseWithAI, getDocumentAIConfig } from "@/modules/document-intelligence/ai-extract";

async function loadAuthorizedDocument(documentId: string) {
  const ctx = await getAuthContext();
  if (!ctx) throw new UnauthorizedError();
  if (!hasPermission(ctx, "document.read") && !hasPermission(ctx, "document_control.read")) {
    throw new ForbiddenError();
  }

  const supabase = await createServerSupabaseClient();
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, organization_id, project_id, title, category, current_revision, status, archived_at")
    .eq("id", documentId)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (error || !doc) throw new NotFoundError("المستند", "Document");

  const { data: version, error: vErr } = await supabase
    .from("document_versions")
    .select(
      "id, revision, file_path, file_name, mime_type, size_bytes, checksum, is_current, file_source, external_file_id, external_provider, document_id",
    )
    .eq("document_id", documentId)
    .eq("organization_id", ctx.organization.id)
    .eq("is_current", true)
    .maybeSingle();
  if (vErr || !version) throw new NotFoundError("إصدار المستند", "Document version");

  return { ctx, supabase, doc, version };
}

export type AnalyzeDocumentResult =
  | { ok: true; intelligenceId: string }
  | { ok: false; error: string; code?: string };

export async function analyzeDocumentIntelligenceAction(input: {
  documentId: string;
  googleAccessToken?: string;
}): Promise<AnalyzeDocumentResult> {
  try {
    const { ctx, supabase, doc, version } = await loadAuthorizedDocument(input.documentId);
    if (!hasPermission(ctx, "document.upload") && !hasPermission(ctx, "document.update")) {
      throw new ForbiddenError();
    }

    if (doc.archived_at) {
      return {
        ok: false,
        code: "ARCHIVED",
        error: "لا يمكن تحليل مستند مؤرشف كمستند تشغيلي.",
      };
    }

    const cfg = getDocumentAIConfig();
    if (!cfg.enabled) {
      return {
        ok: false,
        code: "AI_UNAVAILABLE",
        error: "ذكاء المستندات غير مُعدّ. عيّن DOCUMENT_AI_PROVIDER أو MANAGEMENT_AI_PROVIDER=mock.",
      };
    }

    assertDocumentAIRateLimit(ctx.profile.id);

    const repo = new DocumentIntelligenceRepository(supabase);
    const existing = await repo.getCurrentForVersion(ctx.organization.id, version.id);
    if (existing && (existing.status === "EXTRACTED" || existing.status === "VERIFIED")) {
      return { ok: true, intelligenceId: existing.id };
    }
    if (existing && existing.status === "PROCESSING") {
      return { ok: false, code: "CONFLICT", error: "تحليل قيد التنفيذ لهذا الإصدار." };
    }

    const row = await repo.insertProcessing({
      organizationId: ctx.organization.id,
      documentId: doc.id,
      documentVersionId: version.id,
      createdBy: ctx.profile.id,
      sourceChecksum: version.checksum,
    });
    if (!row) {
      // concurrent insert
      const again = await repo.getCurrentForVersion(ctx.organization.id, version.id);
      if (again) return { ok: true, intelligenceId: again.id };
      return { ok: false, error: "تعذر بدء التحليل (تعارض متزامن)." };
    }

    try {
      const extracted = await extractAuthorizedDocumentText({
        supabase,
        ctx,
        documentId: doc.id,
        documentOrgId: doc.organization_id,
        hasDocumentRead: hasPermission(ctx, "document.read") || hasPermission(ctx, "document_control.read"),
        hasAiDocumentAnalyze: canUseAiCapability(ctx, "ai.document.analyze"),
        version,
        googleAccessToken: input.googleAccessToken,
      });
      const chunks = chunkDocumentText(extracted.text);
      const { extraction, provider, model } = await extractBusinessCaseWithAI({ chunks });

      const saved = await repo.markExtracted({
        id: row.id,
        organizationId: ctx.organization.id,
        provider,
        model,
        payload: extraction,
        warnings: [],
        characterCount: extracted.characterCount,
        chunkCount: chunks.length,
      });
      if (!saved) {
        await repo.markFailed(row.id, ctx.organization.id, "Failed to persist extraction");
        return { ok: false, error: "تعذر حفظ نتيجة الاستخراج." };
      }

      const audit = new AuditService(supabase);
      await audit.log({
        organizationId: ctx.organization.id,
        action: "document_intelligence.extracted",
        entityType: "document_intelligence",
        entityId: saved.id,
        newValues: {
          document_id: doc.id,
          document_version_id: version.id,
          provider,
          status: "EXTRACTED",
        },
      });

      revalidatePath(`/documents/${doc.id}/intelligence`);
      return { ok: true, intelligenceId: saved.id };
    } catch (inner) {
      const message = isAppError(inner) ? inner.userMessageAr : "فشل استخراج المستند.";
      await repo.markFailed(row.id, ctx.organization.id, message);
      const audit = new AuditService(supabase);
      await audit.log({
        organizationId: ctx.organization.id,
        action: "document_intelligence.failed",
        entityType: "document_intelligence",
        entityId: row.id,
        newValues: { document_id: doc.id, status: "FAILED" },
      });
      throw inner;
    }
  } catch (e) {
    if (isAppError(e)) return { ok: false, code: e.code, error: e.userMessageAr };
    return { ok: false, code: "INTERNAL", error: "حدث خطأ غير متوقع أثناء التحليل." };
  }
}

export async function verifyDocumentIntelligenceAction(input: {
  intelligenceId: string;
  documentId: string;
}): Promise<AnalyzeDocumentResult> {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();
    if (!hasPermission(ctx, "document.approve")) {
      throw new ForbiddenError();
    }

    const supabase = await createServerSupabaseClient();
    const repo = new DocumentIntelligenceRepository(supabase);
    const verified = await repo.verifyViaRpc(input.intelligenceId);
    if (!verified) {
      return { ok: false, error: "تعذر التحقق — يجب أن تكون الحالة EXTRACTED وأن تملك صلاحية الاعتماد." };
    }

    revalidatePath(`/documents/${input.documentId}/intelligence`);
    return { ok: true, intelligenceId: verified.id };
  } catch (e) {
    if (isAppError(e)) return { ok: false, code: e.code, error: e.userMessageAr };
    return { ok: false, error: "حدث خطأ أثناء التحقق." };
  }
}
