import { todayInRiyadh } from "@/lib/time/riyadh";
import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { parseScopedProjectId } from "@/modules/procurement/stage05-readiness";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const navLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";
const primaryLinkClass =
  "inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover";
const outlineLinkClass =
  "inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted";
const listLinkClass = "font-medium text-primary hover:underline";

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

  const { t, locale } = await getI18n();
  const td = t.procurementSourcing.dashboard;
  const common = t.procurementSourcing.common;

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
      .select("project_code, name_ar, name_en")
      .eq("id", projectFilter)
      .maybeSingle<{ project_code: string; name_ar: string; name_en: string | null }>();
    if (projectRow) {
      scopedProjectLabel = format(common.codeName, {
        code: projectRow.project_code,
        name: pickLocalized(locale, projectRow.name_ar, projectRow.name_en),
      });
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
  const today = todayInRiyadh();
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
      key: "prAwaitingReview",
      label: td.kpi.prAwaitingReview,
      value: stats.prAwaitingReview,
      href: "/procurement/purchase-requests?status=under_review",
      warn: stats.prAwaitingReview > 0,
    },
    {
      key: "rfqAwaitingIssue",
      label: td.kpi.rfqAwaitingIssue,
      value: stats.rfqAwaitingIssue,
      href: "/procurement/rfqs?status=draft",
      warn: false,
    },
    {
      key: "rfqAwaitingResponse",
      label: td.kpi.rfqAwaitingResponse,
      value: stats.rfqAwaitingResponse,
      href: "/procurement/rfqs?status=issued",
      warn: false,
    },
    {
      key: "poPendingApproval",
      label: td.kpi.poPendingApproval,
      value: stats.poPendingApproval,
      href: "/procurement/purchase-orders?status=pending_approval",
      warn: stats.poPendingApproval > 0,
    },
    {
      key: "poReadyToIssue",
      label: td.kpi.poReadyToIssue,
      value: stats.poReadyToIssue,
      href: "/procurement/purchase-orders?status=approved",
      warn: false,
    },
    {
      key: "lateDeliveries",
      label: td.kpi.lateDeliveries,
      value: stats.lateDeliveries,
      href: "/procurement/purchase-orders?status=issued",
      warn: stats.lateDeliveries > 0,
    },
    {
      key: "partialDeliveries",
      label: td.kpi.partialDeliveries,
      value: stats.partialDeliveries,
      href: "/procurement/purchase-orders?status=partially_delivered",
      warn: false,
    },
    {
      key: "invoiceDiscrepancies",
      label: td.kpi.invoiceDiscrepancies,
      value: stats.invoiceDiscrepancies,
      href: "/finance/supplier-invoices?status=discrepancy",
      warn: stats.invoiceDiscrepancies > 0,
    },
    {
      key: "invoicesAwaitingReview",
      label: td.kpi.invoicesAwaitingReview,
      value: stats.invoicesAwaitingReview,
      href: "/finance/supplier-invoices?status=received",
      warn: false,
    },
    {
      key: "comparisonsOpen",
      label: td.kpi.comparisonsOpen,
      value: stats.comparisonsOpen,
      href: "/procurement/rfqs?status=responses_received",
      warn: false,
    },
  ];

  return (
    <PageContainer className="space-y-5">
      {scopedProjectLabel ? (
        <p
          className="inline-flex rounded-md bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary"
          data-testid="procurement-project-scope"
        >
          {format(td.projectScope, { project: scopedProjectLabel })}
        </p>
      ) : null}
      <PageHeader
        title={td.title}
        description={
          scopedProjectLabel
            ? format(td.descriptionScoped, { project: scopedProjectLabel })
            : scopedProjectId && !projectFilter
              ? td.descriptionUnavailable
              : td.description
        }
        actions={
          <nav className="flex flex-wrap gap-2">
            <Link href="/procurement/suppliers" className={navLinkClass}>
              {td.suppliersLink}
            </Link>
            <Link href="/finance" className={navLinkClass}>
              {td.financeLink}
            </Link>
          </nav>
        }
      />

      {/* Quick Nav */}
      <div className="flex flex-wrap gap-2">
        {hasPermission(ctx, "purchase_request.create") ? (
          <Link
            href={projectFilter ? `/procurement/purchase-requests/new?project=${projectFilter}` : "/procurement/purchase-requests/new"}
            className={primaryLinkClass}
          >
            {td.newPr}
          </Link>
        ) : null}
        {hasPermission(ctx, "rfq.create") ? (
          <Link href="/procurement/rfqs/new" className={outlineLinkClass}>
            {td.newRfq}
          </Link>
        ) : null}
        {hasPermission(ctx, "supplier.manage") ? (
          <Link href="/procurement/suppliers/new" className={outlineLinkClass}>
            {td.newSupplier}
          </Link>
        ) : null}
        {hasPermission(ctx, "goods_receipt.create") ? (
          <Link href="/procurement/goods-receipts/new" className={outlineLinkClass}>
            {td.newGoodsReceipt}
          </Link>
        ) : null}
      </div>

      {/* KPI Grid */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpiCards.map((card) => (
          <Link key={card.key} href={card.href} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/30">
              <p className="text-xs font-medium text-muted">{card.label}</p>
              <p
                className={cn(
                  "mt-2 text-[1.75rem] font-semibold leading-none tabular-nums tracking-tight",
                  card.warn && card.value > 0 ? "text-danger" : "text-ink",
                )}
              >
                {card.value}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* PRs awaiting */}
        {hasPermission(ctx, "purchase_request.read") ? (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{td.pendingPrsTitle}</h2>
              <Link href="/procurement/purchase-requests" className="text-xs font-medium text-primary hover:underline">
                {td.allRequests}
              </Link>
            </div>
            {(pendingPrs ?? []).length === 0 ? (
              <EmptyState title={td.noPendingPrs} />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {(pendingPrs ?? []).map((pr) => (
                  <li key={pr.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/procurement/purchase-requests/${pr.id}`} className={listLinkClass}>
                      {pr.pr_number}
                    </Link>
                    <CommercialStatusBadge status={pr.status} locale={locale} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        {/* RFQs with deadlines */}
        {hasPermission(ctx, "rfq.read") ? (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{td.rfqDeadlinesTitle}</h2>
              <Link href="/procurement/rfqs?status=issued" className="text-xs font-medium text-primary hover:underline">
                {td.allRfqs}
              </Link>
            </div>
            {(rfqsDue ?? []).length === 0 ? (
              <EmptyState title={td.noRfqsDue} />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {(rfqsDue ?? []).map((rfq) => {
                  const isLate = rfq.response_due_date != null && rfq.response_due_date < today;
                  return (
                    <li key={rfq.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/procurement/rfqs/${rfq.id}`} className={listLinkClass}>
                        {rfq.rfq_number}
                      </Link>
                      <span className="flex items-center gap-2">
                        {isLate ? <Badge tone="danger">{common.late}</Badge> : null}
                        <span className={cn("text-xs tabular-nums", isLate ? "font-medium text-danger" : "text-muted")}>
                          {rfq.response_due_date ?? common.none}
                        </span>
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{td.pendingPosTitle}</h2>
              <Link href="/procurement/purchase-orders" className="text-xs font-medium text-primary hover:underline">
                {td.allPos}
              </Link>
            </div>
            {(actionPOs ?? []).length === 0 ? (
              <EmptyState title={td.noPendingPos} />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {(actionPOs ?? []).map((po) => {
                  const sup = Array.isArray(po.suppliers) ? po.suppliers[0] : po.suppliers;
                  const isLateDelivery = po.required_delivery_date != null && po.required_delivery_date < today && po.status !== "delivered";
                  return (
                    <li key={po.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/procurement/purchase-orders/${po.id}`} className={listLinkClass}>
                        {po.po_number}
                        {sup ? (
                          <span className="ms-1 text-xs font-normal text-muted">
                            — {(sup as Record<string, string>).legal_name}
                          </span>
                        ) : null}
                      </Link>
                      <div className="flex items-center gap-2">
                        <CommercialStatusBadge status={po.status} locale={locale} />
                        {isLateDelivery ? <Badge tone="danger">{common.late}</Badge> : null}
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
