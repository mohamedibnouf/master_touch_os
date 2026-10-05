export type DocumentSourceClass = "CONTENT_AVAILABLE" | "METADATA_ONLY" | "UNSUPPORTED";

export function classifyDocumentSource(input: {
  fileSource?: string | null;
  mimeType?: string | null;
  filePath?: string | null;
}): DocumentSourceClass {
  if (input.fileSource === "google_drive") return "METADATA_ONLY";
  const mime = input.mimeType ?? "";
  const supported =
    mime === "application/pdf" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "text/plain";
  if (!supported) return "UNSUPPORTED";
  if (!input.filePath) return "METADATA_ONLY";
  return "CONTENT_AVAILABLE";
}
