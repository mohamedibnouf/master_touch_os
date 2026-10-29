import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Badge, Card, Section, TableScroll } from "@/components/ui/primitives";
import { PrintReportButton } from "@/components/management/print-report-button";
import { RiskFindingsList, severityLabel, severityTone } from "@/components/management/management-widgets";
import { intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import type { DecisionBriefSection, ManagementReportContext, ReportMetric } from "@/modules/management/reports/types";
import type { RiskFinding } from "@/modules/management/risk/types";

export async function ReportChrome({
  title,
  context,
  csvHref,
  children,
}: {
  title: string;
  context: ManagementReportContext;
  csvHref?: string;
  children: React.ReactNode;
}) {
  const { t, locale } = await getI18n();
  const r = t.management.report;
  const generatedLocal = new Date(context.generatedAt).toLocaleString(intlLocale(locale), {
    timeZone: "Asia/Riyadh",
  });
  const Back = locale === "ar" ? ChevronRight : ChevronLeft;
  const orgPrimary = pickLocalized(locale, context.organizationNameAr, context.organizationNameEn);
  const orgSecondary = locale === "ar" ? context.organizationNameEn : context.organizationNameAr;

  return (
    <div className="management-report" data-testid="management-report">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/management/reports"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-primary"
        >
          <Back className="h-4 w-4" aria-hidden />
          {r.breadcrumb}
        </Link>
        <div className="flex flex-wrap gap-2">
          {csvHref ? (
            <Link
              href={csvHref}
              className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-card hover:border-border-strong hover:bg-surface-muted md:min-h-9"
              data-testid="report-csv-download"
            >
              <Download className="h-4 w-4" aria-hidden />
              {r.exportCsv}
            </Link>
          ) : null}
          <PrintReportButton />
        </div>
      </div>

      <div
        className="mt-surface mb-6 overflow-hidden border-t-4 border-t-primary p-5 md:p-6 print:rounded-none print:border-x-0 print:border-b-2 print:border-t-0 print:border-b-primary print:p-0 print:pb-4 print:shadow-none"
        data-testid="report-header"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{orgPrimary}</p>
            {orgSecondary && orgSecondary !== orgPrimary ? (
              <p className="text-xs text-muted">{orgSecondary}</p>
            ) : null}
          </div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{r.confidential}</p>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink md:text-[1.75rem]">{title}</h1>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <div>
            <dt className="inline">{r.asOf} </dt>
            <dd className="inline font-medium tabular-nums text-ink" data-testid="report-as-of">
              {context.asOfDate}
            </dd>
          </div>
          <div>
            <dt className="inline">{r.generated} </dt>
            <dd className="inline tabular-nums" data-testid="report-generated-at">
              {generatedLocal}
            </dd>
          </div>
        </dl>
      </div>

      {children}
    </div>
  );
}

export async function ReportMetricGrid({ metrics }: { metrics: ReportMetric[] }) {
  const { t, locale } = await getI18n();
  const nf = intlLocale(locale);
  if (metrics.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="report-metrics-empty">
        {t.management.report.metricsEmpty}
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="report-metrics">
      {metrics.map((m) => {
        const value =
          typeof m.value === "number"
            ? m.isMoney
              ? m.value.toLocaleString(nf, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : m.value.toLocaleString(nf)
            : m.value;
        const body = (
          <Card className="h-full break-inside-avoid print:shadow-none">
            <p className="text-xs font-medium text-muted">{pickLocalized(locale, m.labelAr, m.labelEn)}</p>
            <p className="mt-2 text-[1.625rem] font-semibold leading-none tracking-tight tabular-nums text-ink">
              {value}
              {m.isMoney ? (
                <span className="ms-1 text-sm font-medium text-muted">{t.management.common.currency}</span>
              ) : null}
            </p>
          </Card>
        );
        return m.href ? (
          <Link
            key={m.key}
            href={m.href}
            className="block h-full transition-opacity hover:opacity-90"
            data-testid={`report-metric-${m.key}`}
          >
            {body}
          </Link>
        ) : (
          <div key={m.key} className="h-full" data-testid={`report-metric-${m.key}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export async function DecisionBriefView({ sections }: { sections: DecisionBriefSection[] }) {
  const { t, locale } = await getI18n();
  return (
    <Card className="break-inside-avoid border-s-4 border-s-primary print:shadow-none" data-testid="decision-brief">
      <h2 className="mb-4 text-base font-semibold text-ink">{t.management.report.decisionBrief}</h2>
      <div className="grid gap-5 md:grid-cols-2">
        {sections.map((sec) => (
          <div key={sec.id} data-testid={`decision-brief-${sec.id}`} className="break-inside-avoid">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {pickLocalized(locale, sec.titleAr, sec.titleEn)}
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm text-ink">
              {sec.statements.map((st) => {
                const text = pickLocalized(locale, st.textAr, st.textEn);
                return (
                  <li key={st.id} className="flex flex-wrap items-baseline gap-2">
                    {st.severity ? (
                      <Badge tone={severityTone[st.severity] ?? "neutral"}>{severityLabel(t, st.severity)}</Badge>
                    ) : null}
                    {st.href ? (
                      <Link href={st.href} className="text-ink hover:text-primary hover:underline">
                        {text}
                      </Link>
                    ) : (
                      <span>{text}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ReportTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: Array<{ key: string; cells: Array<React.ReactNode>; href?: string }>;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  return (
    <TableScroll data-testid="report-table">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-muted text-start">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-start text-xs font-semibold text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line break-inside-avoid last:border-b-0 hover:bg-surface-muted/60">
              {r.cells.map((cell, i) => (
                <td key={i} className="px-3 py-2 align-top tabular-nums text-ink">
                  {i === 0 && r.href ? (
                    <Link href={r.href} className="font-medium text-ink hover:text-primary hover:underline">
                      {cell}
                    </Link>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export function ReportRiskSection({ findings, title }: { findings: RiskFinding[]; title: string }) {
  return (
    <div data-testid="report-risk-section" className="mt-4">
      <Section title={title} className="print:shadow-none">
        <RiskFindingsList findings={findings} />
      </Section>
    </div>
  );
}
