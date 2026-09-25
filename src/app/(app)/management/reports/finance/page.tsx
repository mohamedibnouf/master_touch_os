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
import { buildFinanceReport } from "@/modules/management/reports/builders";

export default async function FinanceReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const snapshot = await new ManagementRepository(supabase).loadSnapshot(
    ctx.organization.id,
    ctx.profile.id,
    sections,
  );
  const context = createReportContext(ctx, sections);
  const report = buildFinanceReport({ context, snapshot });

  return (
    <div data-testid="management-report-finance">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome title="التجاري / المالي" context={report.context}>
        {report.redactionNoteAr ? (
          <p className="mb-4 text-sm text-muted" data-testid="finance-redaction-note">
            {report.redactionNoteAr}
          </p>
        ) : null}
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        <ReportRiskSection findings={report.commercialRisks} title="مخاطر تجارية" />
      </ReportChrome>
    </div>
  );
}
