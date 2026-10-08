import { afterEach, describe, expect, it, vi } from "vitest";
import { GUARDIAN_CRON_PATH, requiresInteractiveLogin } from "@/lib/http/session-gate";

const FAKE = "e6-test-cron-secret";
const runGuardianJobs = vi.fn(async () => ({
  ok: true,
  schemaReady: false,
  organizations: 0,
  skippedReason: "migration_084_unapplied",
}));

describe("guardian cron route", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock("@/server/use-cases/guardian");
    runGuardianJobs.mockClear();
  });

  async function loadRoute(secret: string) {
    vi.resetModules();
    process.env.CRON_SECRET = secret;
    delete process.env.NOTIFICATIONS_CRON_SECRET;
    vi.doMock("@/server/use-cases/guardian", () => ({ runGuardianJobs }));
    return import("./route");
  }

  it("is exempt from interactive login but not from Bearer authorization", () => {
    expect(requiresInteractiveLogin(GUARDIAN_CRON_PATH)).toBe(false);
    expect(requiresInteractiveLogin("/management/risks")).toBe(true);
  });

  it("returns 401 without a Bearer token and does not start a scan", async () => {
    const { GET } = await loadRoute(FAKE);
    const res = await GET(new Request("http://localhost/api/internal/guardian/run"));
    expect(res.status).toBe(401);
    expect(runGuardianJobs).not.toHaveBeenCalled();
  });

  it("returns 401 with an invalid token and does not start a scan", async () => {
    const { GET } = await loadRoute(FAKE);
    const res = await GET(
      new Request("http://localhost/api/internal/guardian/run", {
        headers: { authorization: "Bearer wrong-secret-value" },
      }),
    );
    expect(res.status).toBe(401);
    expect(runGuardianJobs).not.toHaveBeenCalled();
  });

  it("reaches the route with a valid Bearer token", async () => {
    const { GET } = await loadRoute(FAKE);
    const res = await GET(
      new Request("http://localhost/api/internal/guardian/run", {
        headers: { authorization: `Bearer ${FAKE}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(runGuardianJobs).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
