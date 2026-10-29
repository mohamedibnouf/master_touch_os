import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import {
  DecisionBriefView,
  ReportChrome,
  ReportMetricGrid,
  ReportRiskSection,
} from "@/components/management/report-chrome";
import { categoryLabel } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildRiskReport } from "@/modules/management/reports/builders";
import { filterFindings } from "@/modules/management/risk/engine";
import type { ManagementRiskCategory, ManagementRiskSeverity } from "@/modules/management/types";
import { ar } from "@/lib/i18n/dictionaries/ar";
import { en } from "@/lib/i18n/dictionaries/en";
import { getI18n } from "@/lib/i18n/server";

type SearchParams = Promise<{ severity?: string; category?: string }>;

export default async function RisksReportPage({ searchParams }: { searchParams?: SearchParams }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const { t } = await getI18n();
  const copy = t.management.reports.risks;

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
      labelAr: ar.management.severity[s],
      labelEn: en.management.severity[s],
      value: report.bySeverity[s],
      href: `/management/reports/risks?severity=${s}`,
    }),
  );

  const categoryEntries = Object.entries(report.byCategory) as Array<[ManagementRiskCategory, number]>;

  return (
    <PageContainer data-testid="management-report-risks" className="space-y-5">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome
        title={copy.title}
        context={report.context}
        csvHref="/management/reports/risks/export.csv"
      >
        <div className="mb-6">
          <ReportMetricGrid
            metrics={[
              {
                key: "total",
                labelAr: ar.management.reports.risks.totalFindings,
                labelEn: en.management.reports.risks.totalFindings,
                value: report.total,
              },
              ...severityMetrics,
            ]}
          />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        {categoryEntries.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-medium">{copy.categories}</span>
            {categoryEntries.map(([k, v]) => (
              <Badge key={k} tone="neutral">
                {categoryLabel(t, k)} <span className="tabular-nums">{v}</span>
              </Badge>
            ))}
          </div>
        ) : null}
        <ReportRiskSection findings={report.findings} title={copy.findings} />
      </ReportChrome>
    </PageContainer>
  );
}
