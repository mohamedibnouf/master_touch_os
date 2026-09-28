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
import { buildPeopleReport } from "@/modules/management/reports/builders";

export default async function PeopleReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  if (!sections.people && !sections.attendanceLeave) redirect("/management/reports");

  const supabase = await createServerSupabaseClient();
  const repo = new ManagementRepository(supabase);
  const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);
  const departmentDistribution = sections.employeeHeadcount
    ? await repo.loadDepartmentDistribution(ctx.organization.id)
    : [];
  const context = createReportContext(ctx, sections);
  const report = buildPeopleReport({ context, snapshot, departmentDistribution });

  return (
    <PageContainer data-testid="management-report-people" className="space-y-5">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome title="الأفراد والحضور" context={report.context}>
        <p className="mb-4 text-sm text-muted" data-testid="people-privacy-note">
          {report.privacyNoteAr}
        </p>
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        {report.departmentDistribution.length > 0 ? (
          <Card className="mb-4 break-inside-avoid">
            <h2 className="mb-3 font-semibold text-navy">توزيع الإدارات (أساسي)</h2>
            <ReportTable
              headers={["الإدارة", "العدد"]}
              empty=""
              rows={report.departmentDistribution.map((d, i) => ({
                key: `${d.nameEn}-${i}`,
                cells: [d.nameAr, d.count],
              }))}
            />
          </Card>
        ) : null}
        <ReportRiskSection findings={report.peopleRisks} title="مخاطر أفراد / امتثال / حضور" />
      </ReportChrome>
    </PageContainer>
  );
}
