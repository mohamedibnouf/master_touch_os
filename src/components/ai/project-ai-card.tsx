"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiSparkle } from "@/components/ai/ai-chrome";
import { analyzeProjectIntelligenceAction } from "@/server/use-cases/ai-platform";
import { healthLabelAr } from "@/modules/ai/health";
import type { ProjectIntelligenceView } from "@/modules/ai/schemas";

function healthTone(health: string): "success" | "warning" | "danger" | "info" {
  if (health === "healthy") return "success";
  if (health === "attention") return "warning";
  if (health === "at_risk") return "danger";
  return "danger";
}

export function ProjectAiCard({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ProjectIntelligenceView | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);

  function run(refresh = false) {
    setError(null);
    startTransition(async () => {
      const res = await analyzeProjectIntelligenceAction({ projectId, refresh });
      if (!res.ok) {
        setView(null);
        setError(res.error);
        return;
      }
      setView(res.data);
    });
  }

  return (
    <Card className="border-primary/15 bg-[color-mix(in_srgb,var(--info-soft)_55%,white)]" data-testid="project-ai-card">
      <div className="mb-2 flex items-center gap-2">
        <AiSparkle />
        <h2 className="text-sm font-semibold text-ink">رؤية ذكية</h2>
      </div>
      {!enabled ? (
        <p className="text-sm text-muted">خدمة التحليل الذكي غير مفعلة حالياً.</p>
      ) : view ? (
        <>
          <p className="text-sm text-ink">
            حالة المشروع:{" "}
            <Badge tone={healthTone(view.health)}>{healthLabelAr(view.health)}</Badge>
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">{view.intelligence.summary_ar}</p>
          <p className="mt-1 text-xs text-muted">
            تم الإنشاء في: {new Date(view.generatedAt).toLocaleString("ar-SA")}
            {view.cached ? " · نسخة محفوظة" : ""}
          </p>
          <button
            type="button"
            className="mt-2 text-xs text-primary underline"
            onClick={() => setWhyOpen((v) => !v)}
          >
            لماذا؟
          </button>
          {whyOpen ? (
            <ul className="mt-2 space-y-2 text-xs text-muted" data-testid="project-ai-evidence">
              {view.risks.length === 0 ? <li>لا توجد إشارات مخاطر محسوبة حالياً.</li> : null}
              {view.risks.map((r) => (
                <li key={`${r.type}-${r.title_ar}`}>
                  <span className="font-medium text-ink">{r.title_ar}</span>
                  <div className="mt-1">سبب التنبيه:</div>
                  {r.evidence.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">اضغط عرض التحليل لقراءة حالة المشروع من بيانات النظام.</p>
      )}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {pending ? <p className="mt-2 text-sm text-muted">جاري تحليل المشروع...</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={!enabled || pending} onClick={() => run(false)}>
          عرض التحليل
        </Button>
        <Button type="button" variant="outline" disabled={!enabled || pending} onClick={() => run(true)}>
          تحديث
        </Button>
      </div>
      <AiDisclaimer className="mt-3 text-xs text-muted" />
    </Card>
  );
}
