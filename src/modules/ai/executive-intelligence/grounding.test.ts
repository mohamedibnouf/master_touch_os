import { describe, expect, it } from "vitest";
import { groundManagementInsight, sanitizeInsightHref } from "./grounding";
import { buildExecutiveIntelligenceFacts } from "./facts-builder";
import type { ManagementInsight } from "../schemas";

const facts = buildExecutiveIntelligenceFacts({
  asOf: "2026-10-08",
  canProjects: true,
  canApprovals: true,
  canPeople: false,
  canFinance: false,
  projects: [
    {
      id: "cbf8f9e7-ca63-4231-8694-8a95372cbd20",
      project_code: "MT-PRJ-0496",
      name_ar: "مشروع",
      status: "active",
      planned_end_date: "2026-10-01",
      risk_level: "low",
    },
  ],
  overdueStageCount: 0,
  pendingApprovalCount: 0,
  pendingApprovalRows: [],
  progressSample: [],
  activeEmployeeCount: null,
});

function insight(partial: Partial<ManagementInsight>): ManagementInsight {
  return {
    headline_ar: "تحليل تشغيلي.",
    executive_summary_ar: "ملخص مبني على المقاييس.",
    items: [],
    observations: [],
    recommendations: [],
    limitations_ar: "",
    generated_at: "2026-10-08T16:00:00.000Z",
    data_as_of: "2026-10-08",
    ...partial,
  };
}

describe("executive insight grounding", () => {
  it("drops duplicate observations and unsupported numerical claims", () => {
    const grounded = groundManagementInsight(
      insight({
        observations: [
          {
            issue_key: "delay",
            title_ar: "تأخير",
            explanation_ar: "المشروع تجاوز بـ 7 أيام",
            evidence_ref: "cbf8f9e7-ca63-4231-8694-8a95372cbd20",
          },
          {
            issue_key: "delay",
            title_ar: "تأخير",
            explanation_ar: "المشروع تجاوز بـ 7 أيام",
            evidence_ref: "cbf8f9e7-ca63-4231-8694-8a95372cbd20",
          },
          {
            issue_key: "invented",
            title_ar: "ميزانية",
            explanation_ar: "العجز 91.5%",
            evidence_ref: null,
          },
        ],
      }),
      facts,
    );
    expect(grounded.observations).toHaveLength(1);
    expect(grounded.observations[0]?.issue_key).toBe("delay");
  });

  it("rejects nonexistent project references and javascript hrefs", () => {
    const grounded = groundManagementInsight(
      insight({
        recommendations: [
          {
            priority: "high",
            problem_ar: "تأخير مخطط",
            evidence_ar: "تجاوز بـ 7 أيام",
            impact_ar: "ضغط على التسليم",
            action_ar: "مراجعة مسار العمل في شاشة المشروع",
            owner_role_ar: "مدير مشروع",
            timeframe_ar: "خلال أسبوع",
            record_ref: "00000000-0000-0000-0000-000000000000",
            href: "javascript:alert(1)",
          },
        ],
      }),
      facts,
    );
    expect(grounded.recommendations).toHaveLength(0);
    expect(sanitizeInsightHref("javascript:alert(1)", facts.allowedHrefs)).toBeNull();
    expect(sanitizeInsightHref("/projects/cbf8f9e7-ca63-4231-8694-8a95372cbd20", facts.allowedHrefs)).toBe(
      "/projects/cbf8f9e7-ca63-4231-8694-8a95372cbd20",
    );
  });

  it("does not treat YYYY-MM-DD as an invented metric", () => {
    const grounded = groundManagementInsight(
      insight({
        observations: [
          {
            issue_key: "plan_date",
            title_ar: "تاريخ مخطط",
            explanation_ar: "التاريخ المخطط 2026-10-01 تجاوز بـ 7 أيام",
            evidence_ref: "cbf8f9e7-ca63-4231-8694-8a95372cbd20",
          },
        ],
      }),
      facts,
    );
    expect(grounded.observations).toHaveLength(1);
  });

  it("drops generic advice without evidence", () => {
    const grounded = groundManagementInsight(
      insight({
        recommendations: [
          {
            priority: "low",
            problem_ar: "تحسين عام",
            evidence_ar: "",
            impact_ar: "غير محدد",
            action_ar: "راجع الأداء بشكل عام",
            owner_role_ar: null,
            timeframe_ar: null,
            record_ref: null,
            href: null,
          },
        ],
      }),
      facts,
    );
    expect(grounded.recommendations).toHaveLength(0);
  });
});
