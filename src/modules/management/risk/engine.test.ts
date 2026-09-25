import { describe, expect, it } from "vitest";
import {
  countBySeverity,
  dedupeFindings,
  emptyRiskInput,
  evaluateRisks,
  filterFindings,
  sortFindings,
  summarizeFindingsAsAttention,
} from "@/modules/management/risk/engine";
import { MANAGEMENT_RISK_THRESHOLDS as T } from "@/modules/management/risk/thresholds";
import { daysBetweenYmd, findingId } from "@/modules/management/risk/date-utils";
import type { ManagementSectionFlags } from "@/modules/management/types";
import type { RiskFinding, RiskInputSnapshot } from "@/modules/management/risk/types";

const AS_OF = "2026-09-19";
const AS_OF_INSTANT = "2026-09-19T12:00:00.000Z";

const allSections: ManagementSectionFlags = {
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
  activity: false,
};

function snap(partial: Partial<RiskInputSnapshot> = {}): RiskInputSnapshot {
  return {
    ...emptyRiskInput(AS_OF, AS_OF_INSTANT, allSections),
    ...partial,
    sections: partial.sections ?? allSections,
  };
}

function finding(overrides: Partial<RiskFinding> & Pick<RiskFinding, "ruleId" | "severity">): RiskFinding {
  const sourceType = overrides.sourceType ?? "project";
  const sourceId = overrides.sourceId ?? "src-1";
  return {
    id: findingId(overrides.ruleId, sourceType, sourceId),
    category: overrides.category ?? "PROJECT_DELAY",
    titleAr: overrides.titleAr ?? "t",
    titleEn: overrides.titleEn ?? "t",
    explanationAr: overrides.explanationAr ?? "e",
    explanationEn: overrides.explanationEn ?? "e",
    evidence: overrides.evidence ?? {},
    sourceType,
    sourceId,
    href: overrides.href ?? "/x",
    effectiveSince: overrides.effectiveSince ?? null,
    ageDays: overrides.ageDays ?? null,
    ...overrides,
  };
}

describe("daysBetweenYmd", () => {
  it("returns 0 for same day", () => {
    expect(daysBetweenYmd("2026-09-19", "2026-09-19")).toBe(0);
  });
  it("returns positive when to > from", () => {
    expect(daysBetweenYmd("2026-09-18", "2026-09-19")).toBe(1);
  });
});

