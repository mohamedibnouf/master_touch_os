import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { ManagementNav } from "@/components/management/management-nav";
import {
  DecisionBriefView,
  ReportChrome,
  ReportMetricGrid,
  ReportRiskSection,
  ReportTable,
} from "@/components/management/report-chrome";
import { Card } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildOperationsReport } from "@/modules/management/reports/builders";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";

export default async function OperationsReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  if (!sections.approvals && !sections.procurement) redirect("/management/reports");

  const supabase = await createServerSupabaseClient();
  const repo = new ManagementRepository(supabase);
  const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);
  const today = riyadhTodayYmd();
  const riskInput = await repo.loadRiskInputSnapshot(
    ctx.organization.id,
    sections,
    today,
    new Date().toISOString(),
  );
  const context = createReportContext(ctx, sections);
  const report = buildOperationsReport({ context, snapshot, riskInput });

  return (
    <PageContainer data-testid="management-report-operations" className="space-y-5">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome
        title="العمليات والموافقات"
        context={report.context}
        csvHref="/management/reports/operations/export.csv"
      >
        <p className="mb-4 text-sm text-muted">
          أعمار الانتباه إداريّة موثّقة — ليست مخالفات SLA تعاقدية.
        </p>
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        <Card className="mb-4 break-inside-avoid">
          <h2 className="mb-3 font-semibold text-navy">أقدم الموافقات المفتوحة</h2>
          <ReportTable
            headers={["الطلب", "الحالة", "أيام مفتوح"]}
            empty="لا توجد موافقات مفتوحة ضمن المرشحين."
            rows={report.oldestApprovals.map((a) => ({
              key: a.id,
              href: a.href,
              cells: [a.title, a.status, a.openDays],
            }))}
          />
        </Card>
        <ReportRiskSection findings={report.operationalRisks} title="مخاطر تشغيلية / موافقات" />
      </ReportChrome>
    </PageContainer>
  );
}
