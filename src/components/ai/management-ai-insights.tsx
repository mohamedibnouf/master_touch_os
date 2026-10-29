"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiHeading } from "@/components/ai/ai-chrome";
import { refreshManagementInsightsAction } from "@/server/use-cases/ai-platform";
import { aiClientErrorMessage } from "@/modules/ai/errors";
import type { ManagementInsight } from "@/modules/ai/schemas";
import type { ExecutiveIntelligenceFacts, ExecutiveMetric } from "@/modules/ai/executive-intelligence/types";
import { DonutChart, HorizontalBarList } from "@/components/charts/semantic-charts";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";

type ManagementCopy = Dictionary["ai"]["management"];

function formatMetric(metric: ExecutiveMetric, m: ManagementCopy): string {
  if (metric.value == null || metric.availability === "NOT_AVAILABLE") return m.notAvailable;
  if (metric.unit === "percent") return `${metric.value}%`;
  if (metric.unit === "days") return format(m.daysShort, { value: metric.value });
  return String(metric.value);
}

/**
 * English rendering of the deterministic operational summary, mirroring the rules in
 * facts-builder (which keeps the Arabic text because it is also fed to the model).
 */
function operationalSummaryEn(facts: ExecutiveIntelligenceFacts, m: ManagementCopy): string {
  const pick = (key: string) => facts.metrics.find((x) => x.key === key);
  const reliable = (x: ExecutiveMetric | undefined) => x?.value != null && x.availability === "AVAILABLE_AND_RELIABLE";
  const shown = (x: ExecutiveMetric | undefined) => x?.value != null && x.availability !== "NOT_AVAILABLE";
  const parts = [format(m.summaryAsOf, { date: facts.dataAsOf })];
  const active = pick("projects.active");
  const overdue = pick("projects.overdue_planned_end");
  const pct = pick("projects.overdue_percent");
  const stages = pick("workflow.overdue_stages");
  const pending = pick("approvals.pending");
  if (reliable(active)) parts.push(format(m.summaryActive, { count: active!.value! }));
  if (reliable(overdue)) parts.push(format(m.summaryOverdue, { count: overdue!.value! }));
  if (reliable(pct)) parts.push(format(m.summaryOverduePercent, { value: pct!.value! }));
  if (shown(stages)) parts.push(format(m.summaryOverdueStages, { count: stages!.value! }));
  if (shown(pending)) parts.push(format(m.summaryPendingApprovals, { count: pending!.value! }));
  return `${parts.join(" — ")}. ${m.summaryFootnote}`;
}

