import type { ManagementRiskCategory, ManagementRiskSeverity, ManagementSectionFlags } from "../types";

export type RiskSourceType =
  | "project"
  | "approval_request"
  | "purchase_request"
  | "rfq"
  | "purchase_order"
  | "supplier_invoice"
  | "client_invoice"
  | "client_valuation"
  | "variation"
  | "employee_compliance"
  | "employee_contract"
  | "attendance_record"
  | "leave_request"
  | "payroll_period";

export type RiskFinding = {
  /** Stable identity: ruleId + sourceType + sourceId */
  id: string;
  ruleId: string;
  category: ManagementRiskCategory;
  severity: ManagementRiskSeverity;
  titleAr: string;
  titleEn: string;
  explanationAr: string;
  explanationEn: string;
  evidence: Record<string, string | number | boolean | null>;
  sourceType: RiskSourceType;
  sourceId: string;
  href: string;
  /** YYYY-MM-DD when the condition became true (if known). */
  effectiveSince: string | null;
  /** Age in whole days when computable from asOfDate. */
  ageDays: number | null;
};

export type RiskProjectRow = {
  id: string;
  project_code: string;
  name_ar: string;
  status: string;
  risk_level: string | null;
  planned_end_date: string | null;
};

export type RiskApprovalRow = {
  id: string;
  title: string | null;
  status: string;
  due_at: string | null;
  created_at: string;
  entity_type: string | null;
  entity_id: string | null;
};

export type RiskPrRow = {
  id: string;
  pr_number: string | null;
  status: string;
  created_at: string;
};

export type RiskRfqRow = {
  id: string;
  rfq_number: string | null;
  status: string;
  response_due_date: string | null;
  created_at: string;
};

export type RiskPoRow = {
  id: string;
  po_number: string | null;
  status: string;
  required_delivery_date: string | null;
};

export type RiskSupplierInvoiceRow = {
  id: string;
  invoice_number: string | null;
  status: string;
  due_date: string | null;
};

export type RiskClientInvoiceRow = {
  id: string;
  invoice_number: string | null;
  status: string;
  due_date: string | null;
};

export type RiskValuationRow = {
  id: string;
  valuation_number: string | null;
  status: string;
  created_at: string;
};

export type RiskVariationRow = {
  id: string;
  vo_number: string | null;
  status: string;
  created_at: string;
};

export type RiskComplianceRow = {
  employee_id: string;
  iqama_expiry: string | null;
  passport_expiry: string | null;
  work_permit_expiry: string | null;
  insurance_expiry: string | null;
};

export type RiskContractRow = {
  id: string;
  employee_id: string;
  contract_number: string;
  end_date: string | null;
};

export type RiskAttendanceRow = {
  id: string;
  employee_id: string;
  attendance_status: string;
};

export type RiskLeaveRow = {
  id: string;
  created_at: string;
};

export type RiskPayrollPeriodRow = {
  id: string;
  year: number;
  month: number;
  status: string;
  created_at: string;
  updated_at: string | null;
  unpaidEntryCount: number;
};

/** Bounded operational rows for pure rule evaluation (no DB inside rules). */
export type RiskInputSnapshot = {
  asOfDate: string;
  asOfInstant: string;
  sections: ManagementSectionFlags;
  projects: RiskProjectRow[];
  approvals: RiskApprovalRow[];
  purchaseRequests: RiskPrRow[];
  rfqs: RiskRfqRow[];
  purchaseOrders: RiskPoRow[];
  supplierInvoices: RiskSupplierInvoiceRow[];
  clientInvoices: RiskClientInvoiceRow[];
  valuations: RiskValuationRow[];
  variations: RiskVariationRow[];
  compliance: RiskComplianceRow[];
  contracts: RiskContractRow[];
  attendanceToday: RiskAttendanceRow[];
  leavePending: RiskLeaveRow[];
  payrollPeriods: RiskPayrollPeriodRow[];
};

export type RiskRule = {
  id: string;
  category: ManagementRiskCategory;
  evaluate: (input: RiskInputSnapshot) => RiskFinding[];
};
