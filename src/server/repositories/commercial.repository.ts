import { todayInRiyadh } from "@/lib/time/riyadh";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ListParams = {
  organizationId: string;
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: string;
  search?: string;
  supplierId?: string;
};

function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export class CommercialRepository {
  constructor(private supabase: SupabaseClient) {}

  async listPurchaseRequests(params: ListParams & { priority?: string }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("purchase_requests")
      .select(
        "id, pr_number, status, priority, estimated_cost, currency, required_date, project_id, requested_by, created_at, projects(project_code, name_ar, name_en)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("created_at", { ascending: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);

    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.priority) q = q.eq("priority", params.priority);
    if (params.search) q = q.ilike("pr_number", `%${params.search}%`);

    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getPurchaseRequest(id: string) {
    const { data, error } = await this.supabase
      .from("purchase_requests")
      .select("*, projects(id, project_code, name_ar, name_en), purchase_request_items(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listRfqs(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("rfqs")
      .select(
        "id, rfq_number, title, status, response_due_date, issue_date, project_id, projects(project_code, name_ar, name_en)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("created_at", { ascending: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);

    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.search) q = q.or(`rfq_number.ilike.%${params.search}%,title.ilike.%${params.search}%`);

    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getRfq(id: string) {
    const { data, error } = await this.supabase
      .from("rfqs")
      .select(
        "*, projects(id, project_code, name_ar, name_en), rfq_items(*), rfq_suppliers(*, suppliers(id, supplier_code, legal_name, trade_name)), purchase_requests(pr_number)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listPurchaseOrders(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("purchase_orders")
      .select(
        "id, po_number, status, total, currency, required_delivery_date, project_id, supplier_id, suppliers(supplier_code, legal_name), projects(project_code, name_ar, name_en)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("created_at", { ascending: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);

    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.supplierId) q = q.eq("supplier_id", params.supplierId);
    if (params.search) q = q.ilike("po_number", `%${params.search}%`);

    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getPurchaseOrder(id: string) {
    const { data, error } = await this.supabase
      .from("purchase_orders")
      .select(
        "*, suppliers(id, supplier_code, legal_name, trade_name, email, phone), projects(id, project_code, name_ar, name_en), purchase_order_items(*)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listSupplierInvoices(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("supplier_invoices")
      .select(
        "id, invoice_number, status, total, currency, due_date, project_id, supplier_id, suppliers(supplier_code, legal_name), projects(project_code, name_ar, name_en)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("due_date", { ascending: true, nullsFirst: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);

    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.supplierId) q = q.eq("supplier_id", params.supplierId);
    if (params.search) q = q.ilike("invoice_number", `%${params.search}%`);

    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getSupplierInvoice(id: string) {
    const { data, error } = await this.supabase
      .from("supplier_invoices")
      .select(
        "*, suppliers(id, supplier_code, legal_name), projects(id, project_code, name_ar, name_en), purchase_orders(po_number), supplier_payments(*), supplier_invoice_items(*)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listSuppliers(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("suppliers")
      .select("id, supplier_code, legal_name, trade_name, status, city, category_id, payment_terms_days", {
        count: "exact",
      })
      .eq("organization_id", params.organizationId)
      .neq("status", "archived")
      .order("legal_name");
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);

    if (params.search) {
      q = q.or(
        `legal_name.ilike.%${params.search}%,supplier_code.ilike.%${params.search}%,trade_name.ilike.%${params.search}%`,
      );
    }
    if (params.status) q = q.eq("status", params.status);

    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getSupplier(id: string) {
    const { data, error } = await this.supabase
      .from("suppliers")
      .select("*, supplier_contacts(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listProjectContracts(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("project_contracts")
      .select(
        "id, contract_number, client_name, contract_value, currency, status, project_id, projects(project_code, name_ar, name_en)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("created_at", { ascending: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);
    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.search) q = q.or(`contract_number.ilike.%${params.search}%,client_name.ilike.%${params.search}%`);
    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getProjectContract(id: string) {
    const { data, error } = await this.supabase
      .from("project_contracts")
      .select("*, projects(id, project_code, name_ar, name_en)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getProjectContractByProject(projectId: string) {
    const { data, error } = await this.supabase
      .from("project_contracts")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listContractMilestones(contractId: string) {
    const { data, error } = await this.supabase
      .from("contract_milestones")
      .select("*")
      .eq("contract_id", contractId)
      .order("milestone_number");
    if (error) throw error;
    return data ?? [];
  }

  async listClientValuations(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("client_valuations")
      .select(
        "id, valuation_number, status, total_claim, certified_amount, project_id, projects(project_code, name_ar, name_en), project_contracts(contract_number, client_name)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("created_at", { ascending: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);
    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.search) q = q.ilike("valuation_number", `%${params.search}%`);
    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getClientValuation(id: string) {
    const { data, error } = await this.supabase
      .from("client_valuations")
      .select(
        "*, projects(id, project_code, name_ar, name_en), project_contracts(id, contract_number, client_name, retention_percent), contract_milestones(id, name, milestone_number)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listClientInvoices(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("client_invoices")
      .select(
        "id, invoice_number, status, total, currency, due_date, project_id, projects(project_code, name_ar, name_en), project_contracts(client_name)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("due_date", { ascending: true, nullsFirst: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);
    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.search) q = q.ilike("invoice_number", `%${params.search}%`);
    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getClientInvoice(id: string) {
    const { data, error } = await this.supabase
      .from("client_invoices")
      .select(
        "*, projects(id, project_code, name_ar, name_en), project_contracts(contract_number, client_name), client_valuations(valuation_number, certified_amount), client_payments(*)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listVariations(params: ListParams) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    let q = this.supabase
      .from("variations")
      .select(
        "id, vo_number, status, requested_amount, submitted_amount, approved_amount, source, project_id, projects(project_code, name_ar, name_en)",
        { count: "exact" },
      )
      .eq("organization_id", params.organizationId)
      .order("created_at", { ascending: false });
    const { from, to } = pageRange(page, pageSize);
    q = q.range(from, to);
    if (params.projectId) q = q.eq("project_id", params.projectId);
    if (params.status) q = q.eq("status", params.status);
    if (params.search) q = q.ilike("vo_number", `%${params.search}%`);
    const { data, count } = await q;
    return { rows: data ?? [], total: count ?? 0, page, pageSize };
  }

  async getVariation(id: string) {
    const { data, error } = await this.supabase
      .from("variations")
      .select("*, projects(id, project_code, name_ar, name_en), project_contracts(contract_number, contract_value)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listReceivables(organizationId: string, filters?: { projectId?: string; status?: string }) {
    let q = this.supabase
      .from("client_invoices")
      .select(
        "id, invoice_number, status, total, currency, due_date, project_id, projects(project_code, name_ar, name_en), project_contracts(client_name), client_payments(amount)",
      )
      .eq("organization_id", organizationId)
      .in("status", ["issued", "partially_paid", "overdue"])
      .order("due_date", { ascending: true });
    if (filters?.projectId) q = q.eq("project_id", filters.projectId);
    if (filters?.status) q = q.eq("status", filters.status);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async getEntityDocuments(entityType: string, entityId: string) {
    const { data, error } = await this.supabase
      .from("entity_documents")
      .select(
        "id, role, created_at, documents(id, title, current_revision, document_versions(revision, file_name, mime_type, file_path))",
      )
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getProjectCashflowItems(projectId: string) {
    const { data, error } = await this.supabase
      .from("project_cashflow_items")
      .select("*")
      .eq("project_id", projectId)
      .order("period_date");
    if (error) throw error;
    return data ?? [];
  }

  async getAuditForEntity(entityType: string, entityId: string, limit = 20) {
    const { data, error } = await this.supabase
      .from("audit_logs")
      .select("id, action, created_at, actor_id, new_values")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async getApprovalForEntity(entityType: string, entityId: string) {
    const { data: req } = await this.supabase
      .from("approval_requests")
      .select("*, approval_steps(*, approval_actions(*))")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return req;
  }

  async procurementDashboardStats(organizationId: string) {
    const [prs, rfqs, pos, quotes, comparisons, invoices] = await Promise.all([
      this.supabase.from("purchase_requests").select("status").eq("organization_id", organizationId),
      this.supabase.from("rfqs").select("status, response_due_date").eq("organization_id", organizationId),
      this.supabase.from("purchase_orders").select("status, required_delivery_date").eq("organization_id", organizationId),
      this.supabase.from("supplier_quotations").select("status").eq("organization_id", organizationId),
      this.supabase.from("quotation_comparisons").select("status").eq("organization_id", organizationId),
      this.supabase.from("supplier_invoices").select("status, due_date, match_flags").eq("organization_id", organizationId),
    ]);

    const today = todayInRiyadh();
    const prRows = prs.data ?? [];
    const rfqRows = rfqs.data ?? [];
    const poRows = pos.data ?? [];

    return {
      prAwaitingReview: prRows.filter((r) => ["submitted", "under_review"].includes(r.status)).length,
      rfqAwaitingIssue: rfqRows.filter((r) => ["draft", "ready_to_issue"].includes(r.status)).length,
      rfqAwaitingResponse: rfqRows.filter((r) => r.status === "issued").length,
      quotationsReceived: (quotes.data ?? []).filter((q) => q.status === "submitted").length,
      comparisonsOpen: (comparisons.data ?? []).filter((c) => ["open", "recommended"].includes(c.status)).length,
      poPendingApproval: poRows.filter((p) => ["draft", "pending_approval"].includes(p.status)).length,
      poReadyToIssue: poRows.filter((p) => p.status === "approved").length,
      lateDeliveries: poRows.filter(
        (p) =>
          p.required_delivery_date &&
          p.required_delivery_date < today &&
          !["delivered", "closed", "cancelled"].includes(p.status),
      ).length,
      partialDeliveries: poRows.filter((p) => p.status === "partially_delivered").length,
      invoiceDiscrepancies: (invoices.data ?? []).filter((i) => i.status === "discrepancy").length,
      invoicesAwaitingReview: (invoices.data ?? []).filter((i) =>
        ["received", "under_review"].includes(i.status),
      ).length,
    };
  }

  async financeDashboardStats(organizationId: string) {
    const today = todayInRiyadh();
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    const in7Str = in7.toISOString().slice(0, 10);

    const [supplierInv, clientInv] = await Promise.all([
      this.supabase
        .from("supplier_invoices")
        .select("status, due_date, total")
        .eq("organization_id", organizationId),
      this.supabase
        .from("client_invoices")
        .select("status, due_date, total")
        .eq("organization_id", organizationId),
    ]);

    const ap = supplierInv.data ?? [];
    const ar = clientInv.data ?? [];
    const openAp = ap.filter((i) => !["paid", "cancelled", "rejected"].includes(i.status));

    return {
      dueIn7: openAp.filter((i) => i.due_date && i.due_date <= in7Str && i.due_date >= today).length,
      overdueAp: openAp.filter((i) => i.due_date && i.due_date < today).length,
      approvedForPayment: ap.filter((i) => i.status === "approved_for_payment").length,
      discrepancies: ap.filter((i) => i.status === "discrepancy").length,
      outstandingAr: ar.filter((i) => ["issued", "partially_paid", "overdue"].includes(i.status)).length,
      overdueAr: ar.filter((i) => i.status === "overdue" || (i.due_date && i.due_date < today)).length,
    };
  }
}
