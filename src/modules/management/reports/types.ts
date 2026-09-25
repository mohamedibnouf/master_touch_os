import type { ManagementAttentionItem, ManagementRiskSeverity, ManagementSectionFlags, ManagementSnapshot } from "../types";
import type { RiskFinding } from "../risk/types";

/** Shared report generation context (server-trusted). */
export type ManagementReportContext = {
  organizationId: string;
  organizationNameAr: string;
  organizationNameEn: string;
  /** Riyadh calendar day YYYY-MM-DD — current-state label. */
  asOfDate: string;
  /** ISO instant when the report was generated. */
  generatedAt: string;
  sections: ManagementSectionFlags;
  /** Optional activity window start (inclusive) when historical range is used. */
  fromDate: string | null;
  /** Optional activity window end (inclusive). */
  toDate: string | null;
};

export type ReportEvidence = {
  sourceType: string;
  sourceId: string;
  labelAr: string;
  labelEn: string;
  href: string;
};

export type ReportMetric = {
  key: string;
  labelAr: string;
  labelEn: string;
  value: number | string;
  href?: string;
  /** Money values only when authorization allows; otherwise omitted upstream. */
  isMoney?: boolean;
};

export type DecisionBriefSection = {
  id: string;
  titleAr: string;
  titleEn: string;
  statements: Array<{
    id: string;
    textAr: string;
    textEn: string;
    href?: string;
    severity?: ManagementRiskSeverity;
  }>;
};

export type ManagementExecutiveReport = {
  kind: "executive";
  context: ManagementReportContext;
  metrics: ReportMetric[];
  decisionBrief: DecisionBriefSection[];
  topRisks: RiskFinding[];
  attention: ManagementAttentionItem[];
  activity: ManagementSnapshot["activity"];
  freshnessNoteAr: string;
  freshnessNoteEn: string;
};

export type ManagementProjectReport = {
  kind: "projects";
  context: ManagementReportContext;
  metrics: ReportMetric[];
  overdueProjects: Array<{
    id: string;
    projectCode: string;
    nameAr: string;
    status: string;
    plannedEndDate: string;
    overdueDays: number;
    href: string;
  }>;
  declaredHighRisk: Array<{
    id: string;
    projectCode: string;
    nameAr: string;
    riskLevel: string;
    href: string;
  }>;
  risksByProject: Array<{
    projectId: string;
    projectLabel: string;
    findings: RiskFinding[];
  }>;
  decisionBrief: DecisionBriefSection[];
};

export type ManagementOperationsReport = {
  kind: "operations";
  context: ManagementReportContext;
  metrics: ReportMetric[];
  oldestApprovals: Array<{
    id: string;
    title: string;
    status: string;
    openDays: number;
    href: string;
  }>;
  operationalRisks: RiskFinding[];
  decisionBrief: DecisionBriefSection[];
};

export type ManagementFinanceReport = {
  kind: "finance";
  context: ManagementReportContext;
  /** When false, only counts/statuses — no money fields present. */
  amountsVisible: boolean;
  metrics: ReportMetric[];
  commercialRisks: RiskFinding[];
  decisionBrief: DecisionBriefSection[];
  redactionNoteAr: string | null;
  redactionNoteEn: string | null;
};

export type ManagementPeopleReport = {
  kind: "people";
  context: ManagementReportContext;
  metrics: ReportMetric[];
  departmentDistribution: Array<{ nameAr: string; nameEn: string; count: number }>;
  peopleRisks: RiskFinding[];
  decisionBrief: DecisionBriefSection[];
  privacyNoteAr: string;
  privacyNoteEn: string;
};

export type ManagementPayrollReport = {
  kind: "payroll";
  context: ManagementReportContext;
  amountsVisible: boolean;
  metrics: ReportMetric[];
  payrollRisks: RiskFinding[];
  decisionBrief: DecisionBriefSection[];
  redactionNoteAr: string | null;
  redactionNoteEn: string | null;
};

export type ManagementRiskReport = {
  kind: "risks";
  context: ManagementReportContext;
  total: number;
  bySeverity: Record<ManagementRiskSeverity, number>;
  byCategory: Record<string, number>;
  findings: RiskFinding[];
  decisionBrief: DecisionBriefSection[];
};

export type ManagementReportKind =
  | "executive"
  | "projects"
  | "operations"
  | "finance"
  | "people"
  | "payroll"
  | "risks";

export type ReportCatalogItem = {
  kind: ManagementReportKind;
  href: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
};
