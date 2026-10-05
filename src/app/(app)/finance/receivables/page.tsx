import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CommercialStatusBadge } from "@/components/commercial/status-badge";
import { MoneyDisplay } from "@/components/commercial/money";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CommercialRepository } from "@/server/repositories/commercial.repository";
import { remainingBalance, roundMoney } from "@/server/domain/commercial";

type AgeBucket = "CURRENT" | "1-30" | "31-60" | "61-90" | "90+";

function ageBucket(dueDate: string | null, today: string): AgeBucket {
  if (!dueDate || dueDate >= today) return "CURRENT";
  const daysPast = Math.floor(
    (Date.parse(today) - Date.parse(dueDate)) / (1000 * 60 * 60 * 24),
  );
  if (daysPast <= 30) return "1-30";
  if (daysPast <= 60) return "31-60";
  if (daysPast <= 90) return "61-90";
  return "90+";
}

const BUCKET_LABELS: Record<AgeBucket, string> = {
  CURRENT: "جاري",
  "1-30": "1–30 يوم",
  "31-60": "31–60 يوم",
  "61-90": "61–90 يوم",
  "90+": "أكثر من 90 يوم",
};

export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "finance.read") && !hasPermission(ctx, "client_invoice.read")) {
    redirect("/finance");
  }

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createServerSupabaseClient();
  const repo = new CommercialRepository(supabase);
  const rows = await repo.listReceivables(ctx.organization.id);

  const items = rows.map((inv) => {
    const payments = (inv.client_payments as Array<{ amount: number }>) ?? [];
    const paid = roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0));
    const outstanding = remainingBalance(Number(inv.total), paid);
    const bucket = ageBucket(inv.due_date, today);
    const project = Array.isArray(inv.projects) ? inv.projects[0] : inv.projects;
    const contract = Array.isArray(inv.project_contracts) ? inv.project_contracts[0] : inv.project_contracts;
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      client: (contract as Record<string, string> | null)?.client_name ?? "—",
      project: (project as Record<string, string> | null)?.project_code ?? "—",
      dueDate: inv.due_date,
      total: Number(inv.total),
      outstanding,
      currency: inv.currency,
      status: inv.status,
      bucket,
    };
  }).filter((i) => i.outstanding > 0);

  const bucketTotals: Record<AgeBucket, { count: number; amount: number }> = {
    CURRENT: { count: 0, amount: 0 },
    "1-30": { count: 0, amount: 0 },
    "31-60": { count: 0, amount: 0 },
    "61-90": { count: 0, amount: 0 },
    "90+": { count: 0, amount: 0 },
  };

  for (const item of items) {
    bucketTotals[item.bucket].count += 1;
    bucketTotals[item.bucket].amount = roundMoney(bucketTotals[item.bucket].amount + item.outstanding);
  }

  const filtered = params.bucket
    ? items.filter((i) => i.bucket === params.bucket)
    : items;

  return (
    <PageContainer data-testid="receivables-page" className="space-y-5">
      <PageHeader
        title="ذمم العملاء"
        description="تحليل أعمار الذمم المدينة حسب تاريخ الاستحقاق والمتبقي"
        actions={
          <Link href="/finance" className="text-sm underline">
            المالية
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(Object.keys(BUCKET_LABELS) as AgeBucket[]).map((bucket) => (
          <Link key={bucket} href={`/finance/receivables?bucket=${bucket}`}>
            <Card
              className={`transition hover:border-primary/30 ${params.bucket === bucket ? "border-primary ring-1 ring-primary/20" : ""}`}
              data-testid={`receivables-bucket-${bucket}`}
            >
              <p className="text-sm text-muted">{BUCKET_LABELS[bucket]}</p>
              <p className="mt-2 text-2xl font-semibold text-navy">{bucketTotals[bucket].count}</p>
              <p className="mt-1 text-sm font-medium text-danger">
                <MoneyDisplay amount={bucketTotals[bucket].amount} currency="SAR" />
              </p>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-navy">
            {params.bucket ? BUCKET_LABELS[params.bucket as AgeBucket] ?? "الكل" : "كل الذمم المفتوحة"}
          </h2>
          {params.bucket ? (
            <Link href="/finance/receivables" className="text-sm underline">
              إظهار الكل
            </Link>
          ) : null}
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="لا توجد ذمم في هذا التصنيف." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" data-testid="receivables-table">
              <thead className="bg-paper text-right text-muted">
                <tr>
                  <th className="px-3 py-2">الفاتورة</th>
                  <th className="px-3 py-2">العميل</th>
                  <th className="px-3 py-2">المشروع</th>
                  <th className="px-3 py-2">الاستحقاق</th>
                  <th className="px-3 py-2">المتبقي</th>
                  <th className="px-3 py-2">التصنيف</th>
                  <th className="px-3 py-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link href={`/finance/client-invoices/${item.id}`} className="font-medium text-navy underline">
                        {item.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{item.client}</td>
                    <td className="px-3 py-2">{item.project}</td>
                    <td className="px-3 py-2">{item.dueDate ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-danger">
                      <MoneyDisplay amount={item.outstanding} currency={item.currency} />
                    </td>
                    <td className="px-3 py-2">{BUCKET_LABELS[item.bucket]}</td>
                    <td className="px-3 py-2">
                      <CommercialStatusBadge status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
