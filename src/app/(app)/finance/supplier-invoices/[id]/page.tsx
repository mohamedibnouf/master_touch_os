import { auditActionLabel } from "@/lib/ui/audit-action-labels";
import { todayInRiyadh } from "@/lib/time/riyadh";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { approveSupplierInvoiceForPaymentAction, recordSupplierPaymentAction } from "@/server/use-cases/finance";
import { roundMoney, remainingBalance } from "@/server/domain/commercial";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type LegState = "matched" | "discrepancy" | "missing" | "notChecked";

const PAYMENT_METHODS = ["bank_transfer", "cheque", "cash", "card", "other"] as const;

const legTone: Record<LegState, "success" | "danger" | "warning" | "neutral"> = {
  matched: "success",
  discrepancy: "danger",
  missing: "warning",
  notChecked: "neutral",
};

function lookup<T extends Record<string, string>>(map: T, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key as keyof T] : undefined;
}

export default async function SupplierInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier_invoice.read")) redirect("/finance");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const invoice = await repo.getSupplierInvoice(id);
  if (!invoice) notFound();

  const { t, locale } = await getI18n();
  const td = t.financePayables.supplierInvoiceDetail;
  const tm = td.matching;
  const common = t.financePayables.common;

  const purchaseOrderId = (invoice.purchase_order_id as string | null) ?? null;
  const [audit, grnRes] = await Promise.all([
    repo.getAuditForEntity("supplier_invoice", id),
    purchaseOrderId
      ? supabase
          .from("goods_receipts")
          .select("id, receipt_number, status")
          .eq("purchase_order_id", purchaseOrderId)
          .neq("status", "draft")
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Array<{ id: string; receipt_number: string; status: string }> }),
  ]);
  const grnNumbers = (grnRes.data ?? []).map((g) => g.receipt_number).filter(Boolean);

  const supplier = Array.isArray(invoice.suppliers) ? invoice.suppliers[0] : invoice.suppliers;
  const project = Array.isArray(invoice.projects) ? invoice.projects[0] : invoice.projects;
  const po = Array.isArray(invoice.purchase_orders) ? invoice.purchase_orders[0] : invoice.purchase_orders;
  const payments = (invoice.supplier_payments as Array<Record<string, unknown>>) ?? [];
  const supplierName = (supplier as Record<string, string> | null)?.legal_name ?? common.none;
  const projectRow = project as Record<string, string | null> | null;

  const totalPaid = roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0));
  const outstanding = remainingBalance(Number(invoice.total), totalPaid);

  const matchFlags = (invoice.match_flags as Array<Record<string, unknown>>) ?? [];
  const hasDiscrepancy = invoice.status === "discrepancy" || matchFlags.some((f) => f.severity === "high");
  const canApprovePayment =
    hasPermission(ctx, "supplier_invoice.approve") &&
    ["received", "matched", "discrepancy", "under_review"].includes(invoice.status);
  const canPay =
    hasPermission(ctx, "supplier_payment.record") &&
    ["approved_for_payment", "partially_paid"].includes(invoice.status) &&
    outstanding > 0;

  // Three-way match legs, derived from the flags the database match produced.
  const flagCodes = new Set(matchFlags.map((f) => String(f.code)));
  const poLeg: LegState = flagCodes.has("missing_po")
    ? "missing"
    : flagCodes.has("invoice_gt_po")
      ? "discrepancy"
      : "matched";
  const grnLeg: LegState = flagCodes.has("missing_po")
    ? "notChecked"
    : flagCodes.has("invoice_without_receipt") || flagCodes.has("invoice_exceeds_receipt")
      ? "discrepancy"
      : "matched";
  const invoiceLeg: LegState = hasDiscrepancy || matchFlags.length > 0 ? "discrepancy" : "matched";
  const legs: Array<{ key: string; label: string; state: LegState; detail?: string }> = [
    {
      key: "po",
      label: tm.legs.po,
      state: poLeg,
      detail: (po as Record<string, string> | null)?.po_number ?? undefined,
    },
    {
      key: "grn",
      label: tm.legs.grn,
      state: grnLeg,
      detail: grnNumbers.length > 0 ? grnNumbers.join(locale === "ar" ? "، " : ", ") : undefined,
    },
    { key: "invoice", label: tm.legs.invoice, state: invoiceLeg, detail: invoice.invoice_number },
  ];
  const isClean = matchFlags.length === 0 && !hasDiscrepancy;

  const rowClass = "flex items-baseline justify-between gap-4 border-b border-line pb-2";

  return (
    <PageContainer data-testid="invoice-detail-page" className="space-y-5">
      <PageHeader
        title={invoice.invoice_number}
        description={format(td.subtitle, { supplier: supplierName })}
        actions={
          <Link
            href="/finance/supplier-invoices"
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            {common.register}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <p className="text-xs font-medium text-muted">{td.status}</p>
          <div className="mt-2"><CommercialStatusBadge status={invoice.status} locale={locale} /></div>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.invoiceTotal}</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-ink">
            <MoneyDisplay amount={invoice.total} currency={invoice.currency} locale={locale} />
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.paid}</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-success">
            <MoneyDisplay amount={totalPaid} currency={invoice.currency} locale={locale} />
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-muted">{td.outstanding}</p>
          <p className={cn("mt-2 text-lg font-semibold tabular-nums", outstanding > 0 ? "text-danger" : "text-success")}>
            <MoneyDisplay amount={outstanding} currency={invoice.currency} locale={locale} />
          </p>
        </Card>
      </div>

      {/* Invoice details */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.infoTitle}</h2>
          <dl className="grid gap-2 text-sm">
            <div className={rowClass}>
              <dt className="text-muted">{td.supplier}</dt>
              <dd className="font-medium text-ink">{supplierName}</dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.invoiceDate}</dt>
              <dd className="tabular-nums">{invoice.invoice_date}</dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.dueDate}</dt>
              <dd className="tabular-nums">{invoice.due_date ?? common.none}</dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.purchaseOrder}</dt>
              <dd>
                {po ? (
                  <Link href={`/procurement/purchase-orders/${(po as Record<string, string>).id ?? ""}`} className="font-medium text-primary hover:underline">
                    {(po as Record<string, string>).po_number}
                  </Link>
                ) : common.none}
              </dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.project}</dt>
              <dd className="text-end">
                {projectRow
                  ? format(common.projectOption, {
                      code: projectRow.project_code ?? "",
                      name: pickLocalized(locale, projectRow.name_ar, projectRow.name_en),
                    })
                  : common.none}
              </dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.amountsTitle}</h2>
          <dl className="grid gap-2 text-sm">
            <div className={rowClass}>
              <dt className="text-muted">{td.subtotal}</dt>
              <dd className="text-end tabular-nums"><MoneyDisplay amount={invoice.subtotal} currency={invoice.currency} locale={locale} /></dd>
            </div>
            <div className={rowClass}>
              <dt className="text-muted">{td.vat}</dt>
              <dd className="text-end tabular-nums"><MoneyDisplay amount={invoice.vat_amount} currency={invoice.currency} locale={locale} /></dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 font-semibold text-ink">
              <dt>{td.total}</dt>
              <dd className="text-end tabular-nums"><MoneyDisplay amount={invoice.total} currency={invoice.currency} locale={locale} /></dd>
            </div>
          </dl>
        </Card>
      </div>

      {/* Three-way match result */}
      <Card
        data-testid="invoice-match-card"
        className={cn(hasDiscrepancy ? "border-danger/40 bg-danger-soft/40" : "border-success/40 bg-success-soft/40")}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-ink">{tm.title}</h2>
            <p className="mt-0.5 text-xs text-muted">{tm.description}</p>
          </div>
          <Badge tone={hasDiscrepancy ? "danger" : isClean ? "success" : "warning"}>
            {hasDiscrepancy || !isClean ? tm.discrepancy : tm.matched}
          </Badge>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {legs.map((leg) => (
            <li
              key={leg.key}
              className={cn(
                "rounded-[var(--radius-control)] border bg-surface p-3",
                leg.state === "matched" && "border-success/40",
                leg.state === "discrepancy" && "border-danger/50",
                leg.state === "missing" && "border-warning-border",
                leg.state === "notChecked" && "border-line",
              )}
            >
              <p className="text-xs font-medium text-muted">{leg.label}</p>
              <p className="mt-1 truncate text-sm font-medium text-ink">{leg.detail ?? common.none}</p>
              <div className="mt-2">
                <Badge tone={legTone[leg.state]}>{tm.legStates[leg.state]}</Badge>
              </div>
            </li>
          ))}
        </ol>

        {isClean ? (
          <p className="mt-4 text-sm font-medium text-success">✓ {tm.noFlags}</p>
        ) : matchFlags.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {matchFlags.map((flag, i) => {
              const severity = String(flag.severity);
              const code = String(flag.code);
              return (
                <li
                  key={i}
                  className={cn(
                    "flex items-start gap-2 text-sm",
                    severity === "high" ? "text-danger" : "text-warning",
                  )}
                >
                  <span aria-hidden>{severity === "high" ? "⚠" : "ℹ"}</span>
                  <span className="flex-1">{lookup(tm.flags, code) ?? code.replaceAll("_", " ")}</span>
                  <Badge tone={severity === "high" ? "danger" : "warning"}>
                    {lookup(tm.severity, severity) ?? severity}
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="mt-3 text-xs text-muted">{tm.tolerance}</p>

        {invoice.review_notes ? (
          <div className="mt-3 border-t border-line pt-2 text-sm">
            <p className="text-xs font-medium text-muted">{tm.reviewNotes}</p>
            <p className="mt-1 text-ink">{invoice.review_notes}</p>
          </div>
        ) : null}
      </Card>

      {/* Payments history */}
      {payments.length > 0 ? (
        <Card>
          <h2 className="mb-3 font-semibold text-ink">{td.paymentsTitle}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-2 text-start font-medium">{td.paymentColumns.date}</th>
                  <th className="py-2 text-end font-medium">{td.paymentColumns.amount}</th>
                  <th className="py-2 ps-6 text-start font-medium">{td.paymentColumns.reference}</th>
                  <th className="py-2 text-start font-medium">{td.paymentColumns.method}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const method = String(p.payment_method);
                  return (
                    <tr key={String(p.id)} className="border-t border-line">
                      <td className="py-2 tabular-nums">{String(p.payment_date)}</td>
                      <td className="py-2 text-end font-medium tabular-nums text-ink">
                        <MoneyDisplay amount={p.amount as number} currency={invoice.currency} locale={locale} />
                      </td>
                      <td className="py-2 ps-6">{String(p.payment_reference)}</td>
                      <td className="py-2">
                        {lookup(td.paymentMethods, method) ?? commercialStatusLabel(method, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Approve for payment */}
      {canApprovePayment ? (
        <Card data-testid="invoice-approve-card">
          <h2 className="mb-1 font-semibold text-ink">{td.approveTitle}</h2>
          <p className="mb-3 text-sm text-muted">{td.approveDescription}</p>
          <ServerActionForm action={approveSupplierInvoiceForPaymentAction} data-testid="invoice-approve-form">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <Button type="submit" data-testid="invoice-approve-submit">{td.approveSubmit}</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Record payment */}
      {canPay ? (
        <Card data-testid="invoice-payment-card">
          <h2 className="mb-2 font-semibold text-ink">{td.paymentTitle}</h2>
          <p className="mb-4 text-sm text-muted">
            {td.remaining}{" "}
            <span className="font-medium tabular-nums text-ink">
              <MoneyDisplay amount={outstanding} currency={invoice.currency} locale={locale} />
            </span>
            {" "}— {td.overpayGuard}
          </p>
          <ServerActionForm action={recordSupplierPaymentAction} className="grid gap-4" data-testid="invoice-payment-form">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={td.amount} required>
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  defaultValue={String(outstanding)}
                  required
                  className="tabular-nums"
                  data-testid="payment-amount"
                />
              </Field>
              <Field label={td.paymentDate} required>
                <Input name="paymentDate" type="date" required defaultValue={todayInRiyadh()} data-testid="payment-date" />
              </Field>
              <Field label={td.paymentReference} required>
                <Input name="paymentReference" required placeholder={td.paymentReferencePlaceholder} data-testid="payment-reference" />
              </Field>
              <Field label={td.paymentMethod}>
                <Select name="paymentMethod" defaultValue="bank_transfer">
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {td.paymentMethods[method]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={td.bankReference}>
                <Input name="bankReference" placeholder={td.bankReferencePlaceholder} />
              </Field>
            </div>
            <Field label={td.notes}>
              <Textarea name="notes" placeholder={td.notesPlaceholder} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" data-testid="payment-submit">{td.paymentSubmit}</Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {invoice.status === "paid" ? (
        <div className="rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success">
          {td.fullyPaid}
        </div>
      ) : null}

      {/* Activity */}
      <Card>
        <h2 className="mb-3 font-semibold text-ink">{common.activity}</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">{common.noActivity}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-4 border-b border-line pb-2">
                <span className="text-ink">{auditActionLabel(a.action, locale)}</span>
                <span className="tabular-nums text-muted">{new Date(a.created_at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
