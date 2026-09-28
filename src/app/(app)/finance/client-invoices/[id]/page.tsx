import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
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

export default async function ClientInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_invoice.read")) redirect("/finance");

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

  return (
    <PageContainer data-testid="client-invoice-detail-page" className="space-y-5">
      <PageHeader
        title={invoice.invoice_number}
        description={`فاتورة عميل — ${(contract as Record<string, string> | null)?.client_name ?? "—"}`}
        actions={
          <Link href="/finance/client-invoices" className="text-sm underline">
            السجل
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2">
            <CommercialStatusBadge status={invoice.status} />
          </div>
        </Card>
        <Card>
          <p className="text-sm text-muted">إجمالي الفاتورة</p>
          <p className="mt-2 font-bold text-navy">
            <MoneyDisplay amount={invoice.total} currency={invoice.currency} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">المحصّل</p>
          <p className="mt-2 font-semibold text-success">
            <MoneyDisplay amount={totalPaid} currency={invoice.currency} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">المتبقي</p>
          <p className={`mt-2 font-bold ${outstanding > 0 ? "text-danger" : "text-success"}`}>
            <MoneyDisplay amount={outstanding} currency={invoice.currency} />
          </p>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-navy">معلومات الفاتورة</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">العميل</dt>
              <dd className="font-medium">{(contract as Record<string, string> | null)?.client_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">المشروع</dt>
              <dd>
                {project
                  ? `${(project as Record<string, string>).project_code} — ${(project as Record<string, string>).name_ar}`
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">المستخلص</dt>
              <dd>
                {valuation ? (
                  <Link
                    href={`/finance/client-valuations/${invoice.valuation_id}`}
                    className="text-navy underline"
                  >
                    {(valuation as Record<string, string>).valuation_number}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">تاريخ الفاتورة</dt>
              <dd>{invoice.invoice_date}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">تاريخ الاستحقاق</dt>
              <dd>{invoice.due_date ?? "—"}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-navy">المبالغ</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">قبل الضريبة</dt>
              <dd>
                <MoneyDisplay amount={invoice.amount} currency={invoice.currency} />
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">ضريبة القيمة المضافة</dt>
              <dd>
                <MoneyDisplay amount={invoice.vat_amount} currency={invoice.currency} />
              </dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>الإجمالي</dt>
              <dd>
                <MoneyDisplay amount={invoice.total} currency={invoice.currency} />
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {payments.length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">سجل التحصيل</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 text-right">التاريخ</th>
                  <th className="py-2 text-right">المبلغ</th>
                  <th className="py-2 text-right">المرجع</th>
                  <th className="py-2 text-right">الطريقة</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={String(p.id)} className="border-t border-line">
                    <td className="py-2">{String(p.received_date)}</td>
                    <td className="py-2 font-medium">
                      <MoneyDisplay amount={p.amount as number} currency={invoice.currency} />
                    </td>
                    <td className="py-2">{String(p.reference ?? "—")}</td>
                    <td className="py-2">{commercialStatusLabel(String(p.payment_method))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {canIssue ? (
        <Card className="mb-6" data-testid="client-invoice-issue-card">
          <h2 className="mb-3 font-semibold text-navy">إصدار الفاتورة</h2>
          <ServerActionForm action={issueClientInvoiceAction} data-testid="client-invoice-issue-form">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <Button type="submit" data-testid="client-invoice-issue-submit">
              إصدار الفاتورة ✓
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {canCollect ? (
        <Card className="mb-6" data-testid="client-invoice-payment-card">
          <h2 className="mb-4 font-semibold text-navy">تسجيل تحصيل</h2>
          <p className="mb-4 text-sm text-muted">
            المبلغ المتبقي: <MoneyDisplay amount={outstanding} currency={invoice.currency} />
          </p>
          <ServerActionForm action={recordClientPaymentAction} className="grid gap-4" data-testid="client-invoice-payment-form">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="المبلغ (SAR)">
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
              <Field label="تاريخ التحصيل">
                <Input
                  name="receivedDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  data-testid="client-payment-date"
                />
              </Field>
              <Field label="رقم المرجع">
                <Input name="reference" required placeholder="TRF-2025-001" data-testid="client-payment-reference" />
              </Field>
              <Field label="طريقة الدفع">
                <Select name="paymentMethod" defaultValue="bank_transfer">
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="cheque">شيك</option>
                  <option value="cash">نقد</option>
                  <option value="card">بطاقة</option>
                  <option value="other">أخرى</option>
                </Select>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" data-testid="client-payment-submit">
                تسجيل التحصيل
              </Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {invoice.status === "paid" ? (
        <div className="mb-6 rounded-md bg-success/15 px-4 py-3 text-sm font-medium text-success">
          ✓ تم التحصيل الكامل
        </div>
      ) : null}
    </PageContainer>
  );
}
