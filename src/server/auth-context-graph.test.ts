import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("auth context request graph", () => {
  it("loads identity with proven split queries, not a nested profiles embed", () => {
    const src = readFileSync("src/server/context.ts", "utf8");
    expect(src).toContain("export const getAuthContext = cache(loadAuthContext)");
    expect(src).toContain(".from(\"organization_members\")");
    expect(src).toContain(".from(\"employees\")");
    expect(src).toContain(".from(\"user_roles\")");
    expect(src).not.toContain("organization_members(organization_id");
    expect(src).toContain("employeeResult.data ?? null");
  });
});
