/**
 * Master Touch Intelligence Platform — cost, timeout, and size bounds.
 * Product limits, not contractual SLAs.
 */
export const AI_LIMITS = {
  maxQuestionChars: 800,
  maxAssistantHistoryTurns: 6,
  maxAssistantHistoryChars: 4_000,
  maxContextChars: 28_000,
  maxDocumentChars: 60_000,
  maxFileBytes: 8 * 1024 * 1024,
  maxChunks: 20,
  chunkSize: 3_000,
  maxActivityRows: 12,
  maxDocumentMetaRows: 20,
  maxTeamRows: 16,
  providerTimeoutMs: 45_000,
  documentTimeoutMs: 60_000,
  maxRetries: 1,
  retryBackoffMs: 400,
  temperature: 0.2,
  defaultModel: "gpt-4o-mini",
  assistantRateLimitMax: 12,
  assistantRateLimitWindowMs: 5 * 60 * 1000,
  analysisRateLimitMax: 8,
  analysisRateLimitWindowMs: 10 * 60 * 1000,
  reportRateLimitMax: 6,
  reportRateLimitWindowMs: 10 * 60 * 1000,
  pendingApprovalHoursHigh: 48,
  dueSoonHours: 48,
} as const;

export const AI_DISCLAIMER_AR =
  "التحليل الذكي أداة مساعدة لاتخاذ القرار وقد يحتاج إلى مراجعة بشرية.";

export const AI_DISCLAIMER_EN =
  "Intelligent analysis is an advisory aid and may require human review.";
