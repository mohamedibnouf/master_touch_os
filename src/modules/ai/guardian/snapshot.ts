import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYmd } from "@/modules/management/riyadh-date";
import { emptyRiskInput } from "@/modules/management/risk/engine";
import { MANAGEMENT_RISK_THRESHOLDS } from "@/modules/management/risk/thresholds";
import type { RiskInputSnapshot } from "@/modules/management/risk/types";
import type { ManagementSectionFlags } from "@/modules/management/types";
import { GUARDIAN_MAX_ROWS_PER_FAMILY, GUARDIAN_PAGE_SIZE } from "./constants";
import type { GuardianScanCoverage } from "./types";

type PageResult<T> = { rows: T[]; complete: boolean };

async function selectPages<T>(
  label: string,
  runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  let from = 0;
  while (from < GUARDIAN_MAX_ROWS_PER_FAMILY) {
    const to = Math.min(from + GUARDIAN_PAGE_SIZE, GUARDIAN_MAX_ROWS_PER_FAMILY) - 1;
    const { data, error } = await runPage(from, to);
    if (error) {
      console.error(`[guardian] ${label} failed:`, error);
      return { rows, complete: false };
    }
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < GUARDIAN_PAGE_SIZE) return { rows, complete: true };
    from += GUARDIAN_PAGE_SIZE;
  }
  return { rows, complete: false };
}

