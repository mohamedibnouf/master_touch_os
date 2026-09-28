import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";

export default async function FinancePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const canAp = hasPermission(ctx, "supplier_invoice.read");
  const canAr = hasPermission(ctx, "client_invoice.read") || hasPermission(ctx, "finance.read");
  const canPay = hasPermission(ctx, "client_payment.record");
  if (!canAp && !canAr && !canPay) redirect("/");

  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const stats = await repo.financeDashboardStats(ctx.organization.id);

  const [supplierInvoices, clientInvoices, approvals] = await Promise.all([
    canAp
      ? supabase
          .from("supplier_invoices")
          .select("id, invoice_number, total, currency, due_date, status, project_id")
          .eq("organization_id", ctx.organization.id)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    canAr
      ? supabase
          .from("client_invoices")
          .select("id, invoice_number, total, currency, due_date, status")
          .eq("organization_id", ctx.organization.id)
          .in("status", ["issued", "partially_paid", "overdue"])
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    supabase
      .from("approval_requests")
      .select("id, title, status, due_at, entity_type")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["pending", "in_progress"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(20),
  ]);

  return (
    <PageContainer data-testid="finance-dashboard-page" className="space-y-5">
      <PageHeader
        title="المالية"
        description="فواتير الموردين، مستخلصات العملاء، الذمم والتحصيل"
        actions={
          <div className="flex flex-wrap gap-3 text-sm">
            {canAp ? (
              <Link href="/finance/supplier-invoices" className="text-navy underline">
                فواتير الموردين
              </Link>
            ) : null}
            {hasPermission(ctx, "client_valuation.read") ? (
              <Link href="/finance/client-valuations" className="text-navy underline" data-testid="nav-client-valuations">
                مستخلصات العملاء
              </Link>
            ) : null}
            {canAr ? (
              <Link href="/finance/client-invoices" className="text-navy underline" data-testid="nav-client-invoices">
                فواتير العملاء
              </Link>
            ) : null}
            {hasPermission(ctx, "variation.read") ? (
              <Link href="/finance/variations" className="text-navy underline" data-testid="nav-variations">
                أوامر التغيير
              </Link>
            ) : null}
            {canAr ? (
              <Link href="/finance/receivables" className="text-navy underline" data-testid="nav-receivables">
                ذمم العملاء
              </Link>
            ) : null}
            <Link href="/procurement" className="text-navy underline">
              المشتريات
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {canAp ? (
          <>
            <Card data-testid="stat-due-in-7">
              <p className="text-sm text-muted">AP مستحقة خلال 7 أيام</p>
              <p className="mt-2 text-3xl font-semibold text-navy">{stats.dueIn7}</p>
            </Card>
            <Card data-testid="stat-overdue-ap">
              <p className="text-sm text-muted">AP متأخرة</p>
              <p className="mt-2 text-3xl font-semibold text-danger">{stats.overdueAp}</p>
            </Card>
            <Card data-testid="stat-approved-payment">
              <p className="text-sm text-muted">معتمدة للصرف</p>
              <p className="mt-2 text-3xl font-semibold text-warning">{stats.approvedForPayment}</p>
            </Card>
          </>
        ) : null}
        {canAr ? (
          <>
            <Card data-testid="stat-outstanding-ar">
              <p className="text-sm text-muted">فواتير AR مفتوحة</p>
              <p className="mt-2 text-3xl font-semibold text-navy">{stats.outstandingAr}</p>
            </Card>
            <Card data-testid="stat-overdue-ar">
              <p className="text-sm text-muted">AR متأخرة</p>
              <p className="mt-2 text-3xl font-semibold text-danger">{stats.overdueAr}</p>
            </Card>
            <Card>
              <p className="text-sm text-muted">تحليل الذمم</p>
              <Link href="/finance/receivables" className="mt-2 inline-block text-sm font-medium text-navy underline">
                عرض أعمار الذمم →
              </Link>
            </Card>
          </>
        ) : null}
        {canAp ? (
          <Card data-testid="stat-discrepancies">
            <p className="text-sm text-muted">فواتير باختلاف مطابقة</p>
            <p className="mt-2 text-3xl font-semibold text-warning">{stats.discrepancies}</p>
          </Card>
        ) : null}
      </div>

      {canAp ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-navy">فواتير الموردين المفتوحة</h2>
          {(supplierInvoices.data ?? []).length === 0 ? (
            <EmptyState title="لا توجد فواتير مفتوحة." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-paper text-right text-muted">
                  <tr>
                    <th className="px-3 py-2">رقم الفاتورة</th>
                    <th className="px-3 py-2">المبلغ</th>
                    <th className="px-3 py-2">الاستحقاق</th>
                    <th className="px-3 py-2">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {(supplierInvoices.data ?? []).map((inv) => (
                    <tr key={inv.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <Link href={`/finance/supplier-invoices/${inv.id}`} className="font-medium text-navy underline">
                          {inv.invoice_number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <MoneyDisplay amount={inv.total} currency={inv.currency} />
                      </td>
                      <td className="px-3 py-2">{inv.due_date ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge tone="navy">{inv.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {canAr ? (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-navy">فواتير العملاء المستحقة</h2>
              <Link href="/finance/receivables" className="text-sm text-navy underline">
                الذمم
              </Link>
            </div>
            {(clientInvoices.data ?? []).length === 0 ? (
              <EmptyState title="لا توجد ذمم مدينة مفتوحة." />
            ) : (
              <ul className="space-y-2 text-sm">
                {(clientInvoices.data ?? []).map((inv) => (
                  <li key={inv.id} className="flex justify-between border-b border-line pb-2">
                    <Link href={`/finance/client-invoices/${inv.id}`} className="font-medium text-navy underline">
                      {inv.invoice_number}
                    </Link>
                    <span>
                      <MoneyDisplay amount={inv.total} currency={inv.currency} /> · {inv.due_date ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-4 text-base font-semibold text-navy">موافقات مالية معلّقة</h2>
          {(approvals.data ?? []).length === 0 ? (
            <EmptyState title="لا توجد موافقات معلّقة." />
          ) : (
            <ul className="space-y-2 text-sm">
              {(approvals.data ?? []).map((a) => (
                <li key={a.id} className="flex justify-between border-b border-line pb-2">
                  <span>{a.title}</span>
                  <Badge tone="warning">{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
