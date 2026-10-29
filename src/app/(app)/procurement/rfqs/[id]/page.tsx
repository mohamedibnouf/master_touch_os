import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, PageHeader, TableScroll } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { issueRfqAction, updateRfqSupplierResponseAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { RfqSupplierInvitePanel, RfqSupplierRemoveButton } from "@/components/procurement/rfq-supplier-invite-panel";
import { isRfqInvitationEditable } from "@/modules/procurement/rfq-invitation";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const backLinkClass =
  "rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink";
const thClass = "px-3 py-2 text-start font-medium";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "rfq.read")) redirect("/procurement");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const rfq = await repo.getRfq(id);
  if (!rfq) notFound();

  const { t, locale } = await getI18n();
  const td = t.procurementSourcing.rfqs.detail;
  const common = t.procurementSourcing.common;

  const audit = await repo.getAuditForEntity("rfq", id);
  const project = (Array.isArray(rfq.projects) ? rfq.projects[0] : rfq.projects) as
    | { project_code: string; name_ar: string | null; name_en?: string | null }
    | null
    | undefined;
  const items = (rfq.rfq_items as Array<Record<string, unknown>>) ?? [];
  const invitations = (rfq.rfq_suppliers as Array<Record<string, unknown>>) ?? [];

  const canIssue =
    isRfqInvitationEditable(rfq.status) &&
    hasPermission(ctx, "rfq.issue") &&
    invitations.length > 0;

  const isIssued = ["issued", "responses_received", "under_comparison", "awarded"].includes(rfq.status);
  const canManageResponse = hasPermission(ctx, "rfq.manage");
  const canManageInvites =
    isRfqInvitationEditable(rfq.status) &&
    (hasPermission(ctx, "rfq.issue") || hasPermission(ctx, "rfq.manage"));
  const canListSuppliers = hasPermission(ctx, "supplier.read");

  const invitedIds = new Set(invitations.map((inv) => String(inv.supplier_id)));
  let inviteCandidates: Array<{ id: string; supplier_code: string; legal_name: string }> = [];
  if (canManageInvites && canListSuppliers) {
    const { data: supplierRows } = await supabase
      .from("suppliers")
      .select("id, supplier_code, legal_name")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("legal_name");
    inviteCandidates = (supplierRows ?? []).filter((row) => !invitedIds.has(row.id));
  }

  // Quotations for this RFQ
  const { data: quotations } = await supabase
    .from("supplier_quotations")
    .select("id, quotation_number, status, total, currency, quotation_date, suppliers(legal_name)")
    .eq("rfq_id", id)
    .order("created_at", { ascending: false });

  const pr = Array.isArray(rfq.purchase_requests) ? rfq.purchase_requests[0] : rfq.purchase_requests;

  // Comparison
  const { data: comparison } = await supabase
    .from("quotation_comparisons")
    .select("id, status, recommended_supplier_id")
    .eq("rfq_id", id)
    .maybeSingle();

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={rfq.rfq_number}
        description={rfq.title}
        actions={
          <Link href="/procurement/rfqs" className={backLinkClass}>
            {common.backToRegister}
          </Link>
        }
      />

      {/* Status row */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <p className="text-xs font-medium text-muted">{td.status}</p>
          <div className="mt-2"><CommercialStatusBadge status={rfq.status} locale={locale} /></div>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.project}</p>
          <p className="mt-2 text-sm font-medium text-ink">
            {project
              ? format(common.codeName, {
                  code: project.project_code,
                  name: pickLocalized(locale, project.name_ar, project.name_en),
                })
              : common.none}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.responseDueDate}</p>
          <p className="mt-2 font-semibold tabular-nums text-ink">{rfq.response_due_date ?? common.none}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.sourcePr}</p>
          {pr ? (
            <p className="mt-2 text-sm font-medium text-primary">{(pr as Record<string, string>).pr_number}</p>
          ) : (
            <p className="mt-2 text-sm text-muted">{common.none}</p>
          )}
        </Card>
      </div>

      {/* Issue action */}
      {canIssue ? (
        <Card className="border-primary/30 bg-primary-soft/40">
          <h2 className="mb-1 text-sm font-semibold text-ink">{td.issueTitle}</h2>
          <p className="mb-3 text-sm text-muted">{td.issueHint}</p>
          <ServerActionForm action={issueRfqAction}>
            <input type="hidden" name="rfqId" value={rfq.id} />
            <Button type="submit">{td.issueSubmit}</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Actions after issue */}
      {isIssued ? (
        <div className="flex flex-wrap gap-3">
          {hasPermission(ctx, "quotation.create") ? (
            <Link
              href={`/procurement/rfqs/${id}/quotations/new`}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              {td.recordQuotation}
            </Link>
          ) : null}
          {(quotations ?? []).length >= 1 && hasPermission(ctx, "quotation.compare") ? (
            <Link
              href={`/procurement/rfqs/${id}/comparison`}
              className="inline-flex items-center rounded-md border border-primary/40 bg-surface px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-soft"
            >
              {td.compareQuotations}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Items */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{td.itemsTitle}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{common.noItems}</p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className={thClass}>{td.itemColumns.line}</th>
                  <th className={thClass}>{td.itemColumns.description}</th>
                  <th className={thClass}>{td.itemColumns.quantity}</th>
                  <th className={thClass}>{td.itemColumns.unit}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={String(item.id)} className="border-t border-line">
                    <td className="px-3 py-2 tabular-nums text-muted">{String(item.line_no)}</td>
                    <td className="px-3 py-2 text-ink">{String(item.description)}</td>
                    <td className="px-3 py-2 tabular-nums">{String(item.quantity)}</td>
                    <td className="px-3 py-2">{String(item.unit ?? common.none)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {/* Invitations */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{td.invitedTitle}</h2>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted">{td.noInvited}</p>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className={thClass}>{td.invitationColumns.supplier}</th>
                  <th className={thClass}>{td.invitationColumns.response}</th>
                  {canManageResponse ? <th className={thClass}>{td.invitationColumns.update}</th> : null}
                  {canManageInvites ? <th className={thClass}>{td.invitationColumns.remove}</th> : null}
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const supplier = Array.isArray(inv.suppliers) ? inv.suppliers[0] : inv.suppliers;
                  return (
                    <tr key={String(inv.id)} className="border-t border-line">
                      <td className="px-3 py-2 text-ink">
                        {supplier
                          ? format(common.codeName, {
                              code: (supplier as Record<string, string>).supplier_code,
                              name: (supplier as Record<string, string>).legal_name,
                            })
                          : String(inv.supplier_id)}
                      </td>
                      <td className="px-3 py-2">
                        <CommercialStatusBadge status={String(inv.response_status)} locale={locale} />
                      </td>
                      {canManageResponse ? (
                        <td className="px-3 py-2">
                          {String(inv.response_status) === "invited" ? (
                            <div className="flex gap-2">
                              <ServerActionForm action={updateRfqSupplierResponseAction}>
                                <input type="hidden" name="invitationId" value={String(inv.id)} />
                                <input type="hidden" name="responseStatus" value="acknowledged" />
                                <Button type="submit" variant="secondary">{td.acknowledge}</Button>
                              </ServerActionForm>
                              <ServerActionForm action={updateRfqSupplierResponseAction}>
                                <input type="hidden" name="invitationId" value={String(inv.id)} />
                                <input type="hidden" name="responseStatus" value="declined" />
                                <Button type="submit" variant="danger">{td.decline}</Button>
                              </ServerActionForm>
                            </div>
                          ) : (
                            <span className="text-muted">{common.none}</span>
                          )}
                        </td>
                      ) : null}
                      {canManageInvites ? (
                        <td className="px-3 py-2">
                          <RfqSupplierRemoveButton rfqId={rfq.id} invitationId={String(inv.id)} locale={locale} />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        {canManageInvites && canListSuppliers ? (
          <RfqSupplierInvitePanel rfqId={rfq.id} candidates={inviteCandidates} locale={locale} />
        ) : canManageInvites ? (
          <p className="mt-3 text-sm text-muted">{td.supplierReadRequired}</p>
        ) : null}
      </Card>

      {/* Quotations received */}
      {(quotations ?? []).length > 0 ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.quotationsTitle}</h2>
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className={thClass}>{td.quotationColumns.number}</th>
                  <th className={thClass}>{td.quotationColumns.supplier}</th>
                  <th className={thClass}>{td.quotationColumns.date}</th>
                  <th className="px-3 py-2 text-end font-medium">{td.quotationColumns.total}</th>
                  <th className={thClass}>{td.quotationColumns.status}</th>
                </tr>
              </thead>
              <tbody>
                {(quotations ?? []).map((q) => {
                  const sup = Array.isArray(q.suppliers) ? q.suppliers[0] : q.suppliers;
                  return (
                    <tr key={q.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <Link href={`/procurement/quotations/${q.id}`} className="font-medium text-primary hover:underline">
                          {q.quotation_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-ink">{(sup as Record<string, string> | null)?.legal_name ?? common.none}</td>
                      <td className="px-3 py-2 tabular-nums">{q.quotation_date}</td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        <MoneyDisplay amount={q.total} currency={q.currency} locale={locale} />
                      </td>
                      <td className="px-3 py-2"><CommercialStatusBadge status={q.status} locale={locale} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      ) : null}

      {/* Comparison / award status */}
      {comparison ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.comparisonTitle}</h2>
          <CommercialStatusBadge status={comparison.status} locale={locale} />
          {comparison.status === "awarded" ? (
            <p className="mt-2 text-sm font-medium text-success">{td.awarded}</p>
          ) : null}
        </Card>
      ) : null}

      {/* Activity */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">{common.activityTitle}</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">{common.noActivity}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2">
                <span className="text-ink">{a.action.replaceAll(".", " · ")}</span>
                <span className="tabular-nums text-muted">{new Date(a.created_at).toLocaleString(intlLocale(locale))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