export const GUARDIAN_ALL_SECTIONS: ManagementSectionFlags = {
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

export async function loadGuardianRiskInput(
  supabase: SupabaseClient,
  organizationId: string,
  asOfDate: string,
  asOfInstant: string,
  sections: ManagementSectionFlags = GUARDIAN_ALL_SECTIONS,
): Promise<{ input: RiskInputSnapshot; coverage: GuardianScanCoverage }> {
  const input = emptyRiskInput(asOfDate, asOfInstant, sections);
  const truncatedFamilies: string[] = [];
  const in30 = addDaysYmd(asOfDate, MANAGEMENT_RISK_THRESHOLDS.expiryWarningDays);

  async function take<T>(family: string, page: Promise<PageResult<T>>): Promise<T[]> {
    const result = await page;
    if (!result.complete) truncatedFamilies.push(family);
    return result.rows;
  }

  if (sections.projects) {
    input.projects = await take(
      "projects",
      selectPages("projects", (from, to) =>
        supabase
          .from("projects")
          .select("id, project_code, name_ar, status, risk_level, planned_end_date")
          .eq("organization_id", organizationId)
          .in("status", ["active", "on_hold"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.approvals) {
    input.approvals = await take(
      "approvals",
      selectPages("approvals", (from, to) =>
        supabase
          .from("approval_requests")
          .select("id, title, status, due_at, created_at, entity_type, entity_id")
          .eq("organization_id", organizationId)
          .in("status", ["pending", "in_progress"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.purchaseRequests) {
    input.purchaseRequests = await take(
      "purchase_requests",
      selectPages("prs", (from, to) =>
        supabase
          .from("purchase_requests")
          .select("id, pr_number, status, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["submitted", "under_review"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.rfqs) {
    input.rfqs = await take(
      "rfqs",
      selectPages("rfqs", (from, to) =>
        supabase
          .from("rfqs")
          .select("id, rfq_number, status, response_due_date, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["issued", "responses_received"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.purchaseOrders) {
    input.purchaseOrders = await take(
      "purchase_orders",
      selectPages("pos", (from, to) =>
        supabase
          .from("purchase_orders")
          .select("id, po_number, status, required_delivery_date")
          .eq("organization_id", organizationId)
          .in("status", [
            "draft",
            "pending_approval",
            "approved",
            "issued",
            "partially_delivered",
            "partially_invoiced",
            "invoiced",
          ])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.supplierInvoices || sections.finance) {
    input.supplierInvoices = await take(
      "supplier_invoices",
      selectPages("supplierInv", (from, to) =>
        supabase
          .from("supplier_invoices")
          .select("id, invoice_number, status, due_date")
          .eq("organization_id", organizationId)
          .in("status", [
            "received",
            "under_review",
            "matched",
            "discrepancy",
            "approved_for_payment",
            "partially_paid",
          ])
          .not("due_date", "is", null)
          .lt("due_date", asOfDate)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.finance) {
    input.clientInvoices = await take(
      "client_invoices",
      selectPages("clientInv", (from, to) =>
        supabase
          .from("client_invoices")
          .select("id, invoice_number, status, due_date")
          .eq("organization_id", organizationId)
          .in("status", ["issued", "partially_paid", "overdue"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
    input.valuations = await take(
      "valuations",
      selectPages("valuations", (from, to) =>
        supabase
          .from("client_valuations")
          .select("id, valuation_number, status, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["internal_review", "submitted", "under_client_review"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
    input.variations = await take(
      "variations",
      selectPages("variations", (from, to) =>
        supabase
          .from("variations")
          .select("id, vo_number, status, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["under_review", "submitted", "negotiation"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.compliance) {
    input.compliance = await take(
      "compliance",
      selectPages("compliance", (from, to) =>
        supabase
          .from("employee_compliance")
          .select("employee_id, iqama_expiry, passport_expiry, work_permit_expiry, insurance_expiry")
          .eq("organization_id", organizationId)
          .or(
            [
              `iqama_expiry.lte.${in30}`,
              `passport_expiry.lte.${in30}`,
              `work_permit_expiry.lte.${in30}`,
              `insurance_expiry.lte.${in30}`,
            ].join(","),
          )
          .order("employee_id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.contracts) {
    input.contracts = await take(
      "contracts",
      selectPages("contracts", (from, to) =>
        supabase
          .from("employee_contracts")
          .select("id, employee_id, contract_number, end_date")
          .eq("organization_id", organizationId)
          .eq("is_current", true)
          .gte("end_date", asOfDate)
          .lte("end_date", in30)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.attendanceLeave) {
    input.attendanceToday = await take(
      "attendance",
      selectPages("attendance", (from, to) =>
        supabase
          .from("attendance_records")
          .select("id, employee_id, attendance_status")
          .eq("organization_id", organizationId)
          .eq("attendance_date", asOfDate)
          .in("attendance_status", ["missing_checkout", "absent"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
    input.leavePending = await take(
      "leave",
      selectPages("leave", (from, to) =>
        supabase
          .from("leave_requests")
          .select("id, created_at")
          .eq("organization_id", organizationId)
          .eq("status", "submitted")
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
  }

  if (sections.payroll) {
    const periods = await take(
      "payroll_periods",
      selectPages<{
        id: string;
        year: number;
        month: number;
        status: string;
        created_at: string;
        updated_at: string | null;
      }>("payrollPeriods", (from, to) =>
        supabase
          .from("payroll_periods")
          .select("id, year, month, status, created_at, updated_at")
          .eq("organization_id", organizationId)
          .in("status", ["under_review", "approved", "locked"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    );
    const lockedIds = periods.filter((p) => p.status === "locked").map((p) => p.id);
    const unpaidByPeriod = new Map<string, number>();
    if (lockedIds.length > 0) {
      const unpaid = await take(
        "payroll_entries",
        selectPages<{ id: string; payroll_period_id: string }>("payrollUnpaid", (from, to) =>
          supabase
            .from("payroll_entries")
            .select("id, payroll_period_id")
            .eq("organization_id", organizationId)
            .in("payroll_period_id", lockedIds)
            .neq("payment_status", "paid")
            .order("id", { ascending: true })
            .range(from, to),
        ),
      );
      for (const row of unpaid) {
        unpaidByPeriod.set(row.payroll_period_id, (unpaidByPeriod.get(row.payroll_period_id) ?? 0) + 1);
      }
    }
    input.payrollPeriods = periods.map((p) => ({
      ...p,
      unpaidEntryCount: unpaidByPeriod.get(p.id) ?? 0,
    }));
  }

  return {
    input,
    coverage: { complete: truncatedFamilies.length === 0, truncatedFamilies },
  };
}