describe("PROJECT_PLANNED_END_OVERDUE", () => {
  it("does not flag planned_end_date equal to asOfDate", () => {
    const findings = evaluateRisks(
      snap({
        projects: [
          {
            id: "p1",
            project_code: "P-1",
            name_ar: "أ",
            status: "active",
            risk_level: "low",
            planned_end_date: AS_OF,
          },
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "PROJECT_PLANNED_END_OVERDUE")).toHaveLength(0);
  });

  it("flags one day overdue active project as MEDIUM", () => {
    const findings = evaluateRisks(
      snap({
        projects: [
          {
            id: "p1",
            project_code: "P-1",
            name_ar: "أ",
            status: "active",
            risk_level: "low",
            planned_end_date: "2026-09-18",
          },
        ],
      }),
    );
    const hit = findings.find((f) => f.ruleId === "PROJECT_PLANNED_END_OVERDUE");
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe("MEDIUM");
    expect(hit!.ageDays).toBe(1);
    expect(hit!.href).toBe("/projects/p1");
    expect(hit!.explanationEn).toMatch(/1 days ago/);
  });

  it("does not flag completed project with past planned_end_date", () => {
    const findings = evaluateRisks(
      snap({
        projects: [
          {
            id: "p1",
            project_code: "P-1",
            name_ar: "أ",
            status: "completed",
            risk_level: "high",
            planned_end_date: "2026-01-01",
          },
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "PROJECT_PLANNED_END_OVERDUE")).toHaveLength(0);
  });

  it("escalates severity by overdue duration", () => {
    const high = evaluateRisks(
      snap({
        projects: [
          {
            id: "p1",
            project_code: "P-1",
            name_ar: "أ",
            status: "active",
            risk_level: null,
            planned_end_date: "2026-09-05", // 14 days
          },
        ],
      }),
    ).find((f) => f.ruleId === "PROJECT_PLANNED_END_OVERDUE");
    expect(high?.severity).toBe("HIGH");

    const critical = evaluateRisks(
      snap({
        projects: [
          {
            id: "p2",
            project_code: "P-2",
            name_ar: "ب",
            status: "active",
            risk_level: null,
            planned_end_date: "2026-08-20", // 30 days
          },
        ],
      }),
    ).find((f) => f.ruleId === "PROJECT_PLANNED_END_OVERDUE");
    expect(critical?.severity).toBe("CRITICAL");
  });
});

describe("CLIENT_INVOICE_OVERDUE", () => {
  it("does not flag invoice due today", () => {
    const findings = evaluateRisks(
      snap({
        clientInvoices: [
          { id: "i1", invoice_number: "INV-1", status: "issued", due_date: AS_OF },
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "CLIENT_INVOICE_OVERDUE")).toHaveLength(0);
  });

  it("flags invoice past due_date", () => {
    const findings = evaluateRisks(
      snap({
        clientInvoices: [
          { id: "i1", invoice_number: "INV-1", status: "issued", due_date: "2026-09-11" },
        ],
      }),
    );
    const hit = findings.find((f) => f.ruleId === "CLIENT_INVOICE_OVERDUE");
    expect(hit).toBeTruthy();
    expect(hit!.ageDays).toBe(8);
    expect(hit!.explanationEn).toMatch(/INV-1/);
    expect(JSON.stringify(hit!.evidence)).not.toMatch(/amount|net|iban/i);
  });
});

describe("COMPLIANCE boundaries", () => {
  it("31 days remaining → no COMPLIANCE_EXPIRING when threshold is 30", () => {
    const findings = evaluateRisks(
      snap({
        compliance: [
          {
            employee_id: "e1",
            iqama_expiry: "2026-10-20", // 31 days from 2026-09-19
            passport_expiry: null,
            work_permit_expiry: null,
            insurance_expiry: null,
          },
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "COMPLIANCE_EXPIRING")).toHaveLength(0);
    expect(T.expiryWarningDays).toBe(30);
  });

  it("30 days remaining → COMPLIANCE_EXPIRING", () => {
    const findings = evaluateRisks(
      snap({
        compliance: [
          {
            employee_id: "e1",
            iqama_expiry: "2026-10-19",
            passport_expiry: null,
            work_permit_expiry: null,
            insurance_expiry: null,
          },
        ],
      }),
    );
    expect(findings.some((f) => f.ruleId === "COMPLIANCE_EXPIRING")).toBe(true);
  });

  it("0 days (expires today) → COMPLIANCE_EXPIRING", () => {
    const findings = evaluateRisks(
      snap({
        compliance: [
          {
            employee_id: "e1",
            iqama_expiry: AS_OF,
            passport_expiry: null,
            work_permit_expiry: null,
            insurance_expiry: null,
          },
        ],
      }),
    );
    const hit = findings.find((f) => f.ruleId === "COMPLIANCE_EXPIRING");
    expect(hit).toBeTruthy();
    expect(hit!.evidence.days_remaining).toBe(0);
  });

  it("past expiry → COMPLIANCE_EXPIRED", () => {
    const findings = evaluateRisks(
      snap({
        compliance: [
          {
            employee_id: "e1",
            iqama_expiry: "2026-09-10",
            passport_expiry: null,
            work_permit_expiry: null,
            insurance_expiry: null,
          },
        ],
      }),
    );
    expect(findings.some((f) => f.ruleId === "COMPLIANCE_EXPIRED")).toBe(true);
    expect(findings.some((f) => f.ruleId === "COMPLIANCE_EXPIRING")).toBe(false);
  });
});

describe("APPROVAL_PENDING_AGE boundaries", () => {
  it("below medium threshold → no finding", () => {
    const created = "2026-09-17T10:00:00.000Z"; // 2 days before asOf in Riyadh
    const findings = evaluateRisks(
      snap({
        approvals: [
          {
            id: "a1",
            title: "Req",
            status: "pending",
            due_at: null,
            created_at: created,
            entity_type: null,
            entity_id: null,
          },
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "APPROVAL_PENDING_AGE")).toHaveLength(0);
  });

  it("at medium threshold → MEDIUM finding", () => {
    const created = "2026-09-16T10:00:00.000Z"; // 3 days
    const findings = evaluateRisks(
      snap({
        approvals: [
          {
            id: "a1",
            title: "Req",
            status: "pending",
            due_at: null,
            created_at: created,
            entity_type: null,
            entity_id: null,
          },
        ],
      }),
    );
    const hit = findings.find((f) => f.ruleId === "APPROVAL_PENDING_AGE");
    expect(hit?.severity).toBe("MEDIUM");
    expect(hit?.explanationEn).toMatch(/not a contractual SLA/);
  });
});

describe("PAYROLL rules", () => {
  it("under_review emits PAYROLL_WAITING_REVIEW without amounts", () => {
    const findings = evaluateRisks(
      snap({
        payrollPeriods: [
          {
            id: "pp1",
            year: 2026,
            month: 8,
            status: "under_review",
            created_at: "2026-09-10T00:00:00.000Z",
            updated_at: "2026-09-10T00:00:00.000Z",
            unpaidEntryCount: 0,
          },
        ],
      }),
    );
    const hit = findings.find((f) => f.ruleId === "PAYROLL_WAITING_REVIEW");
    expect(hit).toBeTruthy();
    expect(JSON.stringify(hit)).not.toMatch(/net|salary|iban|gross/i);
  });

  it("locked with unpaid entries emits PAYROLL_LOCKED_UNPAID", () => {
    const findings = evaluateRisks(
      snap({
        payrollPeriods: [
          {
            id: "pp1",
            year: 2026,
            month: 8,
            status: "locked",
            created_at: "2026-09-01T00:00:00.000Z",
            updated_at: "2026-09-15T00:00:00.000Z",
            unpaidEntryCount: 4,
          },
        ],
      }),
    );
    expect(findings.some((f) => f.ruleId === "PAYROLL_LOCKED_UNPAID")).toBe(true);
  });

  it("locked with zero unpaid → no PAYROLL_LOCKED_UNPAID", () => {
    const findings = evaluateRisks(
      snap({
        payrollPeriods: [
          {
            id: "pp1",
            year: 2026,
            month: 8,
            status: "locked",
            created_at: "2026-09-01T00:00:00.000Z",
            updated_at: null,
            unpaidEntryCount: 0,
          },
        ],
      }),
    );
    expect(findings.filter((f) => f.ruleId === "PAYROLL_LOCKED_UNPAID")).toHaveLength(0);
  });
});

describe("authorization section gating", () => {
  it("skips project rules when projects section is false", () => {
    const findings = evaluateRisks(
      snap({
        sections: { ...allSections, projects: false },
        projects: [
          {
            id: "p1",
            project_code: "P-1",
            name_ar: "أ",
            status: "active",
            risk_level: "critical",
            planned_end_date: "2026-01-01",
          },
        ],
      }),
    );
    expect(findings.every((f) => f.category !== "PROJECT_DELAY")).toBe(true);
  });
});

describe("sort / dedupe / attention summary", () => {
  it("sorts CRITICAL before HIGH before MEDIUM before LOW", () => {
    const sorted = sortFindings([
      finding({ ruleId: "A", severity: "LOW", sourceId: "1", effectiveSince: "2026-09-01" }),
      finding({ ruleId: "B", severity: "CRITICAL", sourceId: "2", effectiveSince: "2026-09-10" }),
      finding({ ruleId: "C", severity: "MEDIUM", sourceId: "3", effectiveSince: "2026-09-05" }),
      finding({ ruleId: "D", severity: "HIGH", sourceId: "4", effectiveSince: "2026-09-02" }),
    ]);
    expect(sorted.map((f) => f.severity)).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
  });

  it("deduplicates identical finding ids", () => {
    const a = finding({ ruleId: "R1", severity: "HIGH", sourceId: "s1" });
    expect(dedupeFindings([a, { ...a }])).toHaveLength(1);
  });

  it("summarizes findings into attention by ruleId", () => {
    const findings = [
      finding({
        ruleId: "PROJECT_PLANNED_END_OVERDUE",
        severity: "MEDIUM",
        sourceId: "p1",
        titleAr: "مشروع تجاوز",
        explanationAr: "سبب",
      }),
      finding({
        ruleId: "PROJECT_PLANNED_END_OVERDUE",
        severity: "HIGH",
        sourceId: "p2",
        titleAr: "مشروع تجاوز",
        explanationAr: "سبب2",
      }),
    ];
    const attention = summarizeFindingsAsAttention(findings);
    expect(attention).toHaveLength(1);
    expect(attention[0].count).toBe(2);
    expect(attention[0].severity).toBe("HIGH");
    expect(attention[0].href).toBe("/management/risks");
  });

  it("filterFindings applies severity and category", () => {
    const list = [
      finding({ ruleId: "R1", severity: "HIGH", category: "PAYROLL", sourceId: "1" }),
      finding({ ruleId: "R2", severity: "LOW", category: "HR", sourceId: "2" }),
    ];
    expect(filterFindings(list, { severity: "HIGH" })).toHaveLength(1);
    expect(filterFindings(list, { category: "HR" })).toHaveLength(1);
    expect(countBySeverity(list).HIGH).toBe(1);
  });
});

describe("declared project risk", () => {
  it("PROJECT_DECLARED_HIGH_RISK uses operational risk_level only", () => {
    const findings = evaluateRisks(
      snap({
        projects: [
          {
            id: "p1",
            project_code: "P-1",
            name_ar: "أ",
            status: "active",
            risk_level: "high",
            planned_end_date: null,
          },
        ],
      }),
    );
    const hit = findings.find((f) => f.ruleId === "PROJECT_DECLARED_HIGH_RISK");
    expect(hit?.severity).toBe("HIGH");
    expect(hit?.explanationEn).toMatch(/declared/);
  });
});
