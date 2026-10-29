import { auditActionLabel, auditEntityLabel } from "@/lib/ui/audit-action-labels";
import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Section } from "@/components/ui/primitives";
import { ManagementNav } from "@/components/management/management-nav";
import {
  DecisionBriefView,
  ReportChrome,
  ReportMetricGrid,
  ReportRiskSection,
} from "@/components/management/report-chrome";
import { AttentionList } from "@/components/management/management-widgets";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canViewManagement, resolveManagementSections } from "@/modules/management/access";
import { ManagementRepository } from "@/server/repositories/management.repository";
import { createReportContext } from "@/modules/management/reports/context";
import { buildExecutiveReport } from "@/modules/management/reports/builders";
import { intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function ExecutiveReportPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!canViewManagement(ctx)) redirect("/");

  const { t, locale } = await getI18n();
  const copy = t.management.reports.executive;

  const sections = resolveManagementSections(ctx);
  const supabase = await createServerSupabaseClient();
  const repo = new ManagementRepository(supabase);
  const snapshot = await repo.loadSnapshot(ctx.organization.id, ctx.profile.id, sections);
  const context = createReportContext(ctx, sections);
  const report = buildExecutiveReport({ context, snapshot });

  return (
    <PageContainer data-testid="management-report-executive" className="space-y-5">
      <div className="print:hidden">
        <ManagementNav pathname="/management/reports" />
      </div>
      <ReportChrome title={copy.title} context={report.context}>
        <p className="mb-4 text-sm text-muted">
          {pickLocalized(locale, report.freshnessNoteAr, report.freshnessNoteEn)}
        </p>
        <div className="mb-6">
          <ReportMetricGrid metrics={report.metrics} />
        </div>
        <div className="mb-6">
          <DecisionBriefView sections={report.decisionBrief} />
        </div>
        <div className="mb-6 break-inside-avoid" data-testid="executive-attention">
          <Section title={copy.attention} className="print:shadow-none">
            <AttentionList items={report.attention} />
          </Section>
        </div>
        <ReportRiskSection findings={report.topRisks} title={copy.topRisks} />
        {sections.activity ? (
          <div className="mt-4 break-inside-avoid" data-testid="executive-activity">
            <Section title={copy.activity} className="print:shadow-none">
              {report.activity.length === 0 ? (
                <p className="text-sm text-muted">{copy.activityEmpty}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {report.activity.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <span>
                        <span className="font-medium text-ink">{auditActionLabel(a.action, locale)}</span>
                        <span className="text-muted"> · {auditEntityLabel(a.entityType, locale)}</span>
                      </span>
                      <span className="text-xs tabular-nums text-muted">
                        {new Date(a.createdAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">
                {copy.activityNote}{" "}
                <Link href="/management/activity" className="font-medium text-primary hover:underline print:hidden">
                  {t.management.common.more}
                </Link>
              </p>
            </Section>
          </div>
        ) : null}
      </ReportChrome>
    </PageContainer>
  );
}
