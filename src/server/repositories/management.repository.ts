import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYmd, riyadhTodayYmd } from "@/modules/management/riyadh-date";
import { buildAttentionFromFindings } from "@/modules/management/attention";
import { emptyRiskInput, evaluateRisks } from "@/modules/management/risk/engine";
import { MANAGEMENT_RISK_THRESHOLDS } from "@/modules/management/risk/thresholds";
import type { RiskFinding, RiskInputSnapshot } from "@/modules/management/risk/types";
import type { ManagementSectionFlags, ManagementSnapshot } from "@/modules/management/types";

const LIMIT = MANAGEMENT_RISK_THRESHOLDS.candidateLimit;

async function countExact(
  query: PromiseLike<{ count: number | null; error: unknown }>,
  label = "count",
): Promise<number> {
  const { count, error } = await query;
  if (error) {
    let detail = "";
    try {
      detail = JSON.stringify(error);
    } catch {
      detail = String(error);
    }
    console.error(`[management] ${label} failed:`, detail);
    return 0;
  }
  return count ?? 0;
}

async function selectRows<T>(
  label: string,
  run: () => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const { data, error } = await run();
  if (error) {
    let detail = "";
    try {
      detail = JSON.stringify(error);
    } catch {
      detail = String(error);
    }
    console.error(`[management] ${label} failed:`, detail);
    return [];
  }
  return data ?? [];
}

/**
 * Org-scoped management aggregates + risk inputs.
 * organizationId must come from authenticated server context only.
 * Sections run sequentially to avoid statement-timeout under heavy RLS.
 */
