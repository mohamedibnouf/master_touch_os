"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { analyzeManagementAction, type AnalyzeManagementActionResult } from "@/server/use-cases/management-ai";
import type { ManagementAIMode, ManagementAIResult } from "@/modules/management/ai";

const SUGGESTION_MODES = [
  "attention",
  "project_risks",
  "approvals",
  "procurement",
  "commercial",
  "people",
  "payroll",
  "meeting_brief",
] as const satisfies readonly ManagementAIMode[];

const SEVERITY_TONE: Record<string, "danger" | "warning" | "neutral"> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

export function ManagementAnalystClient({
  asOfDate,
  aiEnabled,
  providerLabel,
}: {
  asOfDate: string;
  aiEnabled: boolean;
  providerLabel: string;
}) {
  const { t, locale } = useI18n();
  const a = t.management.analyst;
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
        locale,
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
        <Card className="mb-4 border-warning-border bg-warning-soft" data-testid="analyst-unavailable">
          <p className="text-sm text-ink">
            {a.unavailablePrefix}{" "}
            <code className="rounded bg-surface px-1 text-xs" dir="ltr">
              MANAGEMENT_AI_PROVIDER=mock
            </code>{" "}
            {a.unavailableOr}{" "}
            <code className="rounded bg-surface px-1 text-xs" dir="ltr">
              openai
            </code>{" "}
            {a.unavailableSuffix}
          </p>
        </Card>
      ) : (
        <p className="mb-3 text-xs text-muted" data-testid="analyst-provider-label">
          {format(a.providerLine, { provider: providerLabel, date: asOfDate })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] print:hidden">
        <Card data-testid="analyst-suggestions">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">{a.suggestionsTitle}</h2>
            <Button
              type="button"
              variant="primary"
              data-testid="analyst-executive-brief"
              disabled={!aiEnabled || pending}
              onClick={() => run("executive_brief")}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {a.executiveBrief}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTION_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`analyst-suggest-${mode}`}
                disabled={!aiEnabled || pending}
                onClick={() => run(mode)}
              >
                {a.suggestions[mode]}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <label className="mb-2 block text-sm font-semibold text-ink" htmlFor="analyst-question">
            {a.questionLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="analyst-question"
              data-testid="analyst-question-input"
              className="min-w-0 flex-1"
              value={question}
              maxLength={800}
              disabled={!aiEnabled || pending}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={a.questionPlaceholder}
            />
            <Button
              type="button"
              variant="primary"
              data-testid="analyst-ask"
              disabled={!aiEnabled || pending || question.trim().length === 0}
              onClick={() => run("free_question", question.trim())}
            >
              {a.ask}
            </Button>
          </div>
        </Card>
      </div>

      {pending ? (
        <p className="mt-4 text-sm text-muted" data-testid="analyst-loading" aria-live="polite">
          {a.loading}
        </p>
      ) : null}

      {error ? (
        <Card className="mt-4 border-danger/40" data-testid="analyst-error">
          <p className="text-sm text-danger">{error}</p>
        </Card>
      ) : null}

      {result ? <AnalystResultView result={result} /> : null}
    </div>
  );
}

function AnalystResultView({ result }: { result: ManagementAIResult }) {
  const { t, locale } = useI18n();
  const a = t.management.analyst;
  return (
    <div className="mt-4 space-y-4" data-testid="analyst-result">
      <Card className="break-inside-avoid border-s-4 border-s-primary">
        <p className="text-xs text-muted" data-testid="analyst-disclaimer">
          {pickLocalized(locale, result.disclaimerAr, result.disclaimerEn)}
        </p>
        <h2 className="mt-2 text-base font-semibold text-ink">{a.summary}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink" data-testid="analyst-summary">
          {result.summary}
        </p>
        <p className="mt-2 text-xs text-muted">
          {format(a.generatedLine, {
            date: result.asOfDate,
            generated: new Date(result.generatedAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" }),
          })}
        </p>
      </Card>

      <Card className="break-inside-avoid" data-testid="analyst-findings">
        <h2 className="mb-3 text-base font-semibold text-ink">{a.findings}</h2>
        {result.findings.length === 0 ? (
          <p className="text-sm text-muted">{a.findingsEmpty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {result.findings.map((f, i) => (
              <li key={`${f.title}-${i}`} className="py-3" data-testid="analyst-finding">
                <div className="flex flex-wrap items-center gap-2">
                  {f.isOfficialRisk ? (
                    <Badge tone="info" data-testid="official-risk-badge">
                      {a.officialRisk}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" data-testid="ai-observation-badge">
                      {a.aiObservation}
                    </Badge>
                  )}
                  {f.severity ? (
                    <Badge tone={SEVERITY_TONE[f.severity] ?? "neutral"}>
                      {(t.management.severity as Record<string, string>)[f.severity] ?? f.severity}
                    </Badge>
                  ) : null}
                  <span className="font-medium text-ink">{f.title}</span>
                </div>
                <p className="mt-1 text-sm text-ink">{f.explanation}</p>
                {f.sources.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {f.sources.map((s) =>
                      s.href ? (
                        <li key={s.id}>
                          <Link
                            href={s.href}
                            className="break-all rounded bg-surface-muted px-1.5 py-0.5 text-primary hover:underline"
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="break-inside-avoid" data-testid="analyst-reviews">
          <h2 className="mb-3 text-base font-semibold text-ink">{a.reviews}</h2>
          {result.suggestedReviews.length === 0 ? (
            <p className="text-sm text-muted">{a.reviewsEmpty}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {result.suggestedReviews.map((r, i) => (
                <li key={`${r.label}-${i}`}>
                  {r.href ? (
                    <Link href={r.href} className="text-ink hover:text-primary hover:underline">
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
          <h2 className="mb-2 text-base font-semibold text-ink">{a.limitations}</h2>
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
            {result.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
