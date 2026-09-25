import { RateLimitedError } from "@/lib/errors";
import { DOCUMENT_AI_LIMITS as L } from "./limits";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function assertDocumentAIRateLimit(userId: string): void {
  const now = Date.now();
  const key = `doc-ai:${userId}`;
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + L.rateLimitWindowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > L.rateLimitMax) {
    throw new RateLimitedError(Math.max(1, Math.ceil((b.resetAt - now) / 1000)));
  }
}

export function resetDocumentAIRateLimitsForTests(): void {
  buckets.clear();
}
