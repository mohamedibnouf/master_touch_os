"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Card } from "@/components/ui/primitives";
import { analyzeManagementAction, type AnalyzeManagementActionResult } from "@/server/use-cases/management-ai";
import type { ManagementAIMode, ManagementAIResult } from "@/modules/management/ai";

const SUGGESTIONS: Array<{ mode: ManagementAIMode; label: string }> = [
  { mode: "attention", label: "ما الذي يحتاج انتباهي اليوم؟" },
  { mode: "project_risks", label: "مخاطر المشاريع" },
  { mode: "approvals", label: "الموافقات المعلّقة" },
  { mode: "procurement", label: "قضايا المشتريات" },
  { mode: "commercial", label: "القضايا التجارية" },
  { mode: "people", label: "الأفراد والامتثال" },
  { mode: "payroll", label: "حالة المسير" },
  { mode: "meeting_brief", label: "موجز اجتماع الإدارة" },
];

export function ManagementAnalystClient({
  asOfDate,
  aiEnabled,
  providerLabel,
}: {
  asOfDate: string;
  aiEnabled: boolean;
  providerLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ManagementAIResult | null>(null);

  function run(mode: ManagementAIMode, q?: string) {
    setError(null);
    startTransition(async () => {
      const res: AnalyzeManagementActionResult = await analyzeManagementAction({
        mode,
        question: q,
        locale: "ar",
      });
      if (!res.ok) {
        setResult(null);
        setError(res.error);
        return;
      }
      setResult(res.result);
    });
  }

  return (
    <div data-testid="management-analyst-client">
      {!aiEnabled ? (
        <Card className="mb-4" data-testid="analyst-unavailable">
          <p className="text-sm text-muted">
            محلل الإدارة غير مُفعّل حالياً. عيّن على الخادم{" "}
            <code className="text-xs">MANAGEMENT_AI_PROVIDER=mock</code> أو{" "}
            <code className="text-xs">openai</code> مع مفتاح API.
          </p>
        </Card>
      ) : (
        <p className="mb-3 text-xs text-muted" data-testid="analyst-provider-label">
          المزود: {providerLabel} · كما في {asOfDate}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          data-testid="analyst-executive-brief"
          disabled={!aiEnabled || pending}
          onClick={() => run("executive_brief")}
        >
          إنشاء موجز تنفيذي
        </button>
      </div>

      <Card className="mb-4 print:hidden" data-testid="analyst-suggestions">
        <h2 className="mb-2 font-semibold text-navy">أسئلة مقترحة</h2>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.mode}
              type="button"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink disabled:opacity-50"
              data-testid={`analyst-suggest-${s.mode}`}
              disabled={!aiEnabled || pending}
              onClick={() => run(s.mode)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="mb-4 print:hidden">
        <label className="mb-2 block text-sm font-medium text-navy" htmlFor="analyst-question">
          سؤال حر (ضمن بيانات الإدارة المتاحة)
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="analyst-question"
            data-testid="analyst-question-input"
            className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm"
            value={question}
            maxLength={800}
            disabled={!aiEnabled || pending}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="مثال: لخّص أهم المخاطر التشغيلية"
          />
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="analyst-ask"
            disabled={!aiEnabled || pending || question.trim().length === 0}
            onClick={() => run("free_question", question.trim())}
          >
            اسأل
          </button>
        </div>
      </Card>

      {pending ? (
        <p className="mb-4 text-sm text-muted" data-testid="analyst-loading">
          جارٍ التحليل…
        </p>
      ) : null}

      {error ? (
        <Card className="mb-4 border-danger/40" data-testid="analyst-error">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      ) : null}

      {result ? <AnalystResultView result={result} /> : null}
    </div>
  );
}

function AnalystResultView({ result }: { result: ManagementAIResult }) {
  return (
    <div data-testid="analyst-result">
      <Card className="mb-4 break-inside-avoid">
        <p className="text-xs text-muted" data-testid="analyst-disclaimer">
          {result.disclaimerAr}
        </p>
        <h2 className="mt-2 font-semibold text-navy">الملخص</h2>
        <p className="mt-2 text-sm text-ink whitespace-pre-wrap" data-testid="analyst-summary">
          {result.summary}
        </p>
        <p className="mt-2 text-xs text-muted">
          كما في {result.asOfDate} · أُنشئ{" "}
          {new Date(result.generatedAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
        </p>
      </Card>

      <Card className="mb-4 break-inside-avoid" data-testid="analyst-findings">
        <h2 className="mb-3 font-semibold text-navy">النتائج / الملاحظات</h2>
        {result.findings.length === 0 ? (
          <p className="text-sm text-muted">لا توجد نتائج موثّقة.</p>
        ) : (
          <ul className="space-y-4">
            {result.findings.map((f, i) => (
              <li key={`${f.title}-${i}`} className="border-b border-line pb-3" data-testid="analyst-finding">
                <div className="flex flex-wrap items-center gap-2">
                  {f.isOfficialRisk ? (
                    <Badge tone="navy" data-testid="official-risk-badge">
                      مخاطر نظام
                    </Badge>
                  ) : (
                    <Badge tone="neutral" data-testid="ai-observation-badge">
                      ملاحظة تحليلية
                    </Badge>
                  )}
                  {f.severity ? <Badge tone={f.severity === "LOW" ? "neutral" : "danger"}>{f.severity}</Badge> : null}
                  <span className="font-medium text-navy">{f.title}</span>
                </div>
                <p className="mt-1 text-sm text-ink">{f.explanation}</p>
                {f.sources.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {f.sources.map((s) =>
                      s.href ? (
                        <li key={s.id}>
                          <Link
                            href={s.href}
                            className="break-all text-navy underline"
                            data-testid={`analyst-evidence-${s.id}`}
                          >
                            {s.id}: {s.label}
                          </Link>
                        </li>
                      ) : (
                        <li key={s.id} className="text-muted">
                          {s.id}: {s.label}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-4 break-inside-avoid" data-testid="analyst-reviews">
        <h2 className="mb-3 font-semibold text-navy">مراجعات مقترحة</h2>
        {result.suggestedReviews.length === 0 ? (
          <p className="text-sm text-muted">لا توجد مراجعات مقترحة.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {result.suggestedReviews.map((r, i) => (
              <li key={`${r.label}-${i}`}>
                {r.href ? (
                  <Link href={r.href} className="text-navy underline">
                    {r.label}
                  </Link>
                ) : (
                  <span>{r.label}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="break-inside-avoid" data-testid="analyst-limitations">
        <h2 className="mb-2 font-semibold text-navy">القيود</h2>
        <ul className="list-disc space-y-1 pe-5 text-sm text-muted">
          {result.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
