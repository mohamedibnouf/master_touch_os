import { describe, expect, it } from "vitest";
import { isPostgresUuid } from "@/lib/postgres-uuid";

describe("postgres uuid vs RFC uuid", () => {
  it("accepts Master Touch seed role ids", () => {
    expect(isPostgresUuid("20000000-0000-0000-0000-000000000007")).toBe(true);
    expect(isPostgresUuid("20000000-0000-0000-0000-000000000001")).toBe(true);
  });

  it("rejects codes and truncated values", () => {
    expect(isPostgresUuid("engineer")).toBe(false);
    expect(isPostgresUuid("20000000-0000-0000-0000-00000000000")).toBe(false);
  });
});