export class ManagementRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadRiskInputSnapshot(
    organizationId: string,
    sections: ManagementSectionFlags,
    asOfDate: string,
    asOfInstant: string,
  ): Promise<RiskInputSnapshot> {
    const input = emptyRiskInput(asOfDate, asOfInstant, sections);
    const in30 = addDaysYmd(asOfDate, MANAGEMENT_RISK_THRESHOLDS.expiryWarningDays);

    if (sections.projects) {
      // Prefer overdue / declared-high-risk candidates so the row cap does not
      // starve the rules that need the oldest planned_end_date rows.
      input.projects = await selectRows("risk.projects", () =>
        this.supabase
          .from("projects")
          .select("id, project_code, name_ar, status, risk_level, planned_end_date")
          .eq("organization_id", organizationId)
          .in("status", ["active", "on_hold"])
          .or(
            `planned_end_date.lt.${asOfDate},risk_level.in.(high,critical)`,
          )
          .order("planned_end_date", { ascending: true, nullsFirst: false })
          .limit(LIMIT),
      );
    }

    if (sections.approvals) {
      input.approvals = await selectRows("risk.approvals", () =>
        this.supabase
          .from("approval_requests")
          .select("id, title, status, due_at, created_at, entity_type, entity_id")
          .eq("organization_id", organizationId)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: true })
          .limit(LIMIT),
      );
    }

    if (sections.purchaseRequests) {
      input.purchaseRequests = await selectRows("risk.prs", () =>
        this.supabase
          .from("purchase_requests")
          .select("id, pr_number, status, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["submitted", "under_review"])
          .order("created_at", { ascending: true })
          .limit(LIMIT),
      );
    }

    if (sections.rfqs) {
      input.rfqs = await selectRows("risk.rfqs", () =>
        this.supabase
          .from("rfqs")
          .select("id, rfq_number, status, response_due_date, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["issued", "responses_received"])
          .limit(LIMIT),
      );
    }

    if (sections.purchaseOrders) {
      input.purchaseOrders = await selectRows("risk.pos", () =>
        this.supabase
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
          .limit(LIMIT),
      );
    }

    if (sections.supplierInvoices || sections.finance) {
      input.supplierInvoices = await selectRows("risk.supplierInv", () =>
        this.supabase
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
          .limit(LIMIT),
      );
    }

    if (sections.finance) {
      input.clientInvoices = await selectRows("risk.clientInv", () =>
        this.supabase
          .from("client_invoices")
          .select("id, invoice_number, status, due_date")
          .eq("organization_id", organizationId)
          .in("status", ["issued", "partially_paid", "overdue"])
          .limit(LIMIT),
      );
      input.valuations = await selectRows("risk.valuations", () =>
        this.supabase
          .from("client_valuations")
          .select("id, valuation_number, status, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["internal_review", "submitted", "under_client_review"])
          .order("created_at", { ascending: true })
          .limit(LIMIT),
      );
      input.variations = await selectRows("risk.variations", () =>
        this.supabase
          .from("variations")
          .select("id, vo_number, status, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["under_review", "submitted", "negotiation"])
          .order("created_at", { ascending: true })
          .limit(LIMIT),
      );
    }

    if (sections.compliance) {
      input.compliance = await selectRows("risk.compliance", () =>
        this.supabase
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
          .limit(LIMIT),
      );
    }

    if (sections.contracts) {
      input.contracts = await selectRows("risk.contracts", () =>
        this.supabase
          .from("employee_contracts")
          .select("id, employee_id, contract_number, end_date")
          .eq("organization_id", organizationId)
          .eq("is_current", true)
          .gte("end_date", asOfDate)
          .lte("end_date", in30)
          .limit(LIMIT),
      );
    }

    if (sections.attendanceLeave) {
      input.attendanceToday = await selectRows("risk.attendance", () =>
        this.supabase
          .from("attendance_records")
          .select("id, employee_id, attendance_status")
          .eq("organization_id", organizationId)
          .eq("attendance_date", asOfDate)
          .in("attendance_status", ["missing_checkout", "absent"])
          .limit(LIMIT),
      );
      input.leavePending = await selectRows("risk.leave", () =>
        this.supabase
          .from("leave_requests")
          .select("id, created_at")
          .eq("organization_id", organizationId)
          .eq("status", "submitted")
          .order("created_at", { ascending: true })
          .limit(LIMIT),
      );
    }

    if (sections.payroll) {
      const periods = await selectRows<{
        id: string;
        year: number;
        month: number;
        status: string;
        created_at: string;
        updated_at: string | null;
      }>("risk.payrollPeriods", () =>
        this.supabase
          .from("payroll_periods")
          .select("id, year, month, status, created_at, updated_at")
          .eq("organization_id", organizationId)
          .in("status", ["under_review", "approved", "locked"])
          .limit(LIMIT),
      );

      const lockedIds = periods.filter((p) => p.status === "locked").map((p) => p.id);
      const unpaidByPeriod = new Map<string, number>();
      if (lockedIds.length > 0) {
        const unpaid = await selectRows<{ id: string; payroll_period_id: string }>(
          "risk.payrollUnpaid",
          () =>
            this.supabase
              .from("payroll_entries")
              .select("id, payroll_period_id")
              .eq("organization_id", organizationId)
              .in("payroll_period_id", lockedIds)
              .neq("payment_status", "paid")
              .limit(LIMIT),
        );
        for (const row of unpaid) {
          unpaidByPeriod.set(
            row.payroll_period_id,
            (unpaidByPeriod.get(row.payroll_period_id) ?? 0) + 1,
          );
        }
      }

      input.payrollPeriods = periods.map((p) => ({
        id: p.id,
        year: p.year,
        month: p.month,
        status: p.status,
        created_at: p.created_at,
        updated_at: p.updated_at,
        unpaidEntryCount: unpaidByPeriod.get(p.id) ?? 0,
      }));
    }

    return input;
  }

  async loadRiskFindings(
    organizationId: string,
    sections: ManagementSectionFlags,
  ): Promise<{ asOfDate: string; risks: RiskFinding[] }> {
    const today = riyadhTodayYmd();
    const nowIso = new Date().toISOString();
    const riskInput = await this.loadRiskInputSnapshot(organizationId, sections, today, nowIso);
    return { asOfDate: today, risks: evaluateRisks(riskInput) };
  }

  async loadSnapshot(
    organizationId: string,
    profileId: string,
    sections: ManagementSectionFlags,
  ): Promise<ManagementSnapshot> {
    const today = riyadhTodayYmd();
    const in30 = addDaysYmd(today, 30);
    const nowIso = new Date().toISOString();
    const rejectedSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const projects = sections.projects
      ? {
          active: await countExact(
            this.supabase
              .from("projects")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "active"),
            "projects.active",
          ),
          atRisk: await countExact(
            this.supabase
              .from("projects")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "active")
              .in("risk_level", ["high", "critical"]),
            "projects.atRisk",
          ),
          onHold: await countExact(
            this.supabase
              .from("projects")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "on_hold"),
            "projects.onHold",
          ),
          overduePlannedEnd: await countExact(
            this.supabase
              .from("projects")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "active")
              .lt("planned_end_date", today)
              .not("planned_end_date", "is", null),
            "projects.overdueEnd",
          ),
        }
      : { active: 0, atRisk: 0, onHold: 0, overduePlannedEnd: 0 };

    const approvals = sections.approvals
      ? {
          pending: await countExact(
            this.supabase
              .from("approval_requests")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .in("status", ["pending", "in_progress"]),
            "approvals.pending",
          ),
          overdue: await countExact(
            this.supabase
              .from("approval_requests")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .in("status", ["pending", "in_progress"])
              .lt("due_at", nowIso),
            "approvals.overdue",
          ),
          assignedToMe: await countExact(
            this.supabase
              .from("approval_steps")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("user_id", profileId)
              .in("status", ["pending", "in_progress"]),
            "approvals.mine",
          ),
          recentlyRejected: await countExact(
            this.supabase
              .from("approval_actions")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("decision", "rejected")
              .gte("created_at", rejectedSince),
            "approvals.rejected",
          ),
        }
      : { pending: 0, overdue: 0, assignedToMe: 0, recentlyRejected: 0 };

    const procurement = {
      prAwaitingReview: sections.purchaseRequests
        ? await countExact(
            this.supabase
              .from("purchase_requests")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .in("status", ["submitted", "under_review"]),
            "prAwaiting",
          )
        : 0,
      rfqIssued: sections.rfqs
        ? await countExact(
            this.supabase
              .from("rfqs")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "issued"),
            "rfqIssued",
          )
        : 0,
      rfqNeedsComparison: sections.rfqs
        ? await countExact(
            this.supabase
              .from("rfqs")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "responses_received"),
            "rfqCompare",
          )
        : 0,
      poReadyToIssue: sections.purchaseOrders
        ? await countExact(
            this.supabase
              .from("purchase_orders")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "approved"),
            "poReady",
          )
        : 0,
      lateDeliveries: sections.purchaseOrders
        ? await countExact(
            this.supabase
              .from("purchase_orders")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .lt("required_delivery_date", today)
              .not("required_delivery_date", "is", null)
              .in("status", [
                "draft",
                "pending_approval",
                "approved",
                "issued",
                "partially_delivered",
                "partially_invoiced",
                "invoiced",
              ]),
            "poLate",
          )
        : 0,
      invoicesAwaitingReview: sections.supplierInvoices
        ? await countExact(
            this.supabase
              .from("supplier_invoices")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .in("status", ["received", "under_review"]),
            "invReview",
          )
        : 0,
    };

    const commercial = sections.finance
      ? {
          outstandingAr: await countExact(
            this.supabase
              .from("client_invoices")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .in("status", ["issued", "partially_paid", "overdue"]),
            "ar.outstanding",
          ),
          overdueAr: await countExact(
            this.supabase
              .from("client_invoices")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .or(`status.eq.overdue,and(due_date.lt.${today},status.in.(issued,partially_paid,overdue))`),
            "ar.overdue",
          ),
          overdueAp: await countExact(
            this.supabase
              .from("supplier_invoices")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .lt("due_date", today)
              .not("due_date", "is", null)
              .in("status", [
                "received",
                "under_review",
                "matched",
                "discrepancy",
                "approved_for_payment",
                "partially_paid",
              ]),
            "ap.overdue",
          ),
          pendingValuations: await countExact(
            this.supabase
              .from("client_valuations")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .in("status", ["internal_review", "submitted", "under_client_review"]),
            "valuations",
          ),
          openVariations: await countExact(
            this.supabase
              .from("variations")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .in("status", ["under_review", "submitted", "negotiation"]),
            "variations",
          ),
        }
      : null;

    const people = sections.people
      ? {
          activeEmployees: sections.employeeHeadcount
            ? await countExact(
                this.supabase
                  .from("employees")
                  .select("id", { count: "exact", head: true })
                  .eq("organization_id", organizationId)
                  .eq("is_active", true),
                "employees",
              )
            : 0,
          complianceExpiring30d: sections.compliance
            ? await countExact(
                this.supabase
                  .from("employee_compliance")
                  .select("id", { count: "exact", head: true })
                  .eq("organization_id", organizationId)
                  .or(
                    [
                      `and(iqama_expiry.gte.${today},iqama_expiry.lte.${in30})`,
                      `and(passport_expiry.gte.${today},passport_expiry.lte.${in30})`,
                      `and(work_permit_expiry.gte.${today},work_permit_expiry.lte.${in30})`,
                      `and(insurance_expiry.gte.${today},insurance_expiry.lte.${in30})`,
                    ].join(","),
                  ),
                "compliance",
              )
            : 0,
          contractsEnding30d: sections.contracts
            ? await countExact(
                this.supabase
                  .from("employee_contracts")
                  .select("id", { count: "exact", head: true })
                  .eq("organization_id", organizationId)
                  .eq("is_current", true)
                  .gte("end_date", today)
                  .lte("end_date", in30),
                "contracts",
              )
            : 0,
          onLeaveToday: sections.attendanceLeave
            ? await countExact(
                this.supabase
                  .from("leave_requests")
                  .select("id", { count: "exact", head: true })
                  .eq("organization_id", organizationId)
                  .eq("status", "approved")
                  .lte("start_date", today)
                  .gte("end_date", today),
                "onLeave",
              )
            : 0,
        }
      : null;

    const attendance = sections.attendanceLeave
      ? {
          present: await countExact(
            this.supabase
              .from("attendance_records")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("attendance_date", today)
              .eq("attendance_status", "present"),
            "att.present",
          ),
          late: await countExact(
            this.supabase
              .from("attendance_records")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("attendance_date", today)
              .eq("attendance_status", "late"),
            "att.late",
          ),
          absent: await countExact(
            this.supabase
              .from("attendance_records")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("attendance_date", today)
              .eq("attendance_status", "absent"),
            "att.absent",
          ),
          missingCheckout: await countExact(
            this.supabase
              .from("attendance_records")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("attendance_date", today)
              .eq("attendance_status", "missing_checkout"),
            "att.mco",
          ),
          pendingLeaveApprovals: await countExact(
            this.supabase
              .from("leave_requests")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("status", "submitted"),
            "leave.pending",
          ),
        }
      : null;

    let payroll: ManagementSnapshot["payroll"] = null;
    if (sections.payroll) {
      const latest = await this.supabase
        .from("payroll_periods")
        .select("year, month, status, employee_count, total_net")
        .eq("organization_id", organizationId)
        .neq("status", "cancelled")
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) {
        console.error("[management] payroll.latest failed:", JSON.stringify(latest.error));
      }
      const row = latest.data;
      payroll = {
        underReview: await countExact(
          this.supabase
            .from("payroll_periods")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "under_review"),
          "payroll.underReview",
        ),
        approvedAwaitingLock: await countExact(
          this.supabase
            .from("payroll_periods")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "approved"),
          "payroll.approved",
        ),
        lockedUnpaidEntries: await countExact(
          this.supabase
            .from("payroll_entries")
            .select("id, payroll_periods!inner(status)", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("payroll_periods.status", "locked")
            .neq("payment_status", "paid"),
          "payroll.lockedUnpaid",
        ),
        latestLabel: row ? `${row.year}/${String(row.month).padStart(2, "0")}` : null,
        latestStatus: row?.status ?? null,
        latestEmployeeCount: row?.employee_count ?? null,
        latestNet: sections.payrollAmounts ? Number(row?.total_net ?? 0) : null,
      };
    }

    let activity: ManagementSnapshot["activity"] = [];
    if (sections.activity) {
      const { data, error } = await this.supabase
        .from("audit_logs")
        .select("id, action, entity_type, entity_id, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) {
        console.error("[management] activity failed:", JSON.stringify(error));
      } else {
        activity = (data ?? []).map((r) => ({
          id: r.id as string,
          action: r.action as string,
          entityType: r.entity_type as string,
          entityId: (r.entity_id as string | null) ?? null,
          createdAt: r.created_at as string,
        }));
      }
    }

    const riskInput = await this.loadRiskInputSnapshot(organizationId, sections, today, nowIso);
    const risks = evaluateRisks(riskInput);
    const attention = buildAttentionFromFindings(risks);

    return {
      asOfDate: today,
      risks,
      attention,
      projects,
      approvals,
      procurement,
      commercial,
      people,
      attendance,
      payroll,
      activity,
    };
  }

  /**
   * Bounded primary-department headcounts for people report (aggregate only).
   */
  async loadDepartmentDistribution(
    organizationId: string,
  ): Promise<Array<{ nameAr: string; nameEn: string; count: number }>> {
    const rows = await selectRows<{
      department_id: string;
      departments: { name_ar: string; name_en: string } | { name_ar: string; name_en: string }[] | null;
    }>("report.deptDist", () =>
      this.supabase
        .from("employee_departments")
        .select("department_id, departments(name_ar, name_en)")
        .eq("organization_id", organizationId)
        .eq("is_primary", true)
        .limit(500),
    );

    const map = new Map<string, { nameAr: string; nameEn: string; count: number }>();
    for (const row of rows) {
      const dep = Array.isArray(row.departments) ? row.departments[0] : row.departments;
      const key = row.department_id;
      const nameAr = dep?.name_ar ?? "غير مصنّف";
      const nameEn = dep?.name_en ?? "Unassigned";
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { nameAr, nameEn, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  }
}
