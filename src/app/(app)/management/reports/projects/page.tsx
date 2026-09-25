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
import { buildProjectReport } from "@/modules/management/reports/builders";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";

export default async function ProjectsReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  if (!sections.projects) redirect("/management/reports");

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
    <div data-testid="management-report-projects">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome
        title="محفظة المشاريع"
        context={report.context}
        csvHref="/management/reports/projects/export.csv"
      >
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        <Card className="mb-4 break-inside-avoid">
          <h2 className="mb-3 font-semibold text-navy">تجاوزت تاريخ الانتهاء المخطط</h2>
          <ReportTable
            headers={["المشروع", "الحالة", "المخطط", "أيام التجاوز"]}
            empty="لا توجد مشاريع متجاوزة ضمن المرشحين المحدودين."
            rows={report.overdueProjects.map((p) => ({
              key: p.id,
              href: p.href,
              cells: [p.projectCode, p.status, p.plannedEndDate, p.overdueDays],
            }))}
          />
        </Card>
        <Card className="mb-4 break-inside-avoid">
          <h2 className="mb-3 font-semibold text-navy">مخاطر معلنة (risk_level)</h2>
          <ReportTable
            headers={["المشروع", "المستوى"]}
            empty="لا توجد مشاريع بمستوى مخاطر high/critical ضمن المرشحين."
            rows={report.declaredHighRisk.map((p) => ({
              key: p.id,
              href: p.href,
              cells: [`${p.projectCode} — ${p.nameAr}`, p.riskLevel],
            }))}
          />
        </Card>
        {report.risksByProject.map((g) => (
          <ReportRiskSection
            key={g.projectId}
            title={`مخاطر: ${g.projectLabel}`}
            findings={g.findings}
          />
        ))}
      </ReportChrome>
    </div>
  );
}
