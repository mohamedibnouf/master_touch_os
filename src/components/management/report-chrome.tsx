import Link from "next/link";
import { Badge, Card } from "@/components/ui/primitives";
import { PrintReportButton } from "@/components/management/print-report-button";
import { RiskFindingsList } from "@/components/management/management-widgets";
import type { DecisionBriefSection, ManagementReportContext, ReportMetric } from "@/modules/management/reports/types";
import type { RiskFinding } from "@/modules/management/risk/types";

export function ReportChrome({
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
  const generatedLocal = new Date(context.generatedAt).toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
  });

  return (
    <div className="management-report" data-testid="management-report">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            <Link href="/management/reports" className="text-navy underline">
              التقارير
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {csvHref ? (
            <Link
              href={csvHref}
              className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-navy"
              data-testid="report-csv-download"
            >
              تصدير CSV
            </Link>
          ) : null}
          <PrintReportButton />
        </div>
      </div>

      <header className="mb-6 border-b-2 border-navy pb-4" data-testid="report-header">
        <p className="text-sm font-medium text-navy">{context.organizationNameAr}</p>
        <p className="text-xs text-muted">{context.organizationNameEn}</p>
        <h1 className="mt-2 text-2xl font-bold text-navy">{title}</h1>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          <div>
            <dt className="inline">كما في: </dt>
            <dd className="inline tabular-nums" data-testid="report-as-of">
              {context.asOfDate}
            </dd>
          </div>
          <div>
            <dt className="inline">أُنشئ: </dt>
            <dd className="inline tabular-nums" data-testid="report-generated-at">
              {generatedLocal}
            </dd>
          </div>
        </dl>
      </header>

      {children}
    </div>
  );
}

export function ReportMetricGrid({ metrics }: { metrics: ReportMetric[] }) {
  if (metrics.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="report-metrics-empty">
        لا توجد مقاييس متاحة حسب صلاحياتك.
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="report-metrics">
      {metrics.map((m) => {
        const body = (
          <Card className="h-full break-inside-avoid">
            <p className="text-sm text-muted">{m.labelAr}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-navy">
              {m.isMoney && typeof m.value === "number"
                ? m.value.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : m.value}
              {m.isMoney ? " SAR" : ""}
            </p>
          </Card>
        );
        return m.href ? (
          <Link key={m.key} href={m.href} className="block" data-testid={`report-metric-${m.key}`}>
            {body}
          </Link>
        ) : (
          <div key={m.key} data-testid={`report-metric-${m.key}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function DecisionBriefView({ sections }: { sections: DecisionBriefSection[] }) {
  return (
    <Card className="break-inside-avoid" data-testid="decision-brief">
      <h2 className="mb-3 font-semibold text-navy">موجز القرار (حتمي)</h2>
      <div className="space-y-4">
        {sections.map((sec) => (
          <div key={sec.id} data-testid={`decision-brief-${sec.id}`}>
            <h3 className="text-sm font-semibold text-navy">{sec.titleAr}</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {sec.statements.map((st) => (
                <li key={st.id} className="flex flex-wrap items-baseline gap-2">
                  {st.severity ? <Badge tone={st.severity === "LOW" ? "neutral" : "danger"}>{st.severity}</Badge> : null}
                  {st.href ? (
                    <Link href={st.href} className="text-navy underline">
                      {st.textAr}
                    </Link>
                  ) : (
                    <span>{st.textAr}</span>
                  )}
                </li>
              ))}
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
    <div className="table-scroll overflow-x-auto" data-testid="report-table">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-right">
            {headers.map((h) => (
              <th key={h} className="px-2 py-2 font-semibold text-navy">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line break-inside-avoid">
              {r.cells.map((cell, i) => (
                <td key={i} className="px-2 py-2 align-top">
                  {i === 0 && r.href ? (
                    <Link href={r.href} className="text-navy underline">
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
    </div>
  );
}

export function ReportRiskSection({ findings, title }: { findings: RiskFinding[]; title: string }) {
  return (
    <Card className="mt-4" data-testid="report-risk-section">
      <h2 className="mb-3 font-semibold text-navy">{title}</h2>
      <RiskFindingsList findings={findings} />
    </Card>
  );
}
