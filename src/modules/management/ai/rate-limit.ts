import { RateLimitedError } from "@/lib/errors";
import { MANAGEMENT_AI_LIMITS as L } from "./limits";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Simple in-process rate limiter (per authenticated user).
 * Limitation: not shared across multiple Node processes / serverless instances.
 */
export function assertManagementAIRateLimit(userId: string): void {
  const now = Date.now();
  const key = `mgmt-ai:${userId}`;
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + L.rateLimitWindowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > L.rateLimitMax) {
    const retryAfterSeconds = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    throw new RateLimitedError(retryAfterSeconds);
  }
}

/** Test helper — clear buckets between unit tests. */
export function resetManagementAIRateLimitsForTests(): void {
  buckets.clear();
}
