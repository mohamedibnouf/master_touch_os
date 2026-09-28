import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { ManagementNav } from "@/components/management/management-nav";
import {
  DecisionBriefView,
  ReportChrome,
  ReportMetricGrid,
  ReportRiskSection,
} from "@/components/management/report-chrome";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildPayrollReport } from "@/modules/management/reports/builders";

export default async function PayrollReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  if (!sections.payroll) redirect("/management/reports");

  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    sections,
  );
  const context = createReportContext(ctx, sections);
  const report = buildPayrollReport({ context, snapshot });

  return (
    <PageContainer data-testid="management-report-payroll" className="space-y-5">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome title="حالة المسير" context={report.context}>
        {report.redactionNoteAr ? (
          <p className="mb-4 text-sm text-muted" data-testid="payroll-redaction-note">
            {report.redactionNoteAr}
          </p>
        ) : null}
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        <ReportRiskSection findings={report.payrollRisks} title="مخاطر المسير" />
      </ReportChrome>
    </PageContainer>
  );
}
