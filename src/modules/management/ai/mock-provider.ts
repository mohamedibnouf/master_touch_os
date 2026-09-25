import { managementAIRawResponseSchema, type ManagementAIProvider, type ManagementAIRawResponse } from "./schema";

/**
 * Deterministic provider for CI/E2E — never calls external APIs.
 * Grounds responses in supplied context source IDs only.
 */
export function createMockManagementAIProvider(): ManagementAIProvider {
  return {
    id: "mock",
    model: "mock-v1",
    async analyze(input): Promise<ManagementAIRawResponse> {
      let payload: { data?: Record<string, unknown>; sources?: string[] } = {};
      try {
        payload = JSON.parse(input.userPayload) as typeof payload;
      } catch {
        payload = {};
      }
      const data = payload.data ?? {};
      const sourceIds = Array.isArray(data.sourceIds)
        ? (data.sourceIds as string[])
        : Object.keys((payload as { sources?: Record<string, unknown> }).sources ?? {});

      const risks = Array.isArray(data.risks) ? (data.risks as Array<Record<string, unknown>>) : [];
      const brief = Array.isArray(data.decisionBrief)
        ? (data.decisionBrief as Array<{ statements?: Array<{ ref?: string; text?: string }> }>)
        : [];

      const findings = risks.slice(0, 5).map((r) => ({
        title: String(r.title ?? "Risk"),
        explanation: String(r.explanation ?? ""),
        severity: (r.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined) ?? undefined,
        sourceRefs: typeof r.ref === "string" ? [r.ref] : [],
        isOfficialRisk: true,
      }));

      const suggestedReviews = brief
        .flatMap((s) => s.statements ?? [])
        .slice(0, 4)
        .map((st) => ({
          label: String(st.text ?? "Review"),
          sourceRefs: typeof st.ref === "string" ? [st.ref] : [],
        }));

      // Intentionally include a bogus ref to prove server drops it (tests assert this).
      if (sourceIds.length > 0) {
        findings.push({
          title: "Dropped bogus citation",
          explanation: "This finding cites a fake ID and must be removed by validation.",
          severity: undefined,
          sourceRefs: ["FAKE_REF_999"],
          isOfficialRisk: false,
        });
      }

      const summary =
        input.locale === "en"
          ? `Mock executive analysis as of ${String(data.asOfDate ?? "unknown")}: ${findings.filter((f) => f.sourceRefs[0] !== "FAKE_REF_999").length} grounded finding(s).`
          : `تحليل تجريبي (mock) بتاريخ ${String(data.asOfDate ?? "غير معروف")}: ${(findings.filter((f) => f.sourceRefs[0] !== "FAKE_REF_999").length)} نتيجة موثّقة.`;

      const raw = {
        summary,
        findings,
        suggestedReviews,
        limitations: [
          "Mock provider — deterministic local response for tests.",
          "No external LLM was called.",
        ],
      };

      return managementAIRawResponseSchema.parse(raw);
    },
  };
}
