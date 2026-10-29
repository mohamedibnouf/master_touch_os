import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Field, Input, PageHeader, Section, Select, StatCard, TableScroll } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { issueClientInvoiceAction } from "@/server/use-cases/commercial";
import { recordClientPaymentAction } from "@/server/use-cases/finance";
import { remainingBalance, roundMoney } from "@/server/domain/commercial";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const PAYMENT_METHODS = ["bank_transfer", "cheque", "cash", "card", "other"] as const;

function DetailRow({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? "flex justify-between gap-3 pt-1 font-semibold text-ink"
          : "flex justify-between gap-3 border-b border-line pb-2"
      }
    >
      <dt className={strong ? undefined : "text-muted"}>{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

export default async function ClientInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_invoice.read")) redirect("/finance");

  const { t, locale } = await getI18n();
  const td = t.financeClient.invoiceDetail;
  const tc = t.financeClient.common;
  const paymentMethodLabels: Record<string, string> = tc.paymentMethods;

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const invoice = await repo.getClientInvoice(id);
  if (!invoice) notFound();

  const project = Array.isArray(invoice.projects) ? invoice.projects[0] : invoice.projects;
  const contract = Array.isArray(invoice.project_contracts) ? invoice.project_contracts[0] : invoice.project_contracts;
  const valuation = Array.isArray(invoice.client_valuations) ? invoice.client_valuations[0] : invoice.client_valuations;
  const payments = (invoice.client_payments as Array<Record<string, unknown>>) ?? [];

  const totalPaid = roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0));
  const outstanding = remainingBalance(Number(invoice.total), totalPaid);

  const canIssue = hasPermission(ctx, "client_invoice.issue") && invoice.status === "draft";
  const canCollect =
    hasPermission(ctx, "client_payment.record") &&
    ["issued", "partially_paid", "overdue"].includes(invoice.status) &&
    outstanding > 0;

  const clientName = (contract as Record<string, string> | null)?.client_name ?? "—";
  const projectRow = project as Record<string, string | null> | null;
  const projectName = projectRow ? pickLocalized(locale, projectRow.name_ar, projectRow.name_en) : "";

  return (
    <PageContainer data-testid="client-invoice-detail-page" className="space-y-5">
      <PageHeader
        title={invoice.invoice_number}
        description={format(td.description, { client: clientName })}
        actions={
          <Link href="/finance/client-invoices" className="text-sm font-medium text-primary hover:underline">
            {tc.register}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <StatCard
          label={td.statusLabel}
          value={<CommercialStatusBadge status={invoice.status} locale={locale} />}
        />
        <StatCard
          label={td.invoiceTotal}
          tone="info"
          value={<MoneyDisplay amount={invoice.total} currency={invoice.currency} locale={locale} />}
        />
        <StatCard
          label={td.collected}
          tone="success"
          value={<MoneyDisplay amount={totalPaid} currency={invoice.currency} locale={locale} />}
        />
        <StatCard
          label={td.outstanding}
          tone={outstanding > 0 ? "danger" : "success"}
          value={<MoneyDisplay amount={outstanding} currency={invoice.currency} locale={locale} />}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title={td.infoTitle}>
          <dl className="grid gap-2 text-sm">
            <DetailRow label={td.client}>
              <span className="font-medium text-ink">{clientName}</span>
            </DetailRow>
            <DetailRow label={td.project}>
              {projectRow ? `${projectRow.project_code ?? ""} — ${projectName}` : "—"}
            </DetailRow>
            <DetailRow label={td.valuation}>
              {valuation ? (
                <Link
                  href={`/finance/client-valuations/${invoice.valuation_id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {(valuation as Record<string, string>).valuation_number}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label={td.invoiceDate}>
              <span className="tabular-nums">{invoice.invoice_date}</span>
            </DetailRow>
            <DetailRow label={td.dueDate}>
              <span className="tabular-nums">{invoice.due_date ?? "—"}</span>
            </DetailRow>
          </dl>
        </Section>
        <Section title={td.amountsTitle}>
          <dl className="grid gap-2 text-sm tabular-nums">
            <DetailRow label={td.beforeVat}>
              <MoneyDisplay amount={invoice.amount} currency={invoice.currency} locale={locale} />
            </DetailRow>
            <DetailRow label={td.vat}>
              <MoneyDisplay amount={invoice.vat_amount} currency={invoice.currency} locale={locale} />
            </DetailRow>
            <DetailRow label={td.total} strong>
              <MoneyDisplay amount={invoice.total} currency={invoice.currency} locale={locale} />
            </DetailRow>
          </dl>
        </Section>
      </div>

      {payments.length > 0 ? (
        <Section title={td.collectionsTitle}>
          <TableScroll>
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-muted">
                <tr>
                  <th className="px-3 py-2.5 text-start font-medium">{td.colDate}</th>
                  <th className="px-3 py-2.5 text-end font-medium">{td.colAmount}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{td.colReference}</th>
                  <th className="px-3 py-2.5 text-start font-medium">{td.colMethod}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const method = String(p.payment_method);
                  return (
                    <tr key={String(p.id)} className="border-t border-line">
                      <td className="px-3 py-2.5 tabular-nums">{String(p.received_date)}</td>
                      <td className="px-3 py-2.5 text-end font-medium tabular-nums text-ink">
                        <MoneyDisplay amount={p.amount as number} currency={invoice.currency} locale={locale} />
                      </td>
                      <td className="px-3 py-2.5">{String(p.reference ?? "—")}</td>
                      <td className="px-3 py-2.5 text-muted">
                        {paymentMethodLabels[method] ?? commercialStatusLabel(method, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Section>
      ) : null}

      {canIssue ? (
        <div data-testid="client-invoice-issue-card">
          <Section title={td.issueTitle}>
            <ServerActionForm action={issueClientInvoiceAction} data-testid="client-invoice-issue-form">
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <Button type="submit" data-testid="client-invoice-issue-submit">
                {td.issueSubmit}
              </Button>
            </ServerActionForm>
          </Section>
        </div>
      ) : null}

      {canCollect ? (
        <div data-testid="client-invoice-payment-card">
          <Section title={td.recordCollectionTitle}>
            <p className="mb-4 text-sm text-muted">
              {td.remainingAmount}{" "}
              <span className="font-medium tabular-nums text-ink">
                <MoneyDisplay amount={outstanding} currency={invoice.currency} locale={locale} />
              </span>
            </p>
            <ServerActionForm
              action={recordClientPaymentAction}
              className="grid gap-4"
              data-testid="client-invoice-payment-form"
            >
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={td.amount}>
                  <Input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={String(outstanding)}
                    defaultValue={String(outstanding)}
                    required
                    data-testid="client-payment-amount"
                  />
                </Field>
                <Field label={td.receivedDate}>
                  <Input
                    name="receivedDate"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    data-testid="client-payment-date"
                  />
                </Field>
                <Field label={td.reference}>
                  <Input name="reference" required placeholder="TRF-2025-001" data-testid="client-payment-reference" />
                </Field>
                <Field label={td.paymentMethod}>
                  <Select name="paymentMethod" defaultValue="bank_transfer">
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {tc.paymentMethods[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" data-testid="client-payment-submit">
                  {td.recordCollectionSubmit}
                </Button>
              </div>
            </ServerActionForm>
          </Section>
        </div>
      ) : null}

      {invoice.status === "paid" ? (
        <div className="rounded-md bg-success-soft px-4 py-3 text-sm font-medium text-success">
          {td.fullyCollected}
        </div>
      ) : null}
    </PageContainer>
  );
}
