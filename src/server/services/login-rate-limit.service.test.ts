import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc }),
}));

import { LOGIN_RATE_LIMITS, resetLoginRateLimitsForTests } from "@/lib/auth/employee-login";
import { consumeLoginAttempt, loginBucketKey } from "./login-rate-limit.service";

describe("shared login rate limit", () => {
  beforeEach(() => {
    rpc.mockReset();
    resetLoginRateLimitsForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("hashes bucket keys so raw IPs and identifiers are never stored", () => {
    const key = loginBucketKey("identifier", "  User@Example.com ");
    expect(key).toMatch(/^login:identifier:[0-9a-f]{64}$/);
    expect(key).toBe(loginBucketKey("identifier", "user@example.com"));
    expect(key).not.toContain("example");
    expect(loginBucketKey("ip", "10.0.0.1")).not.toBe(loginBucketKey("identifier", "10.0.0.1"));
  });

  it("passes the scope limits to the RPC and returns its verdict", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(consumeLoginAttempt("ip", "10.0.0.1")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("consume_login_attempt", {
      p_bucket_key: loginBucketKey("ip", "10.0.0.1"),
      p_max_attempts: LOGIN_RATE_LIMITS.ip.maxAttempts,
      p_window_seconds: LOGIN_RATE_LIMITS.ip.windowSeconds,
    });

    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(consumeLoginAttempt("identifier", "MT-00025")).resolves.toBe(false);
  });

  it("falls back to the in-process limiter when the RPC is unavailable", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function consume_login_attempt does not exist" } });
    const { maxAttempts } = LOGIN_RATE_LIMITS.identifier;
    for (let i = 0; i < maxAttempts; i += 1) {
      await expect(consumeLoginAttempt("identifier", "MT-00025")).resolves.toBe(true);
    }
    await expect(consumeLoginAttempt("identifier", "MT-00025")).resolves.toBe(false);
    await expect(consumeLoginAttempt("identifier", "MT-00026")).resolves.toBe(true);
  });

  it("falls back when creating the client throws", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    await expect(consumeLoginAttempt("ip", "10.0.0.9")).resolves.toBe(true);
  });
});

describe("085 login rate limit migration", () => {
  const sql = readFileSync("supabase/migrations/085_login_rate_limit.sql", "utf8");

  it("locks the counter table down to the security definer RPC", () => {
    expect(sql).toContain("alter table public.auth_login_attempts enable row level security");
    expect(sql).toContain("revoke all on table public.auth_login_attempts from public, anon, authenticated");
    expect(sql).not.toMatch(/grant [a-z, ]+ on table public\.auth_login_attempts/i);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("only lets service_role call consume_login_attempt", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
    expect(sql).toContain(
      "revoke all on function public.consume_login_attempt(text, integer, integer) from public, anon, authenticated",
    );
    expect(sql).toContain("grant execute on function public.consume_login_attempt(text, integer, integer) to service_role");
    expect(sql).not.toMatch(/consume_login_attempt\([^)]*\) to [^;]*(anon|authenticated)/);
  });
});
