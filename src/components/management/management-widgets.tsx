import Link from "next/link";
import { Badge, StatCard } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import type { ManagementAttentionItem } from "@/modules/management/types";
import type { RiskFinding } from "@/modules/management/risk/types";

export type SeverityTone = "danger" | "warning" | "info" | "neutral";

export const severityTone: Record<string, SeverityTone> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

export function severityLabel(t: Dictionary, severity: string): string {
  return (t.management.severity as Record<string, string>)[severity] ?? severity;
}

export function categoryLabel(t: Dictionary, category: string): string {
  return (t.management.category as Record<string, string>)[category] ?? category;
}

export async function AttentionList({ items }: { items: ManagementAttentionItem[] }) {
  const { t, locale } = await getI18n();
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="management-attention-empty">
        {t.management.widgets.attentionEmpty}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line" data-testid="management-attention-list">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-4 py-3 break-inside-avoid">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={severityTone[item.severity] ?? "neutral"}>{severityLabel(t, item.severity)}</Badge>
              <Link
                href={item.href}
                className="font-medium text-ink hover:text-primary hover:underline"
                data-testid={`management-attention-link-${item.id}`}
              >
                {pickLocalized(locale, item.titleAr, item.titleEn)}
              </Link>
            </div>
            <p className="mt-1 text-sm text-muted">{pickLocalized(locale, item.reasonAr, item.reasonEn)}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-surface-muted px-2.5 py-1 text-lg font-semibold tabular-nums text-ink">
            {item.count.toLocaleString(intlLocale(locale))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function RiskFindingsList({ findings }: { findings: RiskFinding[] }) {
  const { t, locale } = await getI18n();
  const w = t.management.widgets;
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="management-risks-empty">
        {w.risksEmpty}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line" data-testid="management-risks-list">
      {findings.map((f) => (
        <li
          key={f.id}
          className="py-4 break-inside-avoid"
          data-testid="management-risk-item"
          data-rule-id={f.ruleId}
          data-severity={f.severity}
          data-category={f.category}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={severityTone[f.severity] ?? "neutral"}>{severityLabel(t, f.severity)}</Badge>
            <Badge tone="neutral">{categoryLabel(t, f.category)}</Badge>
            <Link
              href={f.href}
              className="break-words font-medium text-ink hover:text-primary hover:underline"
              data-testid={`management-risk-link-${f.ruleId}`}
            >
              {pickLocalized(locale, f.titleAr, f.titleEn)}
            </Link>
          </div>
          <p className="mt-2 text-sm text-ink" data-testid="management-risk-explanation">
            {pickLocalized(locale, f.explanationAr, f.explanationEn)}
          </p>
          <dl className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
            <div>
              <dt className="inline">{w.source} </dt>
              <dd className="inline font-mono" dir="ltr">
                {f.sourceType}/{f.sourceId.slice(0, 8)}…
              </dd>
            </div>
            {f.effectiveSince ? (
              <div>
                <dt className="inline">{w.since} </dt>
                <dd className="inline tabular-nums">{f.effectiveSince}</dd>
                {f.ageDays != null ? (
                  <span className="ms-1 tabular-nums">{format(w.ageDays, { days: f.ageDays })}</span>
                ) : null}
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="inline">{w.evidence} </dt>
              <dd className="inline break-all font-mono" dir="ltr">
                {Object.entries(f.evidence)
                  .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
                  .join(" · ")}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export type ManagementMetric = {
  key: string;
  label: string;
  value: string | number;
  href?: string;
  hint?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

export async function MetricGrid({ metrics }: { metrics: ManagementMetric[] }) {
  const { locale } = await getI18n();
  if (metrics.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => {
        const display = typeof m.value === "number" ? m.value.toLocaleString(intlLocale(locale)) : m.value;
        const body = (
          <div className="h-full" data-testid={`management-metric-${m.key}`}>
            <StatCard label={m.label} value={display} hint={m.hint} tone={m.tone ?? "neutral"} />
          </div>
        );
        return m.href ? (
          <Link
            key={m.key}
            href={m.href}
            className={cn(
              "block h-full rounded-[var(--radius-surface)] transition-shadow hover:shadow-md",
              "[&_.mt-surface]:h-full [&_.mt-surface]:transition-colors hover:[&_.mt-surface]:border-primary/40",
            )}
          >
            {body}
          </Link>
        ) : (
          <div key={m.key} className="[&_.mt-surface]:h-full">
            {body}
          </div>
        );
      })}
    </div>
  );
}
