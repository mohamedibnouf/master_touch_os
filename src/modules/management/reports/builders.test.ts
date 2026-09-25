import { describe, expect, it } from "vitest";
import { toCsv, csvEscape } from "@/lib/export/csv";
import { buildDecisionBrief } from "@/modules/management/reports/decision-brief";
import {
  buildExecutiveReport,
  buildFinanceReport,
  buildPayrollReport,
  buildPeopleReport,
  buildProjectReport,
  buildRiskReport,
} from "@/modules/management/reports/builders";
import type { ManagementReportContext } from "@/modules/management/reports/types";
import type { ManagementSectionFlags, ManagementSnapshot } from "@/modules/management/types";
import { emptyRiskInput } from "@/modules/management/risk/engine";
import { findingId } from "@/modules/management/risk/date-utils";
import type { RiskFinding } from "@/modules/management/risk/types";

const sectionsAll: ManagementSectionFlags = {
  projects: true,
  approvals: true,
  procurement: true,
  purchaseRequests: true,
  rfqs: true,
  purchaseOrders: true,
  supplierInvoices: true,
  finance: true,
  people: true,
  employeeHeadcount: true,
  compliance: true,
  contracts: true,
  attendanceLeave: true,
  payroll: true,
  payrollAmounts: false,
  activity: true,
};

function ctx(overrides: Partial<ManagementReportContext> = {}): ManagementReportContext {
  return {
    organizationId: "org-1",
    organizationNameAr: "منشأة",
    organizationNameEn: "Org",
    asOfDate: "2026-09-20",
    generatedAt: "2026-09-20T10:00:00.000Z",
    sections: sectionsAll,
    fromDate: null,
    toDate: null,
    ...overrides,
  };
}

function emptySnapshot(partial: Partial<ManagementSnapshot> = {}): ManagementSnapshot {
  return {
    asOfDate: "2026-09-20",
    risks: [],
    attention: [],
    projects: { active: 0, atRisk: 0, onHold: 0, overduePlannedEnd: 0 },
    approvals: { pending: 0, overdue: 0, assignedToMe: 0, recentlyRejected: 0 },
    procurement: {
      prAwaitingReview: 0,
      rfqIssued: 0,
      rfqNeedsComparison: 0,
      poReadyToIssue: 0,
      lateDeliveries: 0,
      invoicesAwaitingReview: 0,
    },
    commercial: {
      outstandingAr: 0,
      overdueAr: 0,
      overdueAp: 0,
      pendingValuations: 0,
      openVariations: 0,
    },
    people: {
      activeEmployees: 0,
      complianceExpiring30d: 0,
      contractsEnding30d: 0,
      onLeaveToday: 0,
    },
    attendance: {
      present: 0,
      late: 0,
      absent: 0,
      missingCheckout: 0,
      pendingLeaveApprovals: 0,
    },
    payroll: {
      underReview: 0,
      approvedAwaitingLock: 0,
      lockedUnpaidEntries: 0,
      latestLabel: null,
      latestStatus: null,
      latestEmployeeCount: null,
      latestNet: null,
    },
    activity: [],
    ...partial,
  };
}

function risk(partial: Partial<RiskFinding> & Pick<RiskFinding, "ruleId" | "severity" | "category">): RiskFinding {
  const sourceType = partial.sourceType ?? "project";
  const sourceId = partial.sourceId ?? "p1";
  return {
    id: findingId(partial.ruleId, sourceType, sourceId),
    titleAr: "ت",
    titleEn: "t",
    explanationAr: "س",
    explanationEn: "e",
    evidence: { status: "active" },
    sourceType,
    sourceId,
    href: `/projects/${sourceId}`,
    effectiveSince: "2026-09-01",
    ageDays: 19,
    ...partial,
  };
}

describe("csv export", () => {
  it("escapes commas and quotes", () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(toCsv(["a", "b"], [["1", "x,y"]])).toContain('"x,y"');
    expect(toCsv(["h"], [["v"]]).startsWith("\uFEFF")).toBe(true);
  });
});

describe("decision brief", () => {
  it("emits clear summary when nothing needs attention", () => {
    const brief = buildDecisionBrief({
      snapshot: emptySnapshot(),
      sections: {
        projects: true,
        approvals: true,
        procurement: true,
        finance: true,
        people: true,
        attendanceLeave: true,
        payroll: true,
      },
    });
    expect(brief[0].id).toBe("clear");
  });

  it("maps critical risks and overdue projects to statements with hrefs", () => {
    const brief = buildDecisionBrief({
      snapshot: emptySnapshot({
        risks: [risk({ ruleId: "R1", severity: "CRITICAL", category: "PROJECT_DELAY" })],
        projects: { active: 1, atRisk: 0, onHold: 0, overduePlannedEnd: 3 },
      }),
      sections: {
        projects: true,
        approvals: false,
        procurement: false,
        finance: false,
        people: false,
        attendanceLeave: false,
        payroll: false,
      },
    });
    const attention = brief.find((b) => b.id === "attention-now");
    expect(attention?.statements.some((s) => s.id === "critical-risks")).toBe(true);
    const projects = brief.find((b) => b.id === "projects");
    expect(projects?.statements[0].textEn).toMatch(/3 project/);
    expect(projects?.statements[0].href).toBe("/management/reports/projects");
  });
});

