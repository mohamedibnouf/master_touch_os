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
import { Badge, Section } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildProjectReport } from "@/modules/management/reports/builders";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import {
  projectRiskLabel,
  projectRiskTone,
  projectStatusLabel,
  projectStatusTone,
} from "@/lib/ui/operational-labels";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function ProjectsReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  if (!sections.projects) redirect("/management/reports");

  const { t, locale } = await getI18n();
  const copy = t.management.reports.projects;

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
  const report = buildProjectReport({ context, snapshot, riskInput });

  return (
    <PageContainer data-testid="management-report-projects" className="space-y-5">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome
        title={copy.title}
        context={report.context}
        csvHref="/management/reports/projects/export.csv"
      >
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        <div className="mb-4 break-inside-avoid">
          <Section title={copy.overdueTitle} className="print:shadow-none">
            <ReportTable
              headers={[copy.colProject, copy.colStatus, copy.colPlanned, copy.colOverdueDays]}
              empty={copy.overdueEmpty}
              rows={report.overdueProjects.map((p) => ({
                key: p.id,
                href: p.href,
                cells: [
                  p.projectCode,
                  <Badge key="status" tone={projectStatusTone(p.status)}>
                    {projectStatusLabel(p.status, locale)}
                  </Badge>,
                  p.plannedEndDate,
                  <span key="days" className="font-semibold text-danger">
                    {p.overdueDays}
                  </span>,
                ],
              }))}
            />
          </Section>
        </div>
        <div className="mb-4 break-inside-avoid">
          <Section title={copy.declaredTitle} className="print:shadow-none">
            <ReportTable
              headers={[copy.colProject, copy.colLevel]}
              empty={copy.declaredEmpty}
              rows={report.declaredHighRisk.map((p) => ({
                key: p.id,
                href: p.href,
                cells: [
                  `${p.projectCode} — ${p.nameAr}`,
                  <Badge key="risk" tone={projectRiskTone(p.riskLevel)}>
                    {projectRiskLabel(p.riskLevel, locale)}
                  </Badge>,
                ],
              }))}
            />
          </Section>
        </div>
        {report.risksByProject.map((g) => (
          <ReportRiskSection
            key={g.projectId}
            title={format(copy.projectRisks, { project: g.projectLabel })}
            findings={g.findings}
          />
        ))}
      </ReportChrome>
    </PageContainer>
  );
}
