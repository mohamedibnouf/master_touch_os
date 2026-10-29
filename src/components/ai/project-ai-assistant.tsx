"use client";

import { useState, useTransition } from "react";
import { Printer, SendHorizontal } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiHeading } from "@/components/ai/ai-chrome";
import { askProjectAssistantAction, generateExecutiveReportAction } from "@/server/use-cases/ai-platform";
import { aiClientErrorMessage } from "@/modules/ai/errors";
import type { ExecutiveReport } from "@/modules/ai/schemas";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/config";

type Turn = { role: "user" | "assistant"; content: string };

function ReportList({ items, empty }: { items: string[]; empty?: string }) {
  if (!items.length && empty) {
    return (
      <ul className="list-disc ps-5">
        <li>{empty}</li>
      </ul>
    );
  }
  return (
    <ul className="list-disc ps-5">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

export function ProjectAiAssistant({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const { t, locale } = useI18n();
  const a = t.ai.assistant;
  const [pending, startTransition] = useTransition();
  const [reportPending, startReport] = useTransition();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [report, setReport] = useState<ExecutiveReport | null>(null);

  const localizedError = (res: { code: string; error: string }) =>
    locale === "en" ? (aiClientErrorMessage(res.code, locale) ?? res.error) : res.error;

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    setError(null);
    setQuestion("");
    const history = turns.slice(-6);
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    startTransition(async () => {
      const res = await askProjectAssistantAction({ projectId, question: q, history });
      if (!res.ok) {
        setError(localizedError(res));
        return;
      }
      setTurns((prev) => [...prev, { role: "assistant", content: res.data.answer_ar }]);
    });
  }

  function makeReport() {
    setError(null);
    startReport(async () => {
      const res = await generateExecutiveReportAction({ projectId, refresh: true });
      if (!res.ok) {
        setError(localizedError(res));
        return;
      }
      setReport(res.data.report);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]" data-testid="project-ai-assistant">
      <Card>
        <AiHeading title={a.title} className="mb-3" />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {a.chips.map((c) => (
            <button
              key={c}
              type="button"
              disabled={!enabled || pending}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:border-primary/40 hover:bg-primary-soft disabled:opacity-50"
              onClick={() => send(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mb-3 max-h-[28rem] space-y-2 overflow-y-auto" aria-live="polite">
          {turns.length === 0 && !pending ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
              {a.emptyHint}
            </p>
          ) : null}
          {turns.map((turn, i) => (
            <div
              key={`${turn.role}-${i}`}
              className={
                turn.role === "user"
                  ? "ms-8 rounded-2xl bg-primary-soft px-3 py-2 text-sm text-ink"
                  : "me-4 rounded-2xl border border-line bg-surface px-3 py-2 text-sm leading-6 text-ink"
              }
            >
              {turn.content}
            </div>
          ))}
          {pending ? <p className="text-sm text-muted">{a.thinking}</p> : null}
        </div>
        <div className="flex gap-2">
          <input
            className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
            placeholder={a.placeholder}
            aria-label={a.questionLabel}
            value={question}
            disabled={!enabled || pending}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(question);
            }}
          />
          <Button type="button" disabled={!enabled || pending} onClick={() => send(question)}>
            <SendHorizontal aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
            {a.send}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <AiDisclaimer className="mt-3" />
      </Card>
      <Card className="print:shadow-none">
        <h2 className="mb-2 text-sm font-semibold text-ink">{a.reportTitle}</h2>
        <Button type="button" disabled={!enabled || reportPending} onClick={makeReport}>
          {a.generateReport}
        </Button>
        {reportPending ? (
          <p className="mt-2 text-sm text-muted" aria-live="polite">
            {a.preparingReport}
          </p>
        ) : null}
        {report ? (
          <article className="mt-4 space-y-3 text-sm leading-7 text-ink" data-testid="executive-ai-report">
            <p className="text-xs text-muted">
              {format(a.reportMeta, { generated: report.generated_at, asOf: report.data_as_of })}
            </p>
            <section>
              <h3 className="font-semibold">{a.sections.executiveSummary}</h3>
              <p>{report.executive_summary_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.status}</h3>
              <p>{report.project_status_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.progress}</h3>
              <p>{report.progress_narrative_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.currentStage}</h3>
              <p>{report.current_stage_ar}</p>
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.overdueStages}</h3>
              <ReportList items={report.overdue_stages_ar} empty={t.ai.none} />
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.importantDates}</h3>
              <ReportList items={report.important_dates_ar} />
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.pendingApprovals}</h3>
              <ReportList items={report.pending_approvals_ar} empty={t.ai.none} />
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.risks}</h3>
              <ReportList items={report.risks_ar} />
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.decisions}</h3>
              <ReportList items={report.required_decisions_ar} />
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.recommendations}</h3>
              <ReportList items={report.recommendations_ar} />
            </section>
            <section>
              <h3 className="font-semibold">{a.sections.nextSteps}</h3>
              <ReportList items={report.next_steps_ar} />
            </section>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm text-primary underline print:hidden"
              onClick={() => window.print()}
            >
              <Printer aria-hidden className="h-4 w-4" />
              {a.print}
            </button>
          </article>
        ) : null}
      </Card>
    </div>
  );
}
