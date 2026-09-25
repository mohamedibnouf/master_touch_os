import { ValidationError } from "@/lib/errors";
import { DOCUMENT_AI_LIMITS as L, DOCUMENT_INTELLIGENCE_MIME } from "./limits";

export function assertDocumentIntelligenceMime(mimeType: string): void {
  if (!DOCUMENT_INTELLIGENCE_MIME.has(mimeType)) {
    throw new ValidationError(
      "نوع الملف غير مدعوم لاستخراج الذكاء الوثائقي (PDF / DOCX / TXT).",
      "File type not supported for document intelligence (PDF / DOCX / TXT).",
    );
  }
}

export function assertDocumentIntelligenceSize(sizeBytes: number): void {
  if (sizeBytes <= 0) {
    throw new ValidationError("الملف فارغ.", "File is empty.");
  }
  if (sizeBytes > L.maxFileBytes) {
    throw new ValidationError(
      `حجم الملف يتجاوز حد التحليل (${Math.floor(L.maxFileBytes / (1024 * 1024))} ميجابايت).`,
      `File exceeds analysis size limit (${Math.floor(L.maxFileBytes / (1024 * 1024))} MB).`,
    );
  }
}
