import type { PermissionKey } from "@/lib/permissions/catalog";

export type PermissionGroupId =
  | "organization"
  | "department"
  | "job_title"
  | "project"
  | "user"
  | "role"
  | "document"
  | "approval"
  | "finance"
  | "employee"
  | "leave"
  | "attendance"
  | "payroll"
  | "reports"
  | "audit"
  | "notification"
  | "workflow"
  | "settings"
  | "engineering"
  | "procurement"
  | "commercial"
  | "other";

export const PERMISSION_GROUP_LABELS: Record<PermissionGroupId, { ar: string; en: string }> = {
  organization: { ar: "المنشأة", en: "Organization" },
  department: { ar: "الإدارات", en: "Departments" },
  job_title: { ar: "المسميات الوظيفية", en: "Job titles" },
  project: { ar: "المشاريع", en: "Projects" },
  user: { ar: "المستخدمون", en: "Users" },
  role: { ar: "الأدوار", en: "Roles" },
  document: { ar: "الوثائق", en: "Documents" },
  approval: { ar: "الاعتمادات", en: "Approvals" },
  finance: { ar: "المالية", en: "Finance" },
  employee: { ar: "الموظفون / الموارد البشرية", en: "Employees / HR" },
  leave: { ar: "الإجازات", en: "Leave" },
  attendance: { ar: "الحضور", en: "Attendance" },
  payroll: { ar: "الرواتب", en: "Payroll" },
  reports: { ar: "التقارير", en: "Reports" },
  audit: { ar: "التدقيق", en: "Audit" },
  notification: { ar: "التنبيهات", en: "Notifications" },
  workflow: { ar: "سير العمل", en: "Workflow" },
  settings: { ar: "الإعدادات", en: "Settings" },
  engineering: { ar: "الهندسة ومراقبة الوثائق", en: "Engineering" },
  procurement: { ar: "المشتريات", en: "Procurement" },
  commercial: { ar: "التجاري", en: "Commercial" },
  other: { ar: "أخرى", en: "Other" },
};

const RESOURCE_TO_GROUP: Record<string, PermissionGroupId> = {
  organization: "organization",
  department: "department",
  job_title: "job_title",
  project: "project",
  user: "user",
  role: "role",
  document: "document",
  document_control: "engineering",
  document_intelligence: "document",
  approval: "approval",
  finance: "finance",
  employee: "employee",
  employee_compliance: "employee",
  employee_contract: "employee",
  employee_compensation: "employee",
  employee_document: "employee",
  employee_bank: "employee",
  hr_alert: "employee",
  leave: "leave",
  attendance: "attendance",
  payroll: "payroll",
  reports: "reports",
  audit: "audit",
  notification: "notification",
  workflow: "workflow",
  settings: "settings",
  engineering: "engineering",
  rfi: "engineering",
  submittal: "engineering",
  shop_drawing: "engineering",
  method_statement: "engineering",
  inspection: "engineering",
  ncr: "engineering",
  report: "engineering",
  correspondence: "engineering",
  transmittal: "engineering",
  supplier: "procurement",
  procurement: "procurement",
  purchase_request: "procurement",
  rfq: "procurement",
  quotation: "procurement",
  purchase_order: "procurement",
  goods_receipt: "procurement",
  supplier_invoice: "finance",
  supplier_payment: "finance",
  project_budget: "finance",
  client_valuation: "commercial",
  client_invoice: "commercial",
  client_payment: "commercial",
  variation: "commercial",
  commercial_reports: "commercial",
  ai: "reports",
};

export function permissionGroupForKey(key: PermissionKey | string): PermissionGroupId {
  const resource = key.split(".")[0] ?? "other";
  return RESOURCE_TO_GROUP[resource] ?? "other";
}

export function groupPermissionKeys(keys: readonly PermissionKey[]): Array<{
  id: PermissionGroupId;
  labelAr: string;
  keys: PermissionKey[];
}> {
  const buckets = new Map<PermissionGroupId, PermissionKey[]>();
  for (const key of keys) {
    const id = permissionGroupForKey(key);
    const list = buckets.get(id) ?? [];
    list.push(key);
    buckets.set(id, list);
  }
  return [...buckets.entries()]
    .map(([id, grouped]) => ({
      id,
      labelAr: PERMISSION_GROUP_LABELS[id].ar,
      keys: grouped.sort(),
    }))
    .sort((a, b) => a.labelAr.localeCompare(b.labelAr, "ar"));
}
