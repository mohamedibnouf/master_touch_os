import type { AuthContext } from "@/types/models";
import { can } from "@/lib/permissions/evaluate";
import type { ManagementSectionFlags } from "@/modules/management/types";

/** Gate for /management area — reuses existing seeded permission (no migration 061). */
export const MANAGEMENT_VIEW_PERMISSION = "reports.management.read" as const;

function orgCan(ctx: AuthContext, key: Parameters<typeof can>[1]): boolean {
  return can(ctx.grants, key, { organizationId: ctx.organization.id });
}

export function canViewManagement(ctx: AuthContext): boolean {
  return orgCan(ctx, MANAGEMENT_VIEW_PERMISSION);
}

/**
 * Section visibility within the command center.
 * Broader management view does not grant HR/payroll/finance field access.
 * Query flags are further narrowed so we do not hit RLS-denied tables.
 */
export function resolveManagementSections(ctx: AuthContext): ManagementSectionFlags {
  const projects = orgCan(ctx, "project.read") || orgCan(ctx, "project.read_all");
  const approvals =
    orgCan(ctx, "approval.review") || orgCan(ctx, "approval.approve") || orgCan(ctx, "approval.create");

  const purchaseRequests = orgCan(ctx, "purchase_request.read");
  const rfqs = orgCan(ctx, "rfq.read");
  const purchaseOrders = orgCan(ctx, "purchase_order.read");
  const supplierInvoices =
    orgCan(ctx, "supplier_invoice.read") || orgCan(ctx, "finance.read");
  const procurement = purchaseRequests || rfqs || purchaseOrders || supplierInvoices;

  const finance =
    orgCan(ctx, "finance.read") ||
    orgCan(ctx, "commercial_reports.read") ||
    orgCan(ctx, "client_invoice.read") ||
    orgCan(ctx, "supplier_invoice.read");

  const employeeHeadcount = orgCan(ctx, "employee.read") || orgCan(ctx, "employee.manage");
  const compliance = orgCan(ctx, "employee_compliance.read") || orgCan(ctx, "employee.manage");
  const contracts = orgCan(ctx, "employee_contract.read") || orgCan(ctx, "employee.manage");
  const people = employeeHeadcount || compliance || contracts;

  const attendanceLeave =
    orgCan(ctx, "attendance.view_all") ||
    orgCan(ctx, "attendance.view_team") ||
    orgCan(ctx, "attendance.manage") ||
    orgCan(ctx, "leave.view_all") ||
    orgCan(ctx, "leave.manage") ||
    orgCan(ctx, "leave.view_team");

  const payroll =
    orgCan(ctx, "payroll.view_all") ||
    orgCan(ctx, "payroll.prepare") ||
    orgCan(ctx, "payroll.review") ||
    orgCan(ctx, "payroll.approve");
  const payrollAmounts = orgCan(ctx, "payroll.view_all");
  const activity = orgCan(ctx, "audit.read");

  return {
    projects,
    approvals,
    procurement,
    purchaseRequests,
    rfqs,
    purchaseOrders,
    supplierInvoices,
    finance,
    people,
    employeeHeadcount,
    compliance,
    contracts,
    attendanceLeave,
    payroll,
    payrollAmounts,
    activity,
  };
}
