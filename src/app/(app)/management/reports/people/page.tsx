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
import { Section } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildPeopleReport } from "@/modules/management/reports/builders";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function PeopleReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  if (!sections.people && !sections.attendanceLeave) redirect("/management/reports");

  const { t, locale } = await getI18n();
  const copy = t.management.reports.people;

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
      <ReportChrome title={copy.title} context={report.context}>
        <p
          className="mb-4 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-sm text-muted"
          data-testid="people-privacy-note"
        >
          {pickLocalized(locale, report.privacyNoteAr, report.privacyNoteEn)}
        </p>
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        {report.departmentDistribution.length > 0 ? (
          <div className="mb-4 break-inside-avoid">
            <Section title={copy.departments} className="print:shadow-none">
              <ReportTable
                headers={[copy.colDepartment, copy.colCount]}
                empty=""
                rows={report.departmentDistribution.map((d, i) => ({
                  key: `${d.nameEn}-${i}`,
                  cells: [pickLocalized(locale, d.nameAr, d.nameEn), d.count],
                }))}
              />
            </Section>
          </div>
        ) : null}
        <ReportRiskSection findings={report.peopleRisks} title={copy.risks} />
      </ReportChrome>
    </PageContainer>
  );
}
