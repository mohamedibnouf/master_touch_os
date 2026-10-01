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
  ValidationError,
  isAppError,
} from "@/lib/errors";
import { AuditService } from "@/server/services/audit.service";
import { DocumentIntelligenceRepository } from "@/server/repositories/document-intelligence.repository";
import { assertDocumentAIRateLimit } from "@/modules/document-intelligence/rate-limit";
import { extractDocumentText } from "@/modules/document-intelligence/extract-text";
import { chunkDocumentText } from "@/modules/document-intelligence/chunking";
import { extractBusinessCaseWithAI, getDocumentAIConfig } from "@/modules/document-intelligence/ai-extract";
import { DOCUMENT_AI_LIMITS } from "@/modules/document-intelligence/limits";
import { DRIVE_INTELLIGENCE_UNAVAILABLE_AR, isStorageIntelligenceEligible } from "@/modules/documents/file-source";

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
    .select("id, revision, file_path, file_name, mime_type, size_bytes, checksum, is_current, file_source")
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

    if (!isStorageIntelligenceEligible(version)) {
      return {
        ok: false,
        code: "DRIVE_UNAVAILABLE",
        error: DRIVE_INTELLIGENCE_UNAVAILABLE_AR,
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
      if ((version.size_bytes ?? 0) > DOCUMENT_AI_LIMITS.maxFileBytes) {
        throw new ValidationError(
          "حجم الملف يتجاوز حد التحليل.",
          "File exceeds analysis size limit.",
        );
      }

      const { data: fileData, error: dlErr } = await supabase.storage
        .from("documents")
        .download(version.file_path);
      if (dlErr || !fileData) {
        throw new ValidationError("تعذر تنزيل ملف المستند من التخزين.", "Could not download document file.");
      }

      const buffer = new Uint8Array(await fileData.arrayBuffer());
      const extracted = await extractDocumentText({
        buffer,
        mimeType: version.mime_type || "application/octet-stream",
        fileName: version.file_name || "document",
      });
      const chunks = chunkDocumentText(extracted.text);
      const { extraction, provider, model } = await extractBusinessCaseWithAI({ chunks });

      const saved = await repo.markExtracted({
        id: row.id,
        organizationId: ctx.organization.id,
        provider,
        model,
        payload: extraction,
        warnings: extracted.warnings,
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
