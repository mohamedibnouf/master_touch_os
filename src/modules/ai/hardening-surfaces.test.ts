import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("AI surface integrity", () => {
  it("does not expose OpenAI keys to the client", () => {
    const cfg = readFileSync("src/modules/ai/config-env.ts", "utf8");
    expect(cfg).toContain("Never reads NEXT_PUBLIC_OPENAI_API_KEY");
    expect(cfg).not.toMatch(/process\.env\.NEXT_PUBLIC_OPENAI/);
    const env = readFileSync("src/lib/env.ts", "utf8");
    expect(env).not.toMatch(/NEXT_PUBLIC_OPENAI/);
  });

  it("does not call OpenAI on project AI card or management insights render", () => {
    const card = readFileSync("src/components/ai/project-ai-card.tsx", "utf8");
    expect(card).toContain("useTransition");
    expect(card).not.toMatch(/useEffect[\s\S]*analyzeProjectIntelligenceAction/);
    const insights = readFileSync("src/components/ai/management-ai-insights.tsx", "utf8");
    expect(insights).not.toMatch(/useEffect[\s\S]*refreshManagementInsightsAction/);
    const dashboard = readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(dashboard).not.toContain("getManagementInsightFactsAction");
    expect(dashboard).toContain("loadDashboardViz");
  });

  it("keeps document analysis on the document page and business-case extract on intelligence", () => {
    const detail = readFileSync("src/app/(app)/documents/[id]/page.tsx", "utf8");
    const intel = readFileSync("src/app/(app)/documents/[id]/intelligence/page.tsx", "utf8");
    expect(detail).toContain("DocumentAiAnalysisPanel");
    expect(intel).not.toContain("DocumentAiAnalysisPanel");
    expect(intel).toContain("DocumentIntelligenceActions");
    expect(intel).toContain("صفحة المستند");
  });

  it("does not use alert() for document intelligence errors", () => {
    const actions = readFileSync("src/components/documents/document-intelligence-actions.tsx", "utf8");
    expect(actions).not.toContain("alert(");
    expect(actions).toContain("doc-intel-error");
  });
});
