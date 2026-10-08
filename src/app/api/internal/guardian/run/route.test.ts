import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/use-cases/guardian", () => ({
  runGuardianJobs: vi.fn(async () => ({ ok: true, schemaReady: false, organizations: 0 })),
}));

describe("guardian cron route", () => {
  it("rejects unauthorized callers", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/internal/guardian/run"));
    expect(res.status).toBe(401);
  });
});
