import "server-only";

import { ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { classifyDocumentSource } from "@/modules/ai/classify-source";
import { extractDocumentText } from "@/modules/document-intelligence/extract-text";
import { DOCUMENT_AI_LIMITS } from "@/modules/document-intelligence/limits";
import {
  authorizeDriveAiFetch,
  driveAiDenialMessage,
  type DriveAiDenial,
} from "@/modules/documents/drive-ai-content";
import { isStorageIntelligenceEligible } from "@/modules/documents/file-source";
import { downloadAuthorizedDriveBytes } from "@/server/services/google-drive-content.service";
import type { AuthContext } from "@/types/models";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentVersionForAi = {
  id: string;
  document_id?: string;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  file_source: string | null;
  is_current: boolean;
  external_file_id?: string | null;
  external_provider?: string | null;
};

function throwDriveDenial(denial: DriveAiDenial): never {
  const msg = driveAiDenialMessage(denial);
  if (denial === "UNAUTHORIZED") throw new UnauthorizedError();
  if (denial === "FORBIDDEN") throw new ForbiddenError();
  throw new ValidationError(msg.ar, msg.en, { aiCode: denial });
}

export async function extractAuthorizedDocumentText(input: {
  supabase: SupabaseClient;
  ctx: AuthContext;
  documentId: string;
  documentOrgId: string;
  hasDocumentRead: boolean;
  hasAiDocumentAnalyze: boolean;
  version: DocumentVersionForAi;
  googleAccessToken?: string | null;
  browserFileId?: string | null;
  browserMime?: string | null;
}): Promise<{
  text: string;
  pageCount: number | null;
  characterCount: number;
  sourceClass: ReturnType<typeof classifyDocumentSource>;
}> {
  const sourceClass = classifyDocumentSource({
    fileSource: input.version.file_source,
    mimeType: input.version.mime_type,
    filePath: input.version.file_path,
  });

  if (sourceClass === "DRIVE_FETCH_REQUIRED") {
    const authz = authorizeDriveAiFetch({
      userId: input.ctx.userId,
      profileActive: input.ctx.profile.is_active,
      membershipActive: input.ctx.membershipStatus === "active",
      actorOrgId: input.ctx.organization.id,
      documentOrgId: input.documentOrgId,
      documentExists: true,
      hasDocumentRead: input.hasDocumentRead,
      hasAiDocumentAnalyze: input.hasAiDocumentAnalyze,
      versionBelongsToDocument: !input.version.document_id || input.version.document_id === input.documentId,
      fileSource: input.version.file_source,
      externalProvider: input.version.external_provider ?? null,
      externalFileId: input.version.external_file_id ?? null,
      mimeType: input.version.mime_type,
      sizeBytes: input.version.size_bytes,
      maxFileBytes: DOCUMENT_AI_LIMITS.maxFileBytes,
      accessToken: input.googleAccessToken,
      browserFileId: input.browserFileId,
      browserMime: input.browserMime,
    });
    if (!authz.ok) throwDriveDenial(authz.denial);

    const downloaded = await downloadAuthorizedDriveBytes({
      fileId: authz.fileId,
      accessToken: (input.googleAccessToken ?? "").trim(),
      plan: authz.plan,
      maxBytes: DOCUMENT_AI_LIMITS.maxFileBytes,
    });
    const extracted = await extractDocumentText({
      buffer: downloaded.buffer,
      mimeType: downloaded.extractMime,
      fileName: input.version.file_name || "drive-document",
    });
    return {
      text: extracted.text,
      pageCount: extracted.pageCount ?? null,
      characterCount: extracted.characterCount ?? extracted.text.length,
      sourceClass,
    };
  }

  if (sourceClass === "UNSUPPORTED" || sourceClass === "METADATA_ONLY" || !isStorageIntelligenceEligible(input.version)) {
    throw new ValidationError("هذا النوع من المستندات غير مدعوم للتحليل حالياً.", "This document type is not supported.", {
      aiCode: "DOCUMENT_UNSUPPORTED",
    });
  }

  if ((input.version.size_bytes ?? 0) > DOCUMENT_AI_LIMITS.maxFileBytes) {
    throw new ValidationError("حجم الملف يتجاوز حد التحليل.", "File exceeds analysis size limit.");
  }
  if (!input.version.file_path) {
    throw new ValidationError("تعذر تنزيل ملف المستند من التخزين.", "Could not download document file.");
  }

  const { data: fileData, error: dlErr } = await input.supabase.storage.from("documents").download(input.version.file_path);
  if (dlErr || !fileData) {
    throw new ValidationError("تعذر تنزيل ملف المستند من التخزين.", "Could not download document file.");
  }
  const buffer = new Uint8Array(await fileData.arrayBuffer());
  const extracted = await extractDocumentText({
    buffer,
    mimeType: input.version.mime_type || "application/octet-stream",
    fileName: input.version.file_name || "document",
  });
  return {
    text: extracted.text,
    pageCount: extracted.pageCount ?? null,
    characterCount: extracted.characterCount ?? extracted.text.length,
    sourceClass,
  };
}
