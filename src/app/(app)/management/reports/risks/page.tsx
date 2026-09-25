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
import { buildRiskReport } from "@/modules/management/reports/builders";
import { filterFindings } from "@/modules/management/risk/engine";
import type { ManagementRiskCategory, ManagementRiskSeverity } from "@/modules/management/types";

type SearchParams = Promise<{ severity?: string; category?: string }>;

export default async function RisksReportPage({ searchParams }: { searchParams?: SearchParams }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const sp = searchParams ? await searchParams : {};
  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const { risks } = await new ManagementRepository(supabase).loadRiskFindings(
    ctx.organization.id,
    sections,
  );
  const filtered = filterFindings(risks, {
    severity: sp.severity ?? null,
    category: sp.category ?? null,
  });
  const context = createReportContext(ctx, sections);
  const report = buildRiskReport({ context, findings: filtered });

  const severityMetrics = (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as ManagementRiskSeverity[]).map(
    (s) => ({
      key: `sev-${s}`,
      labelAr: s,
      labelEn: s,
      value: report.bySeverity[s],
      href: `/management/reports/risks?severity=${s}`,
    }),
  );

  return (
    <div data-testid="management-report-risks">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome
        title="سجل المخاطر"
        context={report.context}
        csvHref="/management/reports/risks/export.csv"
      >
        <div className="mb-6">
          <ReportMetricGrid
            metrics={[
              {
                key: "total",
                labelAr: "إجمالي النتائج",
                labelEn: "Total findings",
                value: report.total,
              },
              ...severityMetrics,
            ]}
          />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        {(Object.keys(report.byCategory) as ManagementRiskCategory[]).length > 0 ? (
          <p className="mb-4 text-sm text-muted">
            الفئات:{" "}
            {Object.entries(report.byCategory)
              .map(([k, v]) => `${k}=${v}`)
              .join(" · ")}
          </p>
        ) : null}
        <ReportRiskSection findings={report.findings} title="النتائج" />
      </ReportChrome>
    </div>
  );
}
