import "server-only";

import { ValidationError } from "@/lib/errors";
import { DOCUMENT_AI_LIMITS as L } from "./limits";
import { boundExtractedText } from "./chunking";
import { assertDocumentIntelligenceMime, assertDocumentIntelligenceSize } from "./file-validation";
import type { DocumentTextExtraction } from "./schema";

export { assertDocumentIntelligenceMime, assertDocumentIntelligenceSize } from "./file-validation";

/**
 * Server-only text extraction. AI never receives storage credentials.
 */
export async function extractDocumentText(input: {
  buffer: Uint8Array;
  mimeType: string;
  fileName: string;
}): Promise<DocumentTextExtraction> {
  assertDocumentIntelligenceMime(input.mimeType);
  assertDocumentIntelligenceSize(input.buffer.byteLength);

  const warnings: string[] = [];
  let text = "";
  let method: DocumentTextExtraction["extractionMethod"] = "none";
  let pageCount: number | null = null;

  if (input.mimeType === "text/plain") {
    text = new TextDecoder("utf-8", { fatal: false }).decode(input.buffer);
    method = "txt";
  } else if (input.mimeType === "application/pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: Buffer.from(input.buffer) });
      try {
        const parsed = await parser.getText();
        text = parsed.text ?? "";
        pageCount = typeof parsed.total === "number" ? parsed.total : (parsed.pages?.length ?? null);
        method = "pdf";
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    } catch (e) {
      throw new ValidationError(
        "تعذر استخراج نص من ملف PDF. قد يكون الملف ممسوحاً ضوئياً ويتطلب OCR (غير مدعوم في 5.5).",
        "Could not extract text from PDF. Scanned PDFs require OCR (not supported in Phase 5.5).",
        { cause: String(e) },
      );
    }
  } else if (
    input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(input.buffer) });
      text = result.value ?? "";
      method = "docx";
      if (result.messages?.length) {
        warnings.push(...result.messages.slice(0, 5).map((m) => m.message));
      }
    } catch (e) {
      throw new ValidationError(
        "تعذر استخراج نص من ملف DOCX.",
        "Could not extract text from DOCX.",
        { cause: String(e) },
      );
    }
  }

  const cleaned = text.replace(/\u0000/g, "").trim();
  if (!cleaned || cleaned.length < 20) {
    throw new ValidationError(
      "لا يوجد نص قابل للقراءة في المستند. قد يتطلب OCR أو ملفاً نصياً.",
      "No readable text found in the document. OCR or a text file may be required.",
    );
  }

  const bounded = boundExtractedText(cleaned);
  if (bounded.truncated) {
    warnings.push(
      `Extracted text truncated to ${L.maxExtractedChars} characters for AI analysis bounds.`,
    );
  }

  return {
    text: bounded.text,
    characterCount: bounded.text.length,
    extractionMethod: method,
    warnings,
    pageCount,
  };
}
