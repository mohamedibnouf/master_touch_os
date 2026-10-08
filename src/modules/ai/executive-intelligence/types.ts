export type MetricAvailability = "AVAILABLE_AND_RELIABLE" | "PARTIAL" | "NOT_AVAILABLE";

export type ExecutiveMetric = {
  key: string;
  labelAr: string;
  value: number | null;
  unit: "count" | "percent" | "days";
  source: string;
  definitionAr: string;
  asOf: string;
  scopeAr: string;
  denominator: number | null;
  availability: MetricAvailability;
};

export type ExecutiveProjectRow = {
  id: string;
  projectCode: string;
  nameAr: string;
  status: string;
  plannedEndDate: string | null;
  overdueDays: number | null;
  riskLevel: string | null;
  href: string;
};

export type ExecutiveProgressRow = {
  id: string;
  nameAr: string;
  percent: number;
  hint: string;
  href: string;
};

export type ExecutiveApprovalRow = {
  id: string;
  titleAr: string;
  href: string;
};

export type ExecutiveIntelligenceFacts = {
  followUpProjects: number;
  overdueStages: number;
  pendingApprovals: number;
  projectNotes: Array<{ id: string; nameAr: string; reasonAr: string; href: string }>;
  dataAsOf: string;
  metrics: ExecutiveMetric[];
  delayedProjects: ExecutiveProjectRow[];
  progressSample: ExecutiveProgressRow[];
  pendingApprovalRows: ExecutiveApprovalRow[];
  allowedProjectIds: string[];
  allowedHrefs: string[];
  allowedRolesAr: string[];
  knownNumbers: number[];
  limitationsAr: string[];
  operationalSummaryAr: string;
  sections: {
    projects: boolean;
    approvals: boolean;
    people: boolean;
    finance: boolean;
  };
};
