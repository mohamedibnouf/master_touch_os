import { describe, expect, it } from "vitest";
import { buildAttentionFromFindings } from "@/modules/management/attention";
import { addDaysYmd, riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { findingId } from "@/modules/management/risk/date-utils";
import type { RiskFinding } from "@/modules/management/risk/types";

function f(partial: Partial<RiskFinding> & Pick<RiskFinding, "ruleId" | "severity" | "category">): RiskFinding {
  const sourceType = partial.sourceType ?? "project";
  const sourceId = partial.sourceId ?? "x";
  return {
    id: findingId(partial.ruleId, sourceType, sourceId),
    titleAr: partial.titleAr ?? "عنوان",
    titleEn: partial.titleEn ?? "title",
    explanationAr: partial.explanationAr ?? "سبب",
    explanationEn: partial.explanationEn ?? "reason",
    evidence: {},
    sourceType,
    sourceId,
    href: partial.href ?? "/projects/x",
    effectiveSince: null,
    ageDays: null,
    ...partial,
  };
}

describe("management attention from risk findings", () => {
  it("emits nothing when findings are empty", () => {
    expect(buildAttentionFromFindings([])).toEqual([]);
  });

  it("aggregates by ruleId and prefers highest severity", () => {
    const items = buildAttentionFromFindings([
      f({
        ruleId: "APPROVAL_PAST_DUE",
        category: "APPROVAL_DELAY",
        severity: "MEDIUM",
        sourceId: "a1",
        explanationEn: "due_at passed",
      }),
      f({
        ruleId: "APPROVAL_PAST_DUE",
        category: "APPROVAL_DELAY",
        severity: "HIGH",
        sourceId: "a2",
        explanationEn: "due_at passed",
      }),
      f({
        ruleId: "PAYROLL_WAITING_REVIEW",
        category: "PAYROLL",
        severity: "HIGH",
        sourceId: "p1",
      }),
    ]);
    expect(items[0].category).toBe("APPROVAL_DELAY");
    expect(items[0].severity).toBe("HIGH");
    expect(items[0].count).toBe(2);
    expect(items.some((i) => i.id === "PAYROLL_WAITING_REVIEW")).toBe(true);
  });

  it("single finding keeps source href; multiple link to risks page", () => {
    const one = buildAttentionFromFindings([
      f({
        ruleId: "MISSING_CHECKOUT",
        category: "ATTENDANCE",
        severity: "MEDIUM",
        href: "/hr/attendance",
      }),
    ]);
    expect(one[0].href).toBe("/hr/attendance");

    const many = buildAttentionFromFindings([
      f({
        ruleId: "MISSING_CHECKOUT",
        category: "ATTENDANCE",
        severity: "MEDIUM",
        sourceId: "1",
        href: "/hr/attendance",
      }),
      f({
        ruleId: "MISSING_CHECKOUT",
        category: "ATTENDANCE",
        severity: "MEDIUM",
        sourceId: "2",
        href: "/hr/attendance",
      }),
    ]);
    expect(many[0].href).toBe("/management/risks");
  });
});

describe("riyadh date helpers", () => {
  it("formats YYYY-MM-DD for Asia/Riyadh", () => {
    const ymd = riyadhTodayYmd(new Date("2026-09-19T22:30:00Z"));
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("adds calendar days in UTC date space", () => {
    expect(addDaysYmd("2026-09-19", 30)).toBe("2026-10-19");
  });
});
