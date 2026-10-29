import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Info } from "lucide-react";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid, type ManagementMetric } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { getI18n } from "@/lib/i18n/server";

export default async function ManagementFinancePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.finance && !sections.payroll) redirect("/management");

  const { t } = await getI18n();
  const copy = t.management.finance;

  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    {
      ...sections,
      projects: false,
      approvals: false,
      procurement: false,
      people: false,
      attendanceLeave: false,
      activity: false,
    },
  );

  const warn = (value: number): ManagementMetric["tone"] => (value > 0 ? "warning" : "neutral");

  const metrics: ManagementMetric[] = [
    ...(sections.finance && snapshot.commercial
      ? [
          {
            key: "ar",
            label: copy.outstandingAr,
            value: snapshot.commercial.outstandingAr,
            href: "/finance/receivables",
            tone: "info" as const,
          },
          {
            key: "ar-od",
            label: copy.overdueAr,
            value: snapshot.commercial.overdueAr,
            href: "/finance/receivables",
            tone: warn(snapshot.commercial.overdueAr),
          },
          {
            key: "ap-od",
            label: copy.overdueAp,
            value: snapshot.commercial.overdueAp,
            href: "/finance/supplier-invoices",
            tone: warn(snapshot.commercial.overdueAp),
          },
          {
            key: "val",
            label: copy.pendingValuations,
            value: snapshot.commercial.pendingValuations,
            href: "/finance/client-valuations",
          },
          { key: "var", label: copy.openVariations, value: snapshot.commercial.openVariations, href: "/finance/variations" },
        ]
      : []),
    ...(sections.payroll && snapshot.payroll
      ? [
          {
            key: "pr-rev",
            label: copy.payrollReview,
            value: snapshot.payroll.underReview,
            href: "/payroll",
            tone: warn(snapshot.payroll.underReview),
          },
          { key: "pr-appr", label: copy.approvedAwaitingLock, value: snapshot.payroll.approvedAwaitingLock, href: "/payroll" },
          {
            key: "pr-unpaid",
            label: copy.lockedUnpaid,
            value: snapshot.payroll.lockedUnpaidEntries,
            href: "/payroll",
            tone: warn(snapshot.payroll.lockedUnpaidEntries),
          },
        ]
      : []),
  ];

  return (
    <PageContainer data-testid="management-finance" className="space-y-5">
      <PageHeader title={copy.title} description={copy.description} />
      <ManagementNav pathname="/management/finance" />
      <MetricGrid metrics={metrics} />
      <Card className="flex items-start gap-3 bg-surface-muted text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p>
          {copy.notePrefix}{" "}
          <Link href="/finance" className="font-medium text-primary hover:underline">
            {copy.noteFinance}
          </Link>{" "}
          {copy.noteAnd}{" "}
          <Link href="/payroll" className="font-medium text-primary hover:underline">
            {copy.notePayroll}
          </Link>{" "}
          {copy.noteSuffix}
        </p>
      </Card>
    </PageContainer>
  );
}
