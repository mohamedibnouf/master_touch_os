import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, StatCard, Textarea, TableScroll } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { recommendAwardAction } from "@/server/use-cases/procurement";
import { decideEntityApprovalAction } from "@/server/use-cases/entity-approvals";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const backLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";

export default async function ComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "quotation.read")) redirect("/procurement");

  const { id: rfqId } = await params;
  const supabase = await createServerSupabaseClient();

  const [rfqResult, quotesResult, usersResult] = await Promise.all([
    supabase
      .from("rfqs")
      .select("id, rfq_number, title, status, rfq_items(*)")
      .eq("id", rfqId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle(),
    supabase
      .from("supplier_quotations")
      .select("*, suppliers(id, supplier_code, legal_name), supplier_quotation_items(*)")
      .eq("rfq_id", rfqId)
      .neq("status", "superseded")
      .order("total", { ascending: true }),
    supabase
      .from("organization_members")
      .select("profile_id, profiles(full_name_ar, full_name_en)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .limit(200),
  ]);

  if (!rfqResult.data) notFound();
  const rfq = rfqResult.data;

  const { t, locale } = await getI18n();
  const tc = t.procurementSourcing.comparison;
  const common = t.procurementSourcing.common;

  const { data: comparison } = await supabase
    .from("quotation_comparisons")
    .select("id, status, approval_request_id, recommended_supplier_id, recommended_quotation_id, recommendation_reason, recommended_by, recommended_at")
    .eq("rfq_id", rfqId)
    .maybeSingle();

  const approval = comparison?.approval_request_id
    ? await supabase
        .from("approval_requests")
        .select("id, status, approval_steps(*)")
        .eq("id", comparison.approval_request_id)
        .maybeSingle()
    : { data: null };

  const rfqItems = (rfq.rfq_items as Array<Record<string, unknown>>) ?? [];
  const quotes = quotesResult.data ?? [];
  const pageTitle = format(tc.title, { number: rfq.rfq_number });
  const backLabel = format(common.backTo, { ref: rfq.rfq_number });

  if (quotes.length === 0) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader
          title={pageTitle}
          description={rfq.title}
          actions={
            <Link href={`/procurement/rfqs/${rfqId}`} className={backLinkClass}>
              {backLabel}
            </Link>
          }
        />
        <EmptyState title={tc.noQuotes} />
      </PageContainer>
    );
  }

  const canRecommend =
    hasPermission(ctx, "quotation.recommend") &&
    (!comparison || ["open", "recommended"].includes(comparison.status));
  const isAwarded = comparison?.status === "awarded";
  const pendingApprovalStep = approval.data?.approval_steps?.find(
    (step: Record<string, unknown>) =>
      ["pending", "in_progress"].includes(String(step.status)) && String(step.user_id ?? "") === ctx.userId,
  ) as Record<string, unknown> | undefined;
  const canDecideAward = comparison?.status === "pending_approval" && Boolean(pendingApprovalStep);

  const users = usersResult.data ?? [];
  const supplierName = (q: (typeof quotes)[number]) => {
    const s = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
    return (s as Record<string, string> | null)?.legal_name ?? null;
  };

  // Price highlights are only meaningful when every quotation is in the same currency.
  const singleCurrency = new Set(quotes.map((q) => q.currency)).size === 1;
  const lowestQuote = singleCurrency
    ? quotes.reduce((best, q) => (Number(q.total) < Number(best.total) ? q : best), quotes[0])
    : null;
  const highlightLowestTotal = Boolean(lowestQuote) && quotes.length > 1;
  const recommendedQuotationId = comparison?.recommended_quotation_id ?? null;
  const recommendedQuote = recommendedQuotationId ? quotes.find((q) => q.id === recommendedQuotationId) ?? null : null;

  const itemMatch = (q: (typeof quotes)[number], rfqItemId: unknown) => {
    const qItems = (q.supplier_quotation_items as Array<Record<string, unknown>>) ?? [];
    return qItems.find((qi) => String(qi.rfq_item_id) === String(rfqItemId));
  };
  const lowestUnitPriceByItem = new Map<string, number>();
  if (singleCurrency) {
    for (const rfqItem of rfqItems) {
      const prices = quotes
        .map((q) => itemMatch(q, rfqItem.id))
        .filter((m): m is Record<string, unknown> => Boolean(m) && m?.unit_price != null)
        .map((m) => Number(m.unit_price));
      if (prices.length > 1) lowestUnitPriceByItem.set(String(rfqItem.id), Math.min(...prices));
    }
  }

  return (
    <PageContainer data-testid="comparison-page" className="space-y-5">
      <PageHeader
        title={pageTitle}
        description={rfq.title}
        actions={
          <Link href={`/procurement/rfqs/${rfqId}`} className={backLinkClass}>
            {backLabel}
          </Link>
        }
      />

      {isAwarded ? (
        <div className="rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success">
          {tc.awardedBanner}
        </div>
      ) : null}

      {comparison && comparison.status === "pending_approval" ? (
        <div className="rounded-md border border-warning-border bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
          {tc.pendingApprovalBanner}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={tc.quotesCount} value={quotes.length} tone="info" />
        <StatCard
          label={tc.lowestTotal}
          value={
            lowestQuote ? (
              <span className="text-xl">
                <MoneyDisplay amount={lowestQuote.total} currency={lowestQuote.currency} locale={locale} />
              </span>
            ) : (
              common.none
            )
          }
          hint={lowestQuote ? supplierName(lowestQuote) ?? undefined : undefined}
          tone="success"
        />
        <StatCard
          label={tc.recommendedSupplier}
          value={<span className="text-xl">{recommendedQuote ? supplierName(recommendedQuote) ?? common.none : common.none}</span>}
          hint={recommendedQuote?.quotation_number}
        />
      </div>

      {canDecideAward && approval.data && pendingApprovalStep ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{tc.awardDecisionTitle}</h2>
          <div className="flex flex-wrap gap-3">
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval.data.id} />
              <input type="hidden" name="stepId" value={String(pendingApprovalStep.id)} />
              <input type="hidden" name="officialCode" value="A" />
              <Button type="submit">{common.approve}</Button>
            </ServerActionForm>
            <ServerActionForm action={decideEntityApprovalAction}>
              <input type="hidden" name="approvalRequestId" value={approval.data.id} />
              <input type="hidden" name="stepId" value={String(pendingApprovalStep.id)} />
              <input type="hidden" name="officialCode" value="D" />
              <Button type="submit" variant="danger">{common.reject}</Button>
            </ServerActionForm>
          </div>
        </Card>
      ) : null}

      {/* Matrix */}
      <Card className="p-0">
        <TableScroll>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-muted">
              <tr>
                <th className="sticky start-0 z-10 min-w-48 bg-surface-muted px-4 py-3 text-start font-medium">{tc.itemColumn}</th>
                {quotes.map((q) => {
                  const isRecommended = recommendedQuotationId === q.id;
                  const isLowest = highlightLowestTotal && lowestQuote?.id === q.id;
                  return (
                    <th
                      key={q.id}
                      className={cn(
                        "min-w-44 border-s border-line px-4 py-3 text-start align-top font-medium",
                        isRecommended && "bg-primary-soft",
                      )}
                    >
                      <Link href={`/procurement/quotations/${q.id}`} className="text-primary hover:underline">
                        {q.quotation_number}
                      </Link>
                      <span className="mt-0.5 block text-xs font-normal text-muted">{supplierName(q) ?? common.none}</span>
                      {isRecommended || isLowest ? (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {isRecommended ? <Badge tone="info">{tc.recommendedBadge}</Badge> : null}
                          {isLowest ? <Badge tone="success">{tc.lowestBadge}</Badge> : null}
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rfqItems.map((rfqItem) => {
                const lowestUnit = lowestUnitPriceByItem.get(String(rfqItem.id));
                return (
                  <tr key={String(rfqItem.id)} className="border-t border-line">
                    <td className="sticky start-0 z-10 bg-surface px-4 py-3 font-medium text-ink">
                      {String(rfqItem.line_no)}. {String(rfqItem.description)}
                      <span className="mt-0.5 block text-xs font-normal text-muted">
                        {format(tc.quantityLine, {
                          quantity: String(rfqItem.quantity),
                          unit: String(rfqItem.unit ?? ""),
                        })}
                      </span>
                    </td>
                    {quotes.map((q) => {
                      const match = itemMatch(q, rfqItem.id);
                      const isLowestCell =
                        match != null && lowestUnit != null && Number(match.unit_price) === lowestUnit;
                      return (
                        <td
                          key={q.id}
                          className={cn(
                            "border-s border-line px-4 py-3 align-top",
                            recommendedQuotationId === q.id && "bg-primary-soft/40",
                            isLowestCell && "bg-success-soft",
                          )}
                        >
                          {match ? (
                            <div className="space-y-1">
                              <div className="tabular-nums">
                                <MoneyDisplay amount={match.unit_price as number} currency={q.currency} locale={locale} />
                                <span className="text-muted"> {tc.perUnit}</span>
                              </div>
                              <div className={cn("font-semibold tabular-nums", isLowestCell ? "text-success" : "text-ink")}>
                                <MoneyDisplay amount={match.total_price as number} currency={q.currency} locale={locale} />
                              </div>
                              {isLowestCell ? <Badge tone="success">{tc.lowestBadge}</Badge> : null}
                              {match.offered_brand ? (
                                <div className="text-xs text-muted">{String(match.offered_brand)} {String(match.offered_model ?? "")}</div>
                              ) : null}
                              {match.lead_time_days != null ? (
                                <div className="text-xs text-muted">
                                  {format(common.days, { count: String(match.lead_time_days) })}
                                </div>
                              ) : null}
                              <CommercialStatusBadge status={String(match.compliance_status ?? "not_assessed")} locale={locale} />
                              {match.deviation_note ? (
                                <div className="text-xs text-warning">{String(match.deviation_note)}</div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted">{common.none}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Summary row */}
              <tr className="border-t-2 border-primary/20 bg-surface-muted">
                <td className="sticky start-0 z-10 bg-surface-muted px-4 py-3 font-semibold text-ink">{tc.grandTotal}</td>
                {quotes.map((q) => {
                  const isRecommended = recommendedQuotationId === q.id;
                  const isLowest = highlightLowestTotal && lowestQuote?.id === q.id;
                  return (
                    <td
                      key={q.id}
                      className={cn(
                        "border-s border-line px-4 py-3 align-top",
                        isRecommended && "bg-primary-soft",
                        isLowest && !isRecommended && "bg-success-soft",
                      )}
                    >
                      <div className="space-y-1 text-sm">
                        <div className="tabular-nums">
                          <MoneyDisplay amount={q.subtotal} currency={q.currency} locale={locale} />
                          <span className="text-xs text-muted"> {tc.subtotal}</span>
                        </div>
                        {Number(q.discount) > 0 ? (
                          <div className="text-xs text-muted">
                            {tc.discount} <MoneyDisplay amount={q.discount} currency={q.currency} locale={locale} />
                          </div>
                        ) : null}
                        <div className="text-xs text-muted">
                          {format(tc.vat, { rate: String(q.vat_rate_percent) })}{" "}
                          <MoneyDisplay amount={q.vat_amount} currency={q.currency} locale={locale} />
                        </div>
                        <div className={cn("text-base font-bold tabular-nums", isLowest ? "text-success" : "text-ink")}>
                          <MoneyDisplay amount={q.total} currency={q.currency} locale={locale} />
                        </div>
                        {q.delivery_lead_time_days != null ? (
                          <div className="text-xs text-muted">
                            {format(tc.delivery, { count: String(q.delivery_lead_time_days) })}
                          </div>
                        ) : null}
                        {q.payment_terms ? (
                          <div className="text-xs text-muted">{format(tc.payment, { terms: String(q.payment_terms) })}</div>
                        ) : null}
                        {q.validity_date ? (
                          <div className="text-xs text-muted">{format(tc.validUntil, { date: String(q.validity_date) })}</div>
                        ) : null}
                        {isRecommended ? (
                          <div className="mt-1">
                            <Badge tone="info">{tc.recommendedBadge}</Badge>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </TableScroll>
      </Card>

      {/* Recommendation form */}
      {canRecommend && !isAwarded ? (
        <Card data-testid="award-recommend-card">
          <h2 className="mb-4 text-sm font-semibold text-ink">{tc.recommendTitle}</h2>
          <p className="mb-4 rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-sm text-warning">
            {tc.noAutoAward}
          </p>
          <ServerActionForm action={recommendAwardAction} className="grid gap-4 md:grid-cols-2" data-testid="award-recommend-form">
            <input type="hidden" name="rfqId" value={rfqId} />
            <Field label={tc.quotation} required>
              <Select name="quotationId" required defaultValue="" data-testid="award-quotation">
                <option value="" disabled>{tc.selectQuotation}</option>
                {quotes.map((q) => (
                  <option key={q.id} value={q.id} data-supplier={q.supplier_id}>
                    {q.quotation_number} — {supplierName(q) ?? common.none} —{" "}
                    {Number(q.total).toLocaleString(intlLocale(locale), { minimumFractionDigits: 2 })} {q.currency}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tc.supplier} required>
              <Select name="supplierId" required defaultValue="" data-testid="award-supplier">
                <option value="" disabled>{common.selectSupplier}</option>
                {quotes.map((q) => (
                  <option key={q.supplier_id} value={q.supplier_id}>
                    {supplierName(q) ?? q.supplier_id}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label={tc.reason} required>
                <Textarea
                  name="reason"
                  required
                  minLength={8}
                  placeholder={tc.reasonPlaceholder}
                  data-testid="award-reason"
                />
              </Field>
            </div>
            <Field label={tc.approver} required>
              <Select name="approverProfileId" required defaultValue="" data-testid="award-approver">
                <option value="" disabled>{common.selectApprover}</option>
                {users.map((u) => {
                  const p = (Array.isArray(u.profiles) ? u.profiles[0] : u.profiles) as
                    | { full_name_ar: string | null; full_name_en: string | null }
                    | null;
                  return (
                    <option key={u.profile_id} value={u.profile_id}>
                      {pickLocalized(locale, p?.full_name_ar, p?.full_name_en) || u.profile_id}
                    </option>
                  );
                })}
              </Select>
            </Field>
            <div className="flex items-end justify-end">
              <Button type="submit" data-testid="award-submit">{tc.submit}</Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Show existing recommendation if not editable */}
      {comparison && !canRecommend && comparison.recommendation_reason ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{tc.submittedTitle}</h2>
          <p className="text-sm text-ink">{comparison.recommendation_reason}</p>
          <p className="mt-2 text-xs tabular-nums text-muted">
            {comparison.recommended_at ? new Date(comparison.recommended_at).toLocaleString(intlLocale(locale)) : ""}
          </p>
        </Card>
      ) : null}

      {/* Award approval action — if awarded, show PO creation link */}
      {isAwarded && comparison?.recommended_quotation_id ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{tc.nextStepTitle}</h2>
          <Link
            href={`/procurement/purchase-orders/new?quotationId=${comparison.recommended_quotation_id}`}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            {tc.createPo}
          </Link>
        </Card>
      ) : null}
    </PageContainer>
  );
}