export function ManagementAiInsights({
  enabled,
  facts,
}: {
  enabled: boolean;
  facts: ExecutiveIntelligenceFacts;
}) {
  const { t, locale } = useI18n();
  const m = t.ai.management;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [insight, setInsight] = useState<ManagementInsight | null>(null);

  function refresh() {
    setError(null);
    startTransition(async () => {
      const res = await refreshManagementInsightsAction({ refresh: true });
      if (!res.ok) {
        setError(locale === "en" ? (aiClientErrorMessage(res.code, locale) ?? res.error) : res.error);
        return;
      }
      setInsight(res.data.insight);
    });
  }

  const kpiKeys = [
    "projects.active",
    "projects.overdue_planned_end",
    "projects.overdue_percent",
    "workflow.overdue_stages",
    "approvals.pending",
    "workflow.avg_progress_sample",
    "people.active_employees",
  ];
  const kpis = facts.metrics.filter((x) => kpiKeys.includes(x.key));
  const overdue = facts.metrics.find((x) => x.key === "projects.overdue_planned_end");
  const tracked = overdue?.denominator ?? 0;
  const overdueCount = overdue?.value ?? 0;
  const onTrack = Math.max(0, tracked - (typeof overdueCount === "number" ? overdueCount : 0));
  const pct = facts.metrics.find((x) => x.key === "projects.overdue_percent");
  const metricLabel = (metric: ExecutiveMetric) => (locale === "en" ? m.metrics[metric.key.replace(/\./g, "_")] : null) ?? metric.labelAr;
  const summary = locale === "en" ? operationalSummaryEn(facts, m) : facts.operationalSummaryAr;

  return (
    <Card className="border-primary/15" data-testid="management-ai-insights">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <AiHeading title={m.title} subtitle={format(m.asOf, { date: facts.dataAsOf })} />
        <Button type="button" variant="outline" disabled={!enabled || pending} onClick={refresh}>
          {m.refresh}
        </Button>
      </div>

      <section className="mb-4 rounded-lg bg-surface-muted px-3 py-2.5">
        <h3 className="text-xs font-semibold text-muted">{m.operationalSummary}</h3>
        <p className="mt-1 text-sm leading-6 text-ink">{summary}</p>
      </section>

      {kpis.length ? (
        <ul className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((kpi) => (
            <li key={kpi.key} className="rounded-lg border border-line bg-primary-soft/60 px-3 py-2">
              <p className="text-xs text-muted">{metricLabel(kpi)}</p>
              <p className="text-lg font-semibold tabular-nums text-ink">{formatMetric(kpi, m)}</p>
              {kpi.availability === "PARTIAL" ? <p className="text-[11px] text-muted">{m.partial}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        {pct?.availability === "AVAILABLE_AND_RELIABLE" &&
        overdue?.availability === "AVAILABLE_AND_RELIABLE" &&
        tracked > 0 &&
        typeof overdueCount === "number" ? (
          <div className="min-w-0 lg:col-span-5">
            <DonutChart
              title={m.donutTitle}
              segments={[
                { label: m.donutOverdue, value: overdueCount, tone: "danger" },
                { label: m.donutOnTrack, value: onTrack, tone: "success" },
              ]}
              centerValue={pct?.value == null ? "—" : `${pct.value}%`}
              centerLabel={m.donutCenter}
            />
          </div>
        ) : null}
        {facts.progressSample.length ? (
          <div className="min-w-0 lg:col-span-7">
            <HorizontalBarList title={m.progressSample} rows={facts.progressSample.map((row) => ({
              id: row.id,
              label: row.nameAr,
              href: row.href,
              percent: row.percent,
              hint: row.hint,
            }))} />
          </div>
        ) : null}
        <div className="min-w-0 lg:col-span-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">{m.delayedProjects}</h3>
          {facts.delayedProjects.length === 0 ? (
            <p className="text-sm text-muted">{m.noDelayed}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {facts.delayedProjects.map((p) => (
                <li key={p.id}>
                  <Link href={p.href} className="text-primary hover:underline">
                    {p.projectCode} — {p.nameAr}
                  </Link>
                  <span className="text-muted"> {format(m.overdueDays, { days: p.overdueDays ?? 0 })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {facts.pendingApprovalRows.length ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">{m.pendingApprovals}</h3>
          <ul className="space-y-1 text-sm text-muted">
            {facts.pendingApprovalRows.map((row) => (
              <li key={row.id}>
                <Link href={row.href} className="text-primary hover:underline">
                  {row.titleAr}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insight ? (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">{m.executiveSummary}</h3>
            <p className="mt-1 text-sm leading-6 text-ink">{insight.executive_summary_ar}</p>
          </div>
          {insight.observations.length ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">{m.observations}</h3>
              <ul className="mt-1 space-y-1 text-sm text-muted">
                {insight.observations.map((row) => (
                  <li key={`${row.issue_key}:${row.evidence_ref ?? ""}`}>{row.title_ar}: {row.explanation_ar}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {insight.recommendations.length ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">{m.recommendations}</h3>
              <ul className="mt-2 space-y-2">
                {insight.recommendations.map((row) => (
                  <li
                    key={`${row.record_ref}-${row.problem_ar}`}
                    className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm"
                  >
                    <p className="font-medium text-ink">
                      {m.priority[row.priority] ?? row.priority} — {row.problem_ar}
                    </p>
                    <p className="text-muted">{format(m.evidence, { value: row.evidence_ar })}</p>
                    <p className="text-muted">{format(m.impact, { value: row.impact_ar })}</p>
                    <p className="text-ink">{row.action_ar}</p>
                    <p className="text-xs text-muted">
                      {row.owner_role_ar ? format(m.suggestedRole, { value: row.owner_role_ar }) : m.noAssignment}
                      {row.timeframe_ar ? ` · ${format(m.suggestedTimeframe, { value: row.timeframe_ar })}` : ""}
                    </p>
                    {row.href ? (
                      <Link href={row.href} className="text-xs text-primary hover:underline">
                        {m.openRecord}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{m.idleHint}</p>
      )}

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">{m.limitations}</summary>
        <ul className="mt-1 list-disc ps-4">
          {facts.limitationsAr.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {insight?.limitations_ar ? <li>{insight.limitations_ar}</li> : null}
        </ul>
      </details>

      {pending ? (
        <p className="mt-2 text-sm text-muted" aria-live="polite">
          {m.preparing}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!enabled ? <p className="mt-2 text-sm text-muted">{m.disabledNote}</p> : null}
      <AiDisclaimer className="mt-3" />
    </Card>
  );
}
