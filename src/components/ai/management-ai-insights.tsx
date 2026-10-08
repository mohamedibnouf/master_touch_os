"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiSparkle } from "@/components/ai/ai-chrome";
import { refreshManagementInsightsAction } from "@/server/use-cases/ai-platform";
import type { ManagementInsight } from "@/modules/ai/schemas";
import type { ExecutiveIntelligenceFacts, ExecutiveMetric } from "@/modules/ai/executive-intelligence/types";
import { DonutChart, HorizontalBarList } from "@/components/charts/semantic-charts";

function formatMetric(metric: ExecutiveMetric): string {
  if (metric.value == null || metric.availability === "NOT_AVAILABLE") return "غير متاح";
  if (metric.unit === "percent") return `${metric.value}%`;
  if (metric.unit === "days") return `${metric.value} ي`;
  return String(metric.value);
}

const PRIORITY_AR: Record<string, string> = {
  critical: "حرج",
  high: "عالٍ",
  medium: "متوسط",
  low: "منخفض",
};

export function ManagementAiInsights({
  enabled,
  facts,
}: {
  enabled: boolean;
  facts: ExecutiveIntelligenceFacts;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [insight, setInsight] = useState<ManagementInsight | null>(null);

  function refresh() {
    setError(null);
    startTransition(async () => {
      const res = await refreshManagementInsightsAction({ refresh: true });
      if (!res.ok) {
        setError(res.error);
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
  const kpis = facts.metrics.filter((m) => kpiKeys.includes(m.key));
  const overdue = facts.metrics.find((m) => m.key === "projects.overdue_planned_end");
  const tracked = overdue?.denominator ?? 0;
  const overdueCount = overdue?.value ?? 0;
  const onTrack = Math.max(0, tracked - (typeof overdueCount === "number" ? overdueCount : 0));
  const pct = facts.metrics.find((m) => m.key === "projects.overdue_percent");

  return (
    <Card className="border-primary/15" data-testid="management-ai-insights" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AiSparkle />
          <div>
            <h2 className="text-sm font-semibold text-ink">تقرير الذكاء التنفيذي</h2>
            <p className="text-xs text-muted">مقاييس حتمية بتاريخ {facts.dataAsOf} (آسيا/الرياض)</p>
          </div>
        </div>
        <Button type="button" variant="outline" disabled={!enabled || pending} onClick={refresh}>
          تحديث التحليل
        </Button>
      </div>

      <section className="mb-4">
        <h3 className="text-sm font-semibold text-ink">الملخص التنفيذي التشغيلي</h3>
        <p className="mt-1 text-sm text-ink">{facts.operationalSummaryAr}</p>
      </section>

      {kpis.length ? (
        <ul className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((kpi) => (
            <li key={kpi.key} className="rounded-lg bg-primary/5 px-3 py-2">
              <p className="text-xs text-muted">{kpi.labelAr}</p>
              <p className="text-lg font-semibold text-ink">{formatMetric(kpi)}</p>
              {kpi.availability === "PARTIAL" ? <p className="text-[11px] text-muted">جزئي</p> : null}
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
              title="صحة محفظة التواريخ المخططة"
              segments={[
                { label: "متجاوزة", value: overdueCount, tone: "danger" },
                { label: "ضمن المخطط", value: onTrack, tone: "success" },
              ]}
              centerValue={pct?.value == null ? "—" : `${pct.value}%`}
              centerLabel="نسبة التجاوز"
            />
          </div>
        ) : null}
        {facts.progressSample.length ? (
          <div className="min-w-0 lg:col-span-7">
            <HorizontalBarList title="تقدم العينة (جزئي)" rows={facts.progressSample.map((row) => ({
              id: row.id,
              label: row.nameAr,
              href: row.href,
              percent: row.percent,
              hint: row.hint,
            }))} />
          </div>
        ) : null}
        <div className="min-w-0 lg:col-span-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">المشاريع المتأخرة</h3>
          {facts.delayedProjects.length === 0 ? (
            <p className="text-sm text-muted">لا توجد مشاريع متجاوزة للتاريخ المخطط في العينة.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {facts.delayedProjects.map((p) => (
                <li key={p.id}>
                  <Link href={p.href} className="text-primary hover:underline">
                    {p.projectCode} — {p.nameAr}
                  </Link>
                  <span className="text-muted"> ({p.overdueDays ?? 0} يوم)</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {facts.pendingApprovalRows.length ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">موافقات معلّقة</h3>
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
            <h3 className="text-sm font-semibold text-ink">الملخص التنفيذي</h3>
            <p className="mt-1 text-sm text-ink">{insight.executive_summary_ar}</p>
          </div>
          {insight.observations.length ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">ملاحظات مبنية على الدليل</h3>
              <ul className="mt-1 space-y-1 text-sm text-muted">
                {insight.observations.map((row) => (
                  <li key={`${row.issue_key}:${row.evidence_ref ?? ""}`}>{row.title_ar}: {row.explanation_ar}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {insight.recommendations.length ? (
            <div>
              <h3 className="text-sm font-semibold text-ink">توصيات إدارية (استشارية)</h3>
              <ul className="mt-2 space-y-2">
                {insight.recommendations.map((row) => (
                  <li key={`${row.record_ref}-${row.problem_ar}`} className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
                    <p className="font-medium text-ink">
                      {PRIORITY_AR[row.priority] ?? row.priority} — {row.problem_ar}
                    </p>
                    <p className="text-muted">الدليل: {row.evidence_ar}</p>
                    <p className="text-muted">الأثر: {row.impact_ar}</p>
                    <p className="text-ink">{row.action_ar}</p>
                    <p className="text-xs text-muted">
                      {row.owner_role_ar ? `الدور المقترح: ${row.owner_role_ar}` : "بدون تعيين نظامي"}
                      {row.timeframe_ar ? ` · إطار مقترح: ${row.timeframe_ar}` : ""}
                    </p>
                    {row.href ? (
                      <Link href={row.href} className="text-xs text-primary hover:underline">
                        فتح السجل
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">المقاييس أعلاه جاهزة. اضغط تحديث التحليل للحصول على شرح تنفيذي استشاري.</p>
      )}

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">حداثة البيانات والقيود</summary>
        <ul className="mt-1 list-disc pe-4">
          {facts.limitationsAr.map((line) => (
            <li key={line}>{line}</li>
          ))}
          {insight?.limitations_ar ? <li>{insight.limitations_ar}</li> : null}
        </ul>
      </details>

      {pending ? <p className="mt-2 text-sm text-muted">جاري إعداد التحليل التنفيذي...</p> : null}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {!enabled ? <p className="mt-2 text-sm text-muted">خدمة التحليل الذكي غير مفعلة حالياً. المقاييس الحتمية تبقى ظاهرة.</p> : null}
      <AiDisclaimer className="mt-3 text-xs text-muted" />
    </Card>
  );
}
