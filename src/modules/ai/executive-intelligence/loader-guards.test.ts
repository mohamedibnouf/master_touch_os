import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canViewManagementAi } from "@/modules/ai/security/permissions";

describe("executive intelligence loader guards", () => {
  it("scopes queries to the actor organization and management permission", () => {
    const src = readFileSync("src/server/use-cases/executive-intelligence-facts.ts", "utf8");
    expect(src).toContain("canViewManagementAi(ctx)");
    expect(src).toContain('.eq("organization_id", orgId)');
    expect(src).toContain('{ count: "exact", head: true }');
    expect(src).toContain("EXECUTIVE_DELAYED_PROJECT_LIMIT");
    expect(src).not.toContain("limit(400)");
    expect(src).not.toMatch(/from\("project_budgets"\)/);
    expect(src).not.toMatch(/from\("payroll/);
    expect(src).not.toContain("createOpenAIProvider");
    expect(src).not.toContain("explainManagementInsights");
  });

  it("does not call OpenAI from the dashboard page", () => {
    const src = readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(src).toContain("ExecutiveIntelligenceBlock");
    expect(src).toContain("Suspense");
    expect(src).not.toContain("createOpenAIProvider");
    expect(src).not.toContain("refreshManagementInsightsAction");
    expect(src).not.toContain("openai");
  });

  it("denies management AI without a context", () => {
    expect(canViewManagementAi(null)).toBe(false);
  });
});
