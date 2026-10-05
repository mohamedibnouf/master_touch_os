"use client";

import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiSparkle } from "@/components/ai/ai-chrome";
import { refreshManagementInsightsAction } from "@/server/use-cases/ai-platform";
import type { ManagementInsight } from "@/modules/ai/schemas";
import type { ManagementInsightFacts } from "@/modules/ai/schemas";

export function ManagementAiInsights({
  enabled,
  initialFacts,
}: {
  enabled: boolean;
  initialFacts: ManagementInsightFacts;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [insight, setInsight] = useState<ManagementInsight | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  function refresh() {
    setError(null);
    startTransition(async () => {
      const res = await refreshManagementInsightsAction({ refresh: true });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInsight(res.data.insight);
      setUpdatedAt(res.data.insight.generated_at);
    });
  }

  return (
    <Card className="border-primary/15" data-testid="management-ai-insights">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AiSparkle />
          <h2 className="text-sm font-semibold text-ink">رؤى الذكاء الاصطناعي</h2>
        </div>
        <Button type="button" variant="outline" disabled={!enabled || pending} onClick={refresh}>
          تحديث التحليل
        </Button>
      </div>
      <ul className="grid gap-2 text-sm sm:grid-cols-3">
        <li className="rounded-lg bg-surface-muted px-3 py-2">
          {initialFacts.followUpProjects} مشاريع تحتاج متابعة
        </li>
        <li className="rounded-lg bg-surface-muted px-3 py-2">{initialFacts.overdueStages} مراحل متأخرة</li>
        <li className="rounded-lg bg-surface-muted px-3 py-2">{initialFacts.pendingApprovals} موافقات معلقة</li>
      </ul>
      {insight ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-medium">{insight.headline_ar}</p>
          {insight.items.map((item) => (
            <p key={item.title_ar} className="text-muted">
              {item.explanation_ar}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">اضغط تحديث التحليل لشرح الإشارات أعلاه.</p>
      )}
      {updatedAt ? <p className="mt-2 text-xs text-muted">آخر تحديث: {updatedAt}</p> : null}
      {pending ? <p className="mt-2 text-sm text-muted">جاري تحليل بيانات الإدارة...</p> : null}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {!enabled ? <p className="mt-2 text-sm text-muted">خدمة التحليل الذكي غير مفعلة حالياً.</p> : null}
      <AiDisclaimer className="mt-3 text-xs text-muted" />
    </Card>
  );
}
