export type DocumentFileSource = "storage" | "google_drive";

export type DocumentVersionFileShape = {
  file_source: DocumentFileSource;
  file_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  external_provider: string | null;
  external_file_id: string | null;
  external_url: string | null;
};

/** Mirrors document_versions_file_source_integrity (065). */
export function isValidStorageVersion(row: DocumentVersionFileShape): boolean {
  return (
    row.file_source === "storage" &&
    Boolean(row.file_path && row.file_path.trim()) &&
    row.mime_type != null &&
    row.mime_type.length > 0 &&
    row.size_bytes != null &&
    row.external_provider == null &&
    row.external_file_id == null &&
    row.external_url == null
  );
}

export function isValidGoogleDriveVersion(row: DocumentVersionFileShape): boolean {
  const url = row.external_url ?? "";
  return (
    row.file_source === "google_drive" &&
    row.file_path == null &&
    row.external_provider === "google_drive" &&
    Boolean(row.external_file_id && row.external_file_id.trim()) &&
    (url.startsWith("https://drive.google.com/") || url.startsWith("https://docs.google.com/"))
  );
}

export function documentFileSourceLabelAr(source: DocumentFileSource | string | null | undefined): string {
  if (source === "google_drive") return "Google Drive";
  return "تخزين النظام";
}

export const DRIVE_INTELLIGENCE_UNAVAILABLE_AR =
  "تحليل مستندات Google Drive يتطلب ربط Drive في مرحلة لاحقة. التحليل متاح حالياً لملفات التخزين الداخلي.";

export function isStorageIntelligenceEligible(version: {
  file_source?: string | null;
  file_path?: string | null;
}): boolean {
  return version.file_source !== "google_drive" && Boolean(version.file_path);
}

export function driveOpenHref(file: {
  file_source?: string | null;
  external_url?: string | null;
} | null): string | null {
  if (file?.file_source !== "google_drive") return null;
  const url = file.external_url ?? "";
  if (!url.startsWith("https://drive.google.com/") && !url.startsWith("https://docs.google.com/")) {
    return null;
  }
  return url;
}
