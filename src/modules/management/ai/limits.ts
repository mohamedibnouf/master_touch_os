/**
 * Phase 5.4 — bounded context / request limits for Management AI Analyst.
 * These are product limits (cost + safety), not contractual SLAs.
 */
export const MANAGEMENT_AI_LIMITS = {
  /** Max user question characters. */
  maxQuestionChars: 800,
  /** Top risk findings included in context. */
  maxRisks: 25,
  /** Decision-brief statements across sections. */
  maxBriefStatements: 24,
  /** Executive metrics. */
  maxMetrics: 16,
  /** Activity rows (already bounded in snapshot). */
  maxActivity: 8,
  /** Overdue / declared project rows. */
  maxProjectRows: 15,
  /** Oldest approval rows. */
  maxApprovalRows: 12,
  /** Max findings returned in AI response. */
  maxResponseFindings: 12,
  /** Max suggested reviews. */
  maxSuggestedReviews: 8,
  /** In-memory rate limit: requests per window per user. */
  rateLimitMax: 10,
  /** Rate limit window ms (5 minutes). */
  rateLimitWindowMs: 5 * 60 * 1000,
  /** Provider HTTP timeout. */
  providerTimeoutMs: 45_000,
  /** Default OpenAI-compatible model (cost-effective structured summarization). */
  defaultModel: "gpt-4o-mini",
  /** Sampling temperature — low for grounded factual summaries. */
  temperature: 0.2,
} as const;

export type ManagementAILimits = typeof MANAGEMENT_AI_LIMITS;
