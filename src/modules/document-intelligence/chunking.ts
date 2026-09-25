import { DOCUMENT_AI_LIMITS as L } from "./limits";
import type { DocumentChunk } from "./schema";

export function chunkDocumentText(text: string): DocumentChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let index = 1;
  while (start < normalized.length && chunks.length < L.maxChunks) {
    const end = Math.min(start + L.chunkSize, normalized.length);
    const slice = normalized.slice(start, end);
    chunks.push({
      id: `DOC_CHUNK_${String(index).padStart(3, "0")}`,
      text: slice,
      startChar: start,
      endChar: end,
    });
    index += 1;
    start = end;
  }
  return chunks;
}

export function boundExtractedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= L.maxExtractedChars) return { text, truncated: false };
  return { text: text.slice(0, L.maxExtractedChars), truncated: true };
}
