import { isGoogleDriveFileId } from "./google-drive-url";
import { DOCUMENT_INTELLIGENCE_MIME } from "@/modules/document-intelligence/limits";

export const DRIVE_PDF = "application/pdf";
export const DRIVE_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DRIVE_TXT = "text/plain";
export const DRIVE_GOOGLE_DOC = "application/vnd.google-apps.document";
export const DRIVE_GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const DRIVE_GOOGLE_SLIDE = "application/vnd.google-apps.presentation";

export const DRIVE_FILES_MEDIA_URL = "https://www.googleapis.com/drive/v3/files";

export type DriveAiFetchPlan =
  | { kind: "media"; extractMime: string }
  | { kind: "export"; exportMime: string; extractMime: string };

export type DriveAiDenial =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DRIVE_TOKEN_REQUIRED"
  | "UNSUPPORTED"
  | "OVERSIZED"
  | "VALIDATION";

export function isPhase1DriveExtractMime(mime: string | null | undefined): boolean {
  return DOCUMENT_INTELLIGENCE_MIME.has(mime ?? "");
}

export function isDriveSheetsOrSlides(mime: string | null | undefined): boolean {
  return mime === DRIVE_GOOGLE_SHEET || mime === DRIVE_GOOGLE_SLIDE;
}

export function driveAiFetchPlan(mime: string | null | undefined): DriveAiFetchPlan | null {
  if (mime === DRIVE_PDF || mime === DRIVE_DOCX || mime === DRIVE_TXT) {
    return { kind: "media", extractMime: mime };
  }
  if (mime === DRIVE_GOOGLE_DOC) {
    return { kind: "export", exportMime: DRIVE_DOCX, extractMime: DRIVE_DOCX };
  }
  return null;
}

export function classifyDriveAiSource(mime: string | null | undefined): "DRIVE_FETCH_REQUIRED" | "UNSUPPORTED" | "METADATA_ONLY" {
  if (isDriveSheetsOrSlides(mime)) return "UNSUPPORTED";
  if (driveAiFetchPlan(mime)) return "DRIVE_FETCH_REQUIRED";
  return "METADATA_ONLY";
}

export function driveDownloadUrl(fileId: string, plan: DriveAiFetchPlan): string {
  const id = encodeURIComponent(fileId);
  if (plan.kind === "export") {
    return `${DRIVE_FILES_MEDIA_URL}/${id}/export?mimeType=${encodeURIComponent(plan.exportMime)}`;
  }
  return `${DRIVE_FILES_MEDIA_URL}/${id}?alt=media`;
}

export function resolveAuthorizedDriveFileId(dbFileId: string | null | undefined): string | null {
  if (!dbFileId || !isGoogleDriveFileId(dbFileId)) return null;
  return dbFileId;
}

/** Browser-supplied file id/mime are ignored. */
export function ignoreBrowserDriveOverride<T>(dbValue: T, browserValue: unknown): T {
  void browserValue;
  return dbValue;
}

export function hasUsableDriveAccessToken(token: string | null | undefined): boolean {
  const value = (token ?? "").trim();
  return value.length >= 20 && value.length <= 8192 && !value.includes("\n");
}

export function authorizeDriveAiFetch(input: {
  userId: string | null;
  profileActive: boolean;
  membershipActive: boolean;
  actorOrgId: string;
  documentOrgId: string;
  documentExists: boolean;
  hasDocumentRead: boolean;
  hasAiDocumentAnalyze: boolean;
  versionBelongsToDocument: boolean;
  fileSource: string | null;
  externalProvider: string | null;
  externalFileId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  maxFileBytes: number;
  accessToken: string | null | undefined;
  browserFileId?: string | null;
  browserMime?: string | null;
}): { ok: true; fileId: string; plan: DriveAiFetchPlan } | { ok: false; denial: DriveAiDenial } {
  if (!input.userId) return { ok: false, denial: "UNAUTHORIZED" };
  if (!input.documentExists) return { ok: false, denial: "NOT_FOUND" };
  if (!input.profileActive || !input.membershipActive) return { ok: false, denial: "FORBIDDEN" };
  if (input.documentOrgId !== input.actorOrgId) return { ok: false, denial: "FORBIDDEN" };
  if (!input.hasDocumentRead || !input.hasAiDocumentAnalyze) return { ok: false, denial: "FORBIDDEN" };
  if (!input.versionBelongsToDocument) return { ok: false, denial: "VALIDATION" };
  if (input.fileSource !== "google_drive" || input.externalProvider !== "google_drive") {
    return { ok: false, denial: "VALIDATION" };
  }
  const fileId = resolveAuthorizedDriveFileId(ignoreBrowserDriveOverride(input.externalFileId, input.browserFileId));
  if (!fileId) return { ok: false, denial: "VALIDATION" };
  const mime = ignoreBrowserDriveOverride(input.mimeType, input.browserMime);
  const plan = driveAiFetchPlan(mime);
  if (!plan) return { ok: false, denial: "UNSUPPORTED" };
  if (input.sizeBytes != null && input.sizeBytes > input.maxFileBytes) {
    return { ok: false, denial: "OVERSIZED" };
  }
  if (!hasUsableDriveAccessToken(input.accessToken)) return { ok: false, denial: "DRIVE_TOKEN_REQUIRED" };
  return { ok: true, fileId, plan };
}

export function driveAiDenialMessage(denial: DriveAiDenial): { ar: string; en: string } {
  switch (denial) {
    case "UNAUTHORIZED":
      return { ar: "يجب تسجيل الدخول للمتابعة.", en: "You must sign in to continue." };
    case "FORBIDDEN":
      return { ar: "ليست لديك صلاحية تحليل هذا المستند.", en: "You cannot analyze this document." };
    case "NOT_FOUND":
      return { ar: "المستند غير موجود.", en: "Document was not found." };
    case "DRIVE_TOKEN_REQUIRED":
      return {
        ar: "يلزم تفويض Google Drive لقراءة محتوى الملف. أعد التفويض ثم حاول مرة أخرى.",
        en: "Google Drive authorization is required to read the file. Sign in again and retry.",
      };
    case "UNSUPPORTED":
      return { ar: "هذا النوع من ملفات Drive غير مدعوم للتحليل حالياً.", en: "This Drive file type is not supported for analysis." };
    case "OVERSIZED":
      return { ar: "حجم الملف يتجاوز حد التحليل.", en: "The file exceeds the analysis size limit." };
    default:
      return { ar: "تعذر قراءة ملف Google Drive.", en: "The Google Drive file could not be read." };
  }
}
