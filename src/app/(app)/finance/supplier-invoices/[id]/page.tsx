import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
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

export default async function SupplierInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "supplier_invoice.read")) redirect("/finance");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const invoice = await repo.getSupplierInvoice(id);
  if (!invoice) notFound();

  const audit = await repo.getAuditForEntity("supplier_invoice", id);

  const supplier = Array.isArray(invoice.suppliers) ? invoice.suppliers[0] : invoice.suppliers;
  const project = Array.isArray(invoice.projects) ? invoice.projects[0] : invoice.projects;
  const po = Array.isArray(invoice.purchase_orders) ? invoice.purchase_orders[0] : invoice.purchase_orders;
  const payments = (invoice.supplier_payments as Array<Record<string, unknown>>) ?? [];

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

  return (
    <div data-testid="invoice-detail-page">
      <PageHeader
        title={invoice.invoice_number}
        description={`فاتورة مورد — ${(supplier as Record<string, string> | null)?.legal_name ?? "—"}`}
        actions={
          <Link href="/finance/supplier-invoices" className="text-sm underline">
            السجل
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-muted">الحالة</p>
          <div className="mt-2"><CommercialStatusBadge status={invoice.status} /></div>
        </Card>
        <Card>
          <p className="text-sm text-muted">إجمالي الفاتورة</p>
          <p className="mt-2 font-bold text-navy">
            <MoneyDisplay amount={invoice.total} currency={invoice.currency} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">المدفوع</p>
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

      {/* Invoice details */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold text-navy">معلومات الفاتورة</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">المورد</dt>
              <dd className="font-medium">{(supplier as Record<string, string> | null)?.legal_name ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">تاريخ الفاتورة</dt>
              <dd>{invoice.invoice_date}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">تاريخ الاستحقاق</dt>
              <dd>{invoice.due_date ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">أمر الشراء</dt>
              <dd>
                {po ? (
                  <Link href={`/procurement/purchase-orders/${(po as Record<string, string>).id ?? ""}`} className="text-navy underline">
                    {(po as Record<string, string>).po_number}
                  </Link>
                ) : "—"}
              </dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">المشروع</dt>
              <dd>
                {project
                  ? `${(project as Record<string, string>).project_code} — ${(project as Record<string, string>).name_ar}`
                  : "—"}
              </dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-navy">المبالغ</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">قبل الضريبة</dt>
              <dd><MoneyDisplay amount={invoice.subtotal} currency={invoice.currency} /></dd>
            </div>
            <div className="flex justify-between border-b border-line pb-1">
              <dt className="text-muted">ضريبة القيمة المضافة</dt>
              <dd><MoneyDisplay amount={invoice.vat_amount} currency={invoice.currency} /></dd>
            </div>
            <div className="flex justify-between font-bold">
              <dt>الإجمالي</dt>
              <dd><MoneyDisplay amount={invoice.total} currency={invoice.currency} /></dd>
            </div>
          </dl>
        </Card>
      </div>

      {/* Match result */}
      <Card className={`mb-6 ${hasDiscrepancy ? "border-danger/40 bg-danger/5" : "border-success/40 bg-success/5"}`}>
        <h2 className="mb-3 font-semibold text-navy">نتيجة المطابقة</h2>
        {matchFlags.length === 0 ? (
          <p className="text-sm font-medium text-success">✓ مطابق — لا توجد ملاحظات</p>
        ) : (
          <ul className="space-y-2">
            {matchFlags.map((flag, i) => (
              <li key={i} className={`flex items-start gap-2 text-sm ${String(flag.severity) === "high" ? "text-danger" : "text-warning"}`}>
                <span>{String(flag.severity) === "high" ? "⚠️" : "ℹ️"}</span>
                <span>{String(flag.code).replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
        {invoice.review_notes ? (
          <p className="mt-3 text-sm text-muted border-t border-line pt-2">{invoice.review_notes}</p>
        ) : null}
      </Card>

      {/* Payments history */}
      {payments.length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold text-navy">سجل الدفعات</h2>
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
                    <td className="py-2">{String(p.payment_date)}</td>
                    <td className="py-2 tabular-nums font-medium">
                      <MoneyDisplay amount={p.amount as number} currency={invoice.currency} />
                    </td>
                    <td className="py-2">{String(p.payment_reference)}</td>
                    <td className="py-2">{commercialStatusLabel(String(p.payment_method))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Approve for payment */}
      {canApprovePayment ? (
        <Card className="mb-6" data-testid="invoice-approve-card">
          <h2 className="mb-3 font-semibold text-navy">اعتماد للصرف</h2>
          <ServerActionForm action={approveSupplierInvoiceForPaymentAction} data-testid="invoice-approve-form">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <Button type="submit" data-testid="invoice-approve-submit">اعتماد للصرف ✓</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {/* Record payment */}
      {canPay ? (
        <Card className="mb-6" data-testid="invoice-payment-card">
          <h2 className="mb-4 font-semibold text-navy">تسجيل دفعة</h2>
          <p className="mb-4 text-sm text-muted">
            المبلغ المتبقي: <MoneyDisplay amount={outstanding} currency={invoice.currency} />
            {" "}— لن يُقبل مبلغ يتجاوز المتبقي (محمي في قاعدة البيانات).
          </p>
          <ServerActionForm action={recordSupplierPaymentAction} className="grid gap-4" data-testid="invoice-payment-form">
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
                  data-testid="payment-amount"
                />
              </Field>
              <Field label="تاريخ الدفع">
                <Input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} data-testid="payment-date" />
              </Field>
              <Field label="رقم المرجع / التحويل">
                <Input name="paymentReference" required placeholder="مثال: TRF-2025-001" data-testid="payment-reference" />
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
              <Field label="مرجع البنك (اختياري)">
                <Input name="bankReference" placeholder="رقم مرجع البنك" />
              </Field>
            </div>
            <Field label="ملاحظات (اختياري)">
              <Textarea name="notes" placeholder="أي ملاحظات..." />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" data-testid="payment-submit">تسجيل الدفعة</Button>
            </div>
          </ServerActionForm>
        </Card>
      ) : null}

      {invoice.status === "paid" ? (
        <div className="mb-6 rounded-md bg-success/15 px-4 py-3 text-sm font-medium text-success">
          ✓ تم السداد الكامل — الفاتورة مدفوعة
        </div>
      ) : null}

      {/* Activity */}
      <Card>
        <h2 className="mb-3 font-semibold text-navy">سجل النشاط</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">لا يوجد نشاط مسجّل.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between border-b border-line pb-2">
                <span>{a.action.replaceAll(".", " · ")}</span>
                <span className="text-muted">{new Date(a.created_at).toLocaleString("ar-SA")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
