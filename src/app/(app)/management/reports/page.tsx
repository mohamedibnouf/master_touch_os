import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { canViewManagement } from "@/modules/management/access";
import { MANAGEMENT_REPORT_CATALOG } from "@/modules/management/reports/catalog";

export default async function ManagementReportsIndexPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  return (
    <div data-testid="management-reports-index">
      <PageHeader
        title="تقارير الإدارة"
        description="تقارير حتمية مبنية على البيانات التشغيلية ومحرك المخاطر — بدون ذكاء اصطناعي."
      />
      <ManagementNav pathname="/management/reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MANAGEMENT_REPORT_CATALOG.map((item) => (
          <Link key={item.kind} href={item.href} className="block" data-testid={`report-card-${item.kind}`}>
            <Card className="h-full transition hover:border-navy">
              <h2 className="font-semibold text-navy">{item.titleAr}</h2>
              <p className="mt-2 text-sm text-muted">{item.descriptionAr}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
