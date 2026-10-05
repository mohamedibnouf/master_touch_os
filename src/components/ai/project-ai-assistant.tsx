"use client";

import { useState, useTransition } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiSparkle } from "@/components/ai/ai-chrome";
import { askProjectAssistantAction, generateExecutiveReportAction } from "@/server/use-cases/ai-platform";
import type { ExecutiveReport } from "@/modules/ai/schemas";

const CHIPS = [
  "لخص حالة المشروع",
  "ما الذي يحتاج تدخلي الآن؟",
  "ما أسباب التأخير؟",
  "ما المراحل المتبقية؟",
  "ما الموافقات المعلقة؟",
  "ما المخاطر الحالية؟",
  "ما الذي يجب متابعته اليوم؟",
];

type Turn = { role: "user" | "assistant"; content: string };

export function ProjectAiAssistant({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [reportPending, startReport] = useTransition();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [report, setReport] = useState<ExecutiveReport | null>(null);

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    setError(null);
    setQuestion("");
    const history = turns.slice(-6);
    setTurns((t) => [...t, { role: "user", content: q }]);
    startTransition(async () => {
      const res = await askProjectAssistantAction({ projectId, question: q, history });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTurns((t) => [...t, { role: "assistant", content: res.data.answer_ar }]);
    });
  }

  function makeReport() {
    setError(null);
    startReport(async () => {
      const res = await generateExecutiveReportAction({ projectId, refresh: true });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReport(res.data.report);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]" data-testid="project-ai-assistant">
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <AiSparkle />
          <h2 className="font-semibold text-ink">المساعد الذكي</h2>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              disabled={!enabled || pending}
              className="rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink hover:bg-surface-muted disabled:opacity-50"
              onClick={() => send(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mb-3 max-h-[28rem] space-y-2 overflow-y-auto">
          {turns.map((t, i) => (
            <div
              key={`${t.role}-${i}`}
              className={
                t.role === "user"
                  ? "mr-8 rounded-2xl bg-surface-muted px-3 py-2 text-sm text-ink"
                  : "ml-4 rounded-2xl border border-line bg-white px-3 py-2 text-sm leading-6 text-ink"
              }
            >
              {t.content}
            </div>
          ))}
          {pending ? <p className="text-sm text-muted">جاري تحليل بيانات المشروع...</p> : null}
        </div>
        <div className="flex gap-2">
          <input
            className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm"
            placeholder="اسأل عن هذا المشروع..."
            value={question}
            disabled={!enabled || pending}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(question);
            }}
          />
          <Button type="button" disabled={!enabled || pending} onClick={() => send(question)}>
            إرسال
          </Button>
        </div>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <AiDisclaimer className="mt-3 text-xs text-muted" />
      </Card>
      <Card className="print:shadow-none">
        <h2 className="mb-2 font-semibold text-ink">تقرير إداري</h2>
        <Button type="button" disabled={!enabled || reportPending} onClick={makeReport}>
          إنشاء تقرير ذكي
        </Button>
        {reportPending ? <p className="mt-2 text-sm text-muted">جاري إعداد التقرير...</p> : null}
        {report ? (
          <article className="mt-4 space-y-3 text-sm leading-7" data-testid="executive-ai-report">
            <p className="text-xs text-muted">
              تم الإنشاء في: {report.generated_at} · بناءً على البيانات كما في: {report.data_as_of}
            </p>
            <section>
              <h3 className="font-semibold">1. الملخص التنفيذي</h3>
              <p>{report.executive_summary_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">2. حالة المشروع</h3>
              <p>{report.project_status_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">3. نسبة التقدم</h3>
              <p>{report.progress_narrative_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">4. المرحلة الحالية</h3>
              <p>{report.current_stage_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">5. المراحل المتأخرة</h3>
              <ul>{report.overdue_stages_ar.length ? report.overdue_stages_ar.map((x) => <li key={x}>{x}</li>) : <li>لا يوجد</li>}</ul>
            </section>
            <section>
              <h3 className="font-semibold">6. المواعيد المهمة</h3>
              <ul>{report.important_dates_ar.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold">7. الموافقات المعلقة</h3>
              <ul>{report.pending_approvals_ar.length ? report.pending_approvals_ar.map((x) => <li key={x}>{x}</li>) : <li>لا يوجد</li>}</ul>
            </section>
            <section>
              <h3 className="font-semibold">8. المخاطر</h3>
              <ul>{report.risks_ar.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold">9. القرارات المطلوبة</h3>
              <ul>{report.required_decisions_ar.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold">10. التوصيات</h3>
              <ul>{report.recommendations_ar.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
            <section>
              <h3 className="font-semibold">11. الخطوات القادمة</h3>
              <ul>{report.next_steps_ar.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
            <button type="button" className="text-sm text-primary underline print:hidden" onClick={() => window.print()}>
              طباعة / حفظ PDF
            </button>
          </article>
        ) : null}
      </Card>
    </div>
  );
}
