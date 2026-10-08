import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("auth context request graph", () => {
  it("loads identity in one PostgREST bundle after getUser", () => {
    const src = readFileSync("src/server/context.ts", "utf8");
    expect(src).toContain("export const getAuthContext = cache(loadAuthContext)");
    expect(src).toContain("organization_members(");
    expect(src).toContain("employees(");
    expect(src).toContain("user_roles(");
    expect(src.match(/\.from\("profiles"\)/g)?.length).toBe(1);
    expect(src).not.toMatch(/await supabase\s*\.from\("organization_members"\)/);
    expect(src).not.toMatch(/await supabase\s*\.from\("employees"\)/);
    expect(src).not.toMatch(/await supabase\s*\.from\("user_roles"\)/);
  });
});
