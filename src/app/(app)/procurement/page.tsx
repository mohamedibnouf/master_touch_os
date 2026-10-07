import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { parseScopedProjectId } from "@/modules/procurement/stage05-readiness";

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (
    !hasPermission(ctx, "purchase_request.read") &&
    !hasPermission(ctx, "rfq.read") &&
    !hasPermission(ctx, "purchase_order.read") &&
    !hasPermission(ctx, "supplier.read")
  ) {
    redirect("/");
  }

  const params = await searchParams;
  const scopedProjectId = parseScopedProjectId(params.project);
  const supabase = await createServerSupabaseClient();
  let projectFilter: string | null = null;
  if (scopedProjectId) {
    const { data: visible } = await supabase
      .from("projects")
      .select("id")
      .eq("id", scopedProjectId)
      .maybeSingle<{ id: string }>();
    projectFilter = visible?.id ?? null;
  }
  let scopedProjectLabel: string | null = null;
  if (projectFilter) {
    const { data: projectRow } = await supabase
      .from("projects")
      .select("project_code, name_ar")
      .eq("id", projectFilter)
      .maybeSingle<{ project_code: string; name_ar: string }>();
    if (projectRow) {
      scopedProjectLabel = `${projectRow.project_code} — ${projectRow.name_ar}`;
    }
  }
  const repo = new CommercialRepository(supabase);
  const stats = await repo.procurementDashboardStats(ctx.organization.id);

  // Recent PRs needing action
  let pendingPrQuery = supabase
    .from("purchase_requests")
    .select("id, pr_number, status, priority, estimated_cost, currency")
    .eq("organization_id", ctx.organization.id)
    .in("status", ["submitted", "under_review"])
    .order("created_at", { ascending: true })
    .limit(10);
  if (projectFilter) pendingPrQuery = pendingPrQuery.eq("project_id", projectFilter);
  const { data: pendingPrs } = await pendingPrQuery;

  // RFQs with deadlines
  const today = new Date().toISOString().slice(0, 10);
  let rfqQuery = supabase
    .from("rfqs")
    .select("id, rfq_number, title, status, response_due_date")
    .eq("organization_id", ctx.organization.id)
    .eq("status", "issued")
    .order("response_due_date", { ascending: true })
    .limit(5);
  if (projectFilter) rfqQuery = rfqQuery.eq("project_id", projectFilter);
  const { data: rfqsDue } = await rfqQuery;

  // POs awaiting action
  let poQuery = supabase
    .from("purchase_orders")
    .select("id, po_number, status, total, currency, required_delivery_date, suppliers(legal_name)")
    .eq("organization_id", ctx.organization.id)
    .in("status", ["draft", "pending_approval", "approved"])
    .order("created_at", { ascending: true })
    .limit(10);
  if (projectFilter) poQuery = poQuery.eq("project_id", projectFilter);
  const { data: actionPOs } = await poQuery;

  const kpiCards = [
    {
      label: "طلبات شراء بانتظار مراجعة",
      value: stats.prAwaitingReview,
      href: "/procurement/purchase-requests?status=under_review",
      warn: stats.prAwaitingReview > 0,
    },
    {
      label: "RFQ بانتظار الإصدار",
      value: stats.rfqAwaitingIssue,
      href: "/procurement/rfqs?status=draft",
      warn: false,
    },
    {
      label: "RFQ بانتظار الردود",
      value: stats.rfqAwaitingResponse,
      href: "/procurement/rfqs?status=issued",
      warn: false,
    },
    {
      label: "أوامر شراء بانتظار اعتماد",
      value: stats.poPendingApproval,
      href: "/procurement/purchase-orders?status=pending_approval",
      warn: stats.poPendingApproval > 0,
    },
    {
      label: "أوامر شراء جاهزة للإصدار",
      value: stats.poReadyToIssue,
      href: "/procurement/purchase-orders?status=approved",
      warn: false,
    },
    {
      label: "تسليم متأخر",
      value: stats.lateDeliveries,
      href: "/procurement/purchase-orders?status=issued",
      warn: stats.lateDeliveries > 0,
    },
    {
      label: "تسليم جزئي",
      value: stats.partialDeliveries,
      href: "/procurement/purchase-orders?status=partially_delivered",
      warn: false,
    },
    {
      label: "فواتير باختلاف",
      value: stats.invoiceDiscrepancies,
      href: "/finance/supplier-invoices?status=discrepancy",
      warn: stats.invoiceDiscrepancies > 0,
    },
    {
      label: "فواتير بانتظار المراجعة",
      value: stats.invoicesAwaitingReview,
      href: "/finance/supplier-invoices?status=received",
      warn: false,
    },
    {
      label: "مقارنات مفتوحة",
      value: stats.comparisonsOpen,
      href: "/procurement/rfqs?status=responses_received",
      warn: false,
    },
  ];

  return (
    <PageContainer className="space-y-5">
      {scopedProjectLabel ? (
        <p className="text-sm text-navy" data-testid="procurement-project-scope">
          نطاق المشروع: {scopedProjectLabel}
        </p>
      ) : null}
      <PageHeader
        title="المشتريات"
        description={
          scopedProjectLabel
            ? `لوحة المتابعة التشغيلية للمشتريات — ${scopedProjectLabel}`
            : scopedProjectId && !projectFilter
              ? "لوحة المتابعة التشغيلية للمشتريات — لا يمكن عرض المشروع المطلوب"
              : "لوحة المتابعة التشغيلية للمشتريات"
        }
        actions={
          <div className="flex gap-3">
            <Link href="/procurement/suppliers" className="text-sm text-navy underline">الموردون</Link>
            <Link href="/finance" className="text-sm text-navy underline">المالية</Link>
          </div>
        }
      />

      {/* Quick Nav */}
      <div className="mb-6 flex flex-wrap gap-2">
        {hasPermission(ctx, "purchase_request.create") ? (
          <Link href={projectFilter ? `/procurement/purchase-requests/new?project=${projectFilter}` : "/procurement/purchase-requests/new"} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
            + طلب شراء
          </Link>
        ) : null}
        {hasPermission(ctx, "rfq.create") ? (
          <Link href="/procurement/rfqs/new" className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-navy hover:bg-primary/5">
            + RFQ
          </Link>
        ) : null}
        {hasPermission(ctx, "supplier.manage") ? (
          <Link href="/procurement/suppliers/new" className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-paper">
            + مورد
          </Link>
        ) : null}
        {hasPermission(ctx, "goods_receipt.create") ? (
          <Link href="/procurement/goods-receipts/new" className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-paper">
            + استلام بضاعة
          </Link>
        ) : null}
      </div>

      {/* KPI Grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpiCards.map((card) => (
          <Link key={card.label} href={card.href}>
            <Card className="transition hover:border-primary/30">
              <p className="text-xs text-muted">{card.label}</p>
              <p className={`mt-2 text-3xl font-semibold ${card.warn && card.value > 0 ? "text-danger" : "text-navy"}`}>
                {card.value}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* PRs awaiting */}
        {hasPermission(ctx, "purchase_request.read") ? (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-navy">طلبات شراء بانتظار إجراء</h2>
              <Link href="/procurement/purchase-requests" className="text-xs text-navy underline">كل الطلبات</Link>
            </div>
            {(pendingPrs ?? []).length === 0 ? (
              <EmptyState title="لا توجد طلبات بانتظار إجراء." />
            ) : (
              <ul className="space-y-2 text-sm">
                {(pendingPrs ?? []).map((pr) => (
                  <li key={pr.id} className="flex items-center justify-between border-b border-line pb-2">
                    <Link href={`/procurement/purchase-requests/${pr.id}`} className="font-medium text-navy underline">
                      {pr.pr_number}
                    </Link>
                    <div className="flex items-center gap-2">
                      <CommercialStatusBadge status={pr.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {/* RFQs with deadlines */}
        {hasPermission(ctx, "rfq.read") ? (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-navy">RFQ مواعيد الرد</h2>
              <Link href="/procurement/rfqs?status=issued" className="text-xs text-navy underline">كل RFQ</Link>
            </div>
            {(rfqsDue ?? []).length === 0 ? (
              <EmptyState title="لا توجد RFQ بانتظار ردود." />
            ) : (
              <ul className="space-y-2 text-sm">
                {(rfqsDue ?? []).map((rfq) => {
                  const isLate = rfq.response_due_date != null && rfq.response_due_date < today;
                  return (
                    <li key={rfq.id} className="flex items-center justify-between border-b border-line pb-2">
                      <Link href={`/procurement/rfqs/${rfq.id}`} className="font-medium text-navy underline">
                        {rfq.rfq_number}
                      </Link>
                      <span className={`text-xs ${isLate ? "text-danger font-medium" : "text-muted"}`}>
                        {isLate ? "⚠️ متأخر — " : ""}{rfq.response_due_date ?? "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ) : null}

        {/* POs awaiting action */}
        {hasPermission(ctx, "purchase_order.read") ? (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-navy">أوامر شراء بانتظار إجراء</h2>
              <Link href="/procurement/purchase-orders" className="text-xs text-navy underline">كل PO</Link>
            </div>
            {(actionPOs ?? []).length === 0 ? (
              <EmptyState title="لا توجد أوامر شراء بانتظار إجراء." />
            ) : (
              <ul className="space-y-2 text-sm">
                {(actionPOs ?? []).map((po) => {
                  const sup = Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers;
                  const isLateDelivery = po.required_delivery_date != null && po.required_delivery_date < today && po.status !== "delivered";
                  return (
                    <li key={po.id} className="flex items-center justify-between border-b border-line pb-2">
                      <Link href={`/procurement/purchase-orders/${po.id}`} className="font-medium text-navy underline">
                        {po.po_number}
                        {sup ? <span className="ml-1 text-xs text-muted font-normal">— {(sup as Record<string, string>).legal_name}</span> : null}
                      </Link>
                      <div className="flex items-center gap-2">
                        <CommercialStatusBadge status={po.status} />
                        {isLateDelivery ? <span className="text-xs text-danger">متأخر</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </PageContainer>
  );
}
