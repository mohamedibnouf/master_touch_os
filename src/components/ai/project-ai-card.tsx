"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { AiDisclaimer, AiHeading } from "@/components/ai/ai-chrome";
import { analyzeProjectIntelligenceAction } from "@/server/use-cases/ai-platform";
import { healthLabel } from "@/modules/ai/health";
import { aiClientErrorMessage } from "@/modules/ai/errors";
import type { ProjectIntelligenceView } from "@/modules/ai/schemas";
import { useI18n } from "@/lib/i18n/client";
import { format, intlLocale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

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
  const { t, locale } = useI18n();
  const c = t.ai.card;
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
        setError(locale === "en" ? (aiClientErrorMessage(res.code, locale) ?? res.error) : res.error);
        return;
      }
      setView(res.data);
    });
  }

  return (
    <Card className="border-primary/15 bg-[color-mix(in_srgb,var(--primary-soft)_45%,var(--surface))]" data-testid="project-ai-card">
      <AiHeading title={c.title} className="mb-3" />
      {!enabled ? (
        <p className="text-sm text-muted">{t.ai.disabled}</p>
      ) : view ? (
        <>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
            {c.projectStatus} <Badge tone={healthTone(view.health)}>{healthLabel(view.health, locale)}</Badge>
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">{view.intelligence.summary_ar}</p>
          <p className="mt-1 text-xs text-muted">
            {format(t.ai.generatedAt, { date: new Date(view.generatedAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" }) })}
            {view.cached ? ` · ${t.ai.cachedCopy}` : ""}
          </p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((v) => !v)}
          >
            {c.why}
            <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 transition-transform", whyOpen && "rotate-180")} />
          </button>
          {whyOpen ? (
            <ul className="mt-2 space-y-2 text-xs text-muted" data-testid="project-ai-evidence">
              {view.risks.length === 0 ? <li>{c.noRisks}</li> : null}
              {view.risks.map((r) => (
                <li key={`${r.type}-${r.title_ar}`} className="rounded-lg border border-line bg-surface px-2.5 py-2">
                  <span className="font-medium text-ink">{r.title_ar}</span>
                  <div className="mt-1">{c.alertReason}</div>
                  {r.evidence.map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">{c.idle}</p>
      )}
      {error ? (
        <p className="mt-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {pending ? (
        <p className="mt-2 text-sm text-muted" aria-live="polite">
          {c.analyzing}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={!enabled || pending} onClick={() => run(false)}>
          {c.show}
        </Button>
        <Button type="button" variant="outline" disabled={!enabled || pending} onClick={() => run(true)}>
          {c.refresh}
        </Button>
      </div>
      <AiDisclaimer className="mt-3" />
    </Card>
  );
}
