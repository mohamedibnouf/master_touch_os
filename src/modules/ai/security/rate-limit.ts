import { RateLimitedError } from "@/lib/errors";
import { AI_LIMITS } from "../limits";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function assertLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    throw new RateLimitedError(Math.max(1, Math.ceil((b.resetAt - now) / 1000)));
  }
}

export function assertAiRateLimit(
  userId: string,
  kind: "assistant" | "analysis" | "report",
): void {
  if (kind === "assistant") {
    assertLimit(`ai:assistant:${userId}`, AI_LIMITS.assistantRateLimitMax, AI_LIMITS.assistantRateLimitWindowMs);
    return;
  }
  if (kind === "report") {
    assertLimit(`ai:report:${userId}`, AI_LIMITS.reportRateLimitMax, AI_LIMITS.reportRateLimitWindowMs);
    return;
  }
  assertLimit(`ai:analysis:${userId}`, AI_LIMITS.analysisRateLimitMax, AI_LIMITS.analysisRateLimitWindowMs);
}

export function resetAiRateLimitsForTests(): void {
  buckets.clear();
}

const inflight = new Map<string, Promise<unknown>>();

export async function withAiInflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

export function resetAiInflightForTests(): void {
  inflight.clear();
}
