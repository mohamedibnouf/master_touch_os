import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import { MetricGrid } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";

export default async function ManagementFinancePage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");
  const sections = resolveManagementSections(ctx);
  if (!sections.finance && !sections.payroll) redirect("/management");

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

  const metrics = [
    ...(sections.finance && snapshot.commercial
      ? [
          { key: "ar", label: "ذمم عملاء مفتوحة", value: snapshot.commercial.outstandingAr, href: "/finance/receivables" },
          { key: "ar-od", label: "فواتير عملاء متأخرة", value: snapshot.commercial.overdueAr, href: "/finance/receivables" },
          { key: "ap-od", label: "فواتير موردين متأخرة", value: snapshot.commercial.overdueAp, href: "/finance/supplier-invoices" },
          { key: "val", label: "مستخلصات معلّقة", value: snapshot.commercial.pendingValuations, href: "/finance/client-valuations" },
          { key: "var", label: "أوامر تغيير مفتوحة", value: snapshot.commercial.openVariations, href: "/finance/variations" },
        ]
      : []),
    ...(sections.payroll && snapshot.payroll
      ? [
          { key: "pr-rev", label: "مسيرات للمراجعة", value: snapshot.payroll.underReview, href: "/payroll" },
          { key: "pr-appr", label: "معتمدة بانتظار القفل", value: snapshot.payroll.approvedAwaitingLock, href: "/payroll" },
          { key: "pr-unpaid", label: "مقفلة غير مصروفة", value: snapshot.payroll.lockedUnpaidEntries, href: "/payroll" },
        ]
      : []),
  ];

  return (
    <PageContainer data-testid="management-finance" className="space-y-5">
      <PageHeader
        title="ذكاء المالية"
        description="عدادات حالات فقط — المبالغ التفصيلية في الشاشات التشغيلية"
      />
      <ManagementNav pathname="/management/finance" />
      <MetricGrid metrics={metrics} />
      <Card className="mt-6 text-sm text-muted">
        المبالغ والقيم التعاقدية تُعرض عبر{" "}
        <Link href="/finance" className="text-navy underline">
          المالية
        </Link>{" "}
        و{" "}
        <Link href="/payroll" className="text-navy underline">
          الرواتب
        </Link>{" "}
        وفق صلاحياتك المالية.
      </Card>
    </PageContainer>
  );
}