describe("report builders", () => {
  it("executive report includes as-of freshness note and top risks", () => {
    const findings = [
      risk({ ruleId: "A", severity: "HIGH", category: "COMMERCIAL", sourceId: "1" }),
      risk({ ruleId: "B", severity: "MEDIUM", category: "HR", sourceId: "2" }),
    ];
    const report = buildExecutiveReport({
      context: ctx(),
      snapshot: emptySnapshot({ risks: findings, projects: { active: 5, atRisk: 1, onHold: 0, overduePlannedEnd: 2 } }),
    });
    expect(report.kind).toBe("executive");
    expect(report.context.asOfDate).toBe("2026-09-20");
    expect(report.freshnessNoteEn).toMatch(/As of/);
    expect(report.topRisks).toHaveLength(2);
    expect(report.decisionBrief.length).toBeGreaterThan(0);
  });

  it("project report groups overdue rows and source hrefs", () => {
    const riskInput = emptyRiskInput("2026-09-20", "2026-09-20T10:00:00.000Z", sectionsAll);
    riskInput.projects = [
      {
        id: "p1",
        project_code: "P-1",
        name_ar: "أ",
        status: "active",
        risk_level: "high",
        planned_end_date: "2026-09-01",
      },
    ];
    const report = buildProjectReport({
      context: ctx(),
      snapshot: emptySnapshot({
        projects: { active: 1, atRisk: 1, onHold: 0, overduePlannedEnd: 1 },
        risks: [
          risk({
            ruleId: "PROJECT_PLANNED_END_OVERDUE",
            severity: "HIGH",
            category: "PROJECT_DELAY",
            sourceType: "project",
            sourceId: "p1",
          }),
        ],
      }),
      riskInput,
    });
    expect(report.overdueProjects[0].href).toBe("/projects/p1");
    expect(report.overdueProjects[0].overdueDays).toBe(19);
    expect(report.declaredHighRisk).toHaveLength(1);
    expect(report.risksByProject[0].projectId).toBe("p1");
  });

  it("finance report hides metrics when finance section is off", () => {
    const report = buildFinanceReport({
      context: ctx({ sections: { ...sectionsAll, finance: false } }),
      snapshot: emptySnapshot({
        commercial: {
          outstandingAr: 9,
          overdueAr: 9,
          overdueAp: 9,
          pendingValuations: 9,
          openVariations: 9,
        },
      }),
    });
    expect(report.metrics.every((m) => !m.key.startsWith("ar-"))).toBe(true);
    expect(report.redactionNoteEn).toMatch(/reports.management.read alone/i);
  });

  it("finance report does not invent money amounts for AR counts", () => {
    const report = buildFinanceReport({
      context: ctx(),
      snapshot: emptySnapshot({
        commercial: {
          outstandingAr: 2,
          overdueAr: 1,
          overdueAp: 0,
          pendingValuations: 0,
          openVariations: 0,
        },
      }),
    });
    expect(report.metrics.some((m) => m.key === "ar-overdue")).toBe(true);
    expect(report.metrics.every((m) => !m.isMoney || m.key === "payroll-net")).toBe(true);
  });

  it("people report never includes salary/IBAN fields", () => {
    const report = buildPeopleReport({
      context: ctx(),
      snapshot: emptySnapshot({
        people: {
          activeEmployees: 10,
          complianceExpiring30d: 4,
          contractsEnding30d: 1,
          onLeaveToday: 2,
        },
      }),
      departmentDistribution: [{ nameAr: "مالية", nameEn: "Finance", count: 3 }],
    });
    const metricsBlob = JSON.stringify(report.metrics);
    expect(metricsBlob).not.toMatch(/iban|salary|net_pay|basic_salary/i);
    expect(report.metrics.every((m) => !m.isMoney)).toBe(true);
    expect(report.privacyNoteEn).toMatch(/IBAN/);
  });

  it("payroll report hides aggregate net without payrollAmounts", () => {
    const hidden = buildPayrollReport({
      context: ctx({ sections: { ...sectionsAll, payrollAmounts: false } }),
      snapshot: emptySnapshot({
        payroll: {
          underReview: 1,
          approvedAwaitingLock: 0,
          lockedUnpaidEntries: 0,
          latestLabel: "2026/08",
          latestStatus: "under_review",
          latestEmployeeCount: 12,
          latestNet: 99999,
        },
      }),
    });
    expect(hidden.amountsVisible).toBe(false);
    expect(hidden.metrics.every((m) => m.key !== "latest-net")).toBe(true);
    expect(hidden.redactionNoteEn).toMatch(/payroll.view_all/);

    const shown = buildPayrollReport({
      context: ctx({ sections: { ...sectionsAll, payrollAmounts: true } }),
      snapshot: emptySnapshot({
        payroll: {
          underReview: 0,
          approvedAwaitingLock: 0,
          lockedUnpaidEntries: 0,
          latestLabel: "2026/08",
          latestStatus: "locked",
          latestEmployeeCount: 12,
          latestNet: 5000,
        },
      }),
    });
    expect(shown.amountsVisible).toBe(true);
    expect(shown.metrics.some((m) => m.key === "latest-net" && m.isMoney)).toBe(true);
  });

  it("risk report uses provided findings and severity counts", () => {
    const findings = [
      risk({ ruleId: "A", severity: "CRITICAL", category: "PROJECT_DELAY", sourceId: "1" }),
      risk({ ruleId: "B", severity: "LOW", category: "ATTENDANCE", sourceId: "2" }),
    ];
    const report = buildRiskReport({ context: ctx(), findings });
    expect(report.total).toBe(2);
    expect(report.bySeverity.CRITICAL).toBe(1);
    expect(report.findings[0].explanationEn).toBeTruthy();
    expect(report.findings[0].href).toBeTruthy();
  });
});
