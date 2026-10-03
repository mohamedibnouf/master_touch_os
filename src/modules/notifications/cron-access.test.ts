import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNotificationsCronAuthorized, notificationsCronSecret } from "./cron-auth";
import {
  NOTIFICATIONS_CRON_PATH,
  isNotificationsCronPath,
  requiresInteractiveLogin,
} from "@/lib/http/session-gate";

const FAKE = "e6-test-cron-secret";

function restoreCronEnv(prevA: string | undefined, prevB: string | undefined) {
  if (prevA === undefined) delete process.env.NOTIFICATIONS_CRON_SECRET;
  else process.env.NOTIFICATIONS_CRON_SECRET = prevA;
  if (prevB === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prevB;
}

describe("cron path session bypass", () => {
  it("exempts only the exact notifications cron path from interactive login", () => {
    expect(isNotificationsCronPath(NOTIFICATIONS_CRON_PATH)).toBe(true);
    expect(isNotificationsCronPath(`${NOTIFICATIONS_CRON_PATH}/`)).toBe(true);
    expect(requiresInteractiveLogin(NOTIFICATIONS_CRON_PATH)).toBe(false);
    expect(requiresInteractiveLogin("/login")).toBe(false);
    expect(requiresInteractiveLogin("/auth/callback")).toBe(false);

    expect(requiresInteractiveLogin("/")).toBe(true);
    expect(requiresInteractiveLogin("/settings")).toBe(true);
    expect(requiresInteractiveLogin("/employees")).toBe(true);
    expect(requiresInteractiveLogin("/documents")).toBe(true);
    expect(requiresInteractiveLogin("/settings/roles")).toBe(true);
    expect(requiresInteractiveLogin("/api/internal/other")).toBe(true);
    expect(requiresInteractiveLogin("/api/internal/notifications")).toBe(true);
    expect(requiresInteractiveLogin("/api/internal/notifications/run/extra")).toBe(true);
  });
});

describe("cron bearer authorization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing, wrong scheme, empty, and invalid bearers", () => {
    const prevA = process.env.NOTIFICATIONS_CRON_SECRET;
    const prevB = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    process.env.NOTIFICATIONS_CRON_SECRET = FAKE;
    expect(isNotificationsCronAuthorized(null)).toBe(false);
    expect(isNotificationsCronAuthorized("")).toBe(false);
    expect(isNotificationsCronAuthorized(`Basic ${FAKE}`)).toBe(false);
    expect(isNotificationsCronAuthorized("Bearer")).toBe(false);
    expect(isNotificationsCronAuthorized("Bearer ")).toBe(false);
    expect(isNotificationsCronAuthorized("Bearer wrong-secret-value")).toBe(false);
    expect(isNotificationsCronAuthorized(`Bearer ${FAKE}`)).toBe(true);
    restoreCronEnv(prevA, prevB);
  });

  it("accepts CRON_SECRET first and NOTIFICATIONS_CRON_SECRET as alias", () => {
    const prevA = process.env.NOTIFICATIONS_CRON_SECRET;
    const prevB = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "vercel-primary-secret";
    process.env.NOTIFICATIONS_CRON_SECRET = "ops-alias-secretxx";
    expect(notificationsCronSecret()).toBe("vercel-primary-secret");
    expect(isNotificationsCronAuthorized("Bearer vercel-primary-secret")).toBe(true);
    expect(isNotificationsCronAuthorized("Bearer ops-alias-secretxx")).toBe(true);
    expect(isNotificationsCronAuthorized("Bearer neither-of-those-xx")).toBe(false);
    restoreCronEnv(prevA, prevB);
  });
});

describe("cron route GET/POST auth", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock("@/server/use-cases/notifications-hub");
  });

  async function loadRoute(secret: string) {
    vi.resetModules();
    process.env.CRON_SECRET = secret;
    delete process.env.NOTIFICATIONS_CRON_SECRET;
    vi.doMock("@/server/use-cases/notifications-hub", () => ({
      runNotificationJobs: vi.fn(async () => ({
        ok: true,
        hubSchema: true,
        reminders: 0,
        deliveries: 0,
      })),
    }));
    return import("@/app/api/internal/notifications/run/route");
  }

  it("returns 401 without or with invalid bearer on GET and POST", async () => {
    const { GET, POST } = await loadRoute(FAKE);
    const missing = await GET(new Request("http://localhost/api/internal/notifications/run"));
    const bad = await GET(
      new Request("http://localhost/api/internal/notifications/run", {
        headers: { authorization: "Bearer wrong-secret-value" },
      }),
    );
    const postBad = await POST(new Request("http://localhost/api/internal/notifications/run", { method: "POST" }));
    expect(missing.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(postBad.status).toBe(401);
  });

  it("authorizes GET and POST with the same valid bearer and does not invoke email", async () => {
    const { GET, POST } = await loadRoute(FAKE);
    const headers = { authorization: `Bearer ${FAKE}` };
    const getRes = await GET(new Request("http://localhost/api/internal/notifications/run", { headers }));
    const postRes = await POST(
      new Request("http://localhost/api/internal/notifications/run", { method: "POST", headers }),
    );
    expect(getRes.status).toBe(200);
    expect(postRes.status).toBe(200);
    expect(await getRes.json()).toEqual({
      ok: true,
      hubSchema: true,
      reminders: 0,
      deliveries: 0,
    });
  });
});

describe("cron secret hygiene", () => {
  it("does not log authorization, bearer, or env secret names as values", () => {
    const files = [
      join(process.cwd(), "src/modules/notifications/cron-auth.ts"),
      join(process.cwd(), "src/app/api/internal/notifications/run/route.ts"),
      join(process.cwd(), "src/lib/supabase/middleware.ts"),
      join(process.cwd(), "src/lib/http/session-gate.ts"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/console\.(log|info|debug|warn|error)\([^)]*authorization/i);
      expect(text).not.toMatch(/logger\.(info|warn|error|debug)\([^)]*Bearer/i);
    }
  });

  it("does not open other internal API prefixes", () => {
    const mw = readFileSync(join(process.cwd(), "src/lib/supabase/middleware.ts"), "utf8");
    expect(mw).toContain("isNotificationsCronPath");
    expect(mw).not.toContain('startsWith("/api/internal")');
    expect(mw).not.toContain('startsWith("/api/")');
  });
});
