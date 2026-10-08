import { describe, expect, it } from "vitest";
import {
  buildExecutiveIntelligenceFacts,
  EXECUTIVE_PROJECT_SAMPLE_CAP,
  percentOf,
  uniqueProjectsById,
} from "./facts-builder";

const P1 = {
  id: "11111111-1111-1111-1111-111111111111",
  project_code: "MT-1",
  name_ar: "أ",
  status: "active",
  planned_end_date: "2026-10-01",
  risk_level: "high",
};
const P2 = {
  id: "22222222-2222-2222-2222-222222222222",
  project_code: "MT-2",
  name_ar: "ب",
  status: "active",
  planned_end_date: "2026-12-01",
  risk_level: "low",
};

describe("executive intelligence facts", () => {
  it("computes overdue count, percent, and Riyadh day delta", () => {
    const facts = buildExecutiveIntelligenceFacts({
      asOf: "2026-10-08",
      canProjects: true,
      canApprovals: true,
      canPeople: true,
      canFinance: false,
      projects: [P1, P2],
      overdueStageCount: 0,
      pendingApprovalCount: 3,
      pendingApprovalRows: [],
      progressSample: [{ id: P2.id, nameAr: "ب", percent: 40, hint: "2 من 5", href: `/projects/${P2.id}` }],
      activeEmployeeCount: 12,
    });
    const overdue = facts.metrics.find((m) => m.key === "projects.overdue_planned_end");
    const pct = facts.metrics.find((m) => m.key === "projects.overdue_percent");
    expect(overdue?.value).toBe(1);
    expect(pct?.value).toBe(50);
    expect(facts.delayedProjects[0]?.overdueDays).toBe(7);
    expect(facts.knownNumbers).toContain(50);
    expect(facts.operationalSummaryAr).toContain("50%");
    expect(facts.operationalSummaryAr).toContain("آسيا/الرياض");
  });

  it("returns null percent when denominator is zero", () => {
    expect(percentOf(1, 0)).toBeNull();
    const facts = buildExecutiveIntelligenceFacts({
      asOf: "2026-10-08",
      canProjects: true,
      canApprovals: false,
      canPeople: false,
      canFinance: false,
      projects: [],
      overdueStageCount: 0,
      pendingApprovalCount: null,
      pendingApprovalRows: [],
      progressSample: [],
      activeEmployeeCount: null,
    });
    const pct = facts.metrics.find((m) => m.key === "projects.overdue_percent");
    expect(pct?.value).toBeNull();
    expect(pct?.availability).toBe("NOT_AVAILABLE");
  });

  it("keeps zero distinct from missing", () => {
    const facts = buildExecutiveIntelligenceFacts({
      asOf: "2026-10-08",
      canProjects: true,
      canApprovals: true,
      canPeople: false,
      canFinance: false,
      projects: [P2],
      overdueStageCount: 0,
      pendingApprovalCount: 0,
      pendingApprovalRows: [],
      progressSample: [],
      activeEmployeeCount: null,
    });
    expect(facts.metrics.find((m) => m.key === "projects.overdue_planned_end")?.value).toBe(0);
    expect(facts.metrics.find((m) => m.key === "approvals.pending")?.value).toBe(0);
    expect(facts.metrics.find((m) => m.key === "people.active_employees")).toBeUndefined();
    expect(facts.metrics.find((m) => m.key === "finance.portfolio_variance")?.availability).toBe("NOT_AVAILABLE");
  });

  it("does not include project metrics without project permission", () => {
    const facts = buildExecutiveIntelligenceFacts({
      asOf: "2026-10-08",
      canProjects: false,
      canApprovals: false,
      canPeople: false,
      canFinance: false,
      projects: [P1],
      overdueStageCount: null,
      pendingApprovalCount: null,
      pendingApprovalRows: [],
      progressSample: [],
      activeEmployeeCount: null,
    });
    expect(facts.metrics.some((m) => m.key.startsWith("projects."))).toBe(false);
  });

  it("does not double-count duplicate project ids", () => {
    const facts = buildExecutiveIntelligenceFacts({
      asOf: "2026-10-08",
      canProjects: true,
      canApprovals: false,
      canPeople: false,
      canFinance: false,
      projects: [P1, P1, P2],
      overdueStageCount: 0,
      pendingApprovalCount: null,
      pendingApprovalRows: [],
      progressSample: [],
      activeEmployeeCount: null,
    });
    expect(uniqueProjectsById([P1, P1, P2])).toHaveLength(2);
    expect(facts.metrics.find((m) => m.key === "projects.active")?.value).toBe(2);
    expect(facts.metrics.find((m) => m.key === "projects.overdue_planned_end")?.value).toBe(1);
    expect(facts.allowedProjectIds).toEqual([P1.id, P2.id]);
  });

  it("uses census for org-wide percent instead of a capped sample", () => {
    const sample = Array.from({ length: EXECUTIVE_PROJECT_SAMPLE_CAP }, (_, i) => ({
      ...P2,
      id: `22222222-2222-2222-2222-${String(i).padStart(12, "0")}`,
      planned_end_date: i < 40 ? "2026-10-01" : "2026-12-01",
    }));
    const facts = buildExecutiveIntelligenceFacts({
      asOf: "2026-10-08",
      canProjects: true,
      canApprovals: false,
      canPeople: false,
      canFinance: false,
      projects: sample,
      census: { total: 900, active: 800, tracked: 850, overduePlannedEnd: 17 },
      portfolioCapped: true,
      overdueStageCount: 0,
      pendingApprovalCount: null,
      pendingApprovalRows: [],
      progressSample: [],
      activeEmployeeCount: null,
    });
    expect(facts.metrics.find((m) => m.key === "projects.active")?.value).toBe(800);
    expect(facts.metrics.find((m) => m.key === "projects.overdue_planned_end")?.value).toBe(17);
    expect(facts.metrics.find((m) => m.key === "projects.overdue_percent")?.value).toBe(2);
    expect(facts.metrics.find((m) => m.key === "projects.overdue_percent")?.availability).toBe(
      "AVAILABLE_AND_RELIABLE",
    );
    expect(facts.metrics.find((m) => m.key === "projects.overdue_percent")?.denominator).toBe(850);
    expect(facts.operationalSummaryAr).toContain("2%");
    expect(facts.operationalSummaryAr).not.toContain("10%");
  });

  it("excludes org-wide percent when the portfolio is capped without a census", () => {
    const facts = buildExecutiveIntelligenceFacts({
      asOf: "2026-10-08",
      canProjects: true,
      canApprovals: false,
      canPeople: false,
      canFinance: false,
      projects: [P1, P2],
      portfolioCapped: true,
      overdueStageCount: 0,
      pendingApprovalCount: null,
      pendingApprovalRows: [],
      progressSample: [{ id: P2.id, nameAr: "ب", percent: 91.5, hint: "عينة", href: `/projects/${P2.id}` }],
      activeEmployeeCount: null,
    });
    expect(facts.metrics.find((m) => m.key === "projects.overdue_percent")?.value).toBeNull();
    expect(facts.metrics.find((m) => m.key === "projects.overdue_percent")?.availability).toBe("NOT_AVAILABLE");
    expect(facts.metrics.find((m) => m.key === "projects.active")?.value).toBe(2);
    expect(facts.metrics.find((m) => m.key === "projects.active")?.availability).toBe("PARTIAL");
    expect(facts.metrics.find((m) => m.key === "workflow.avg_progress_sample")?.availability).toBe("PARTIAL");
    expect(facts.operationalSummaryAr).not.toContain("%");
  });
});
