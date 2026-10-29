import "server-only";

import { createHash } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import {
  LOGIN_RATE_LIMITS,
  assertLoginRateLimit,
  type LoginRateLimitScope,
} from "@/lib/auth/employee-login";

/** Hashed so the shared counter never stores raw IPs or identifiers. */
export function loginBucketKey(scope: LoginRateLimitScope, value: string): string {
  const digest = createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
  return `login:${scope}:${digest}`;
}

/**
 * Records one login attempt in the shared counter (migration 085) and returns false once
 * the bucket is over its limit. Falls back to the per-process limiter if the RPC fails,
 * e.g. before 085 is applied, so login never breaks because of the limiter itself.
 */
export async function consumeLoginAttempt(scope: LoginRateLimitScope, value: string): Promise<boolean> {
  const { maxAttempts, windowSeconds } = LOGIN_RATE_LIMITS[scope];
  const bucketKey = loginBucketKey(scope, value || "unknown");
  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("consume_login_attempt", {
      p_bucket_key: bucketKey,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    logger.warn("login rate limit: shared counter unavailable, using in-process fallback", {
      scope,
      reason: (error as { message?: string } | null)?.message ?? String(error),
    });
    return assertLoginRateLimit(bucketKey, maxAttempts);
  }
}
