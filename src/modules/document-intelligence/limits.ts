/**
 * Phase 5.5 — document intelligence bounds (cost + safety).
 */
export const DOCUMENT_AI_LIMITS = {
  /** Max download/extract size (must stay ≤ storage 50MB; tighter for AI). */
  maxFileBytes: 8 * 1024 * 1024,
  /** Max characters sent to the model across all chunks. */
  maxExtractedChars: 60_000,
  /** Chunk size for evidence grounding. */
  chunkSize: 3_000,
  /** Max chunks retained after truncation. */
  maxChunks: 20,
  /** Rate limit: analyses per window per user. */
  rateLimitMax: 6,
  rateLimitWindowMs: 10 * 60 * 1000,
  providerTimeoutMs: 60_000,
  defaultModel: "gpt-4o-mini",
  temperature: 0.1,
  schemaVersion: "business-case-v1",
} as const;

export const DOCUMENT_INTELLIGENCE_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
