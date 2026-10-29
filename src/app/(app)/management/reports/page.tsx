import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, FileText } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { getAuthContext } from "@/server/context";
import { canViewManagement } from "@/modules/management/access";
import { MANAGEMENT_REPORT_CATALOG } from "@/modules/management/reports/catalog";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function ManagementReportsIndexPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const { t, locale } = await getI18n();
  const copy = t.management.reports;
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  return (
    <PageContainer data-testid="management-reports-index" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MANAGEMENT_REPORT_CATALOG.map((item) => (
          <Link key={item.kind} href={item.href} className="group block" data-testid={`report-card-${item.kind}`}>
            <Card className="flex h-full flex-col transition-colors group-hover:border-primary/40">
              <span
                className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary"
                aria-hidden
              >
                <FileText className="h-5 w-5" />
              </span>
              <h2 className="font-semibold text-ink">{pickLocalized(locale, item.titleAr, item.titleEn)}</h2>
              <p className="mt-1.5 flex-1 text-sm text-muted">
                {pickLocalized(locale, item.descriptionAr, item.descriptionEn)}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                {copy.openReport}
                <Arrow className="h-4 w-4" aria-hidden />
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </PageContainer>
  );
}
