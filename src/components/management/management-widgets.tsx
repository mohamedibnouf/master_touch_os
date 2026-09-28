import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import type { ManagementAttentionItem } from "@/modules/management/types";
import type { RiskFinding } from "@/modules/management/risk/types";

const severityTone: Record<string, "danger" | "warning" | "navy" | "neutral"> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

const severityLabelAr: Record<string, string> = {
  CRITICAL: "حرج",
  HIGH: "مرتفع",
  MEDIUM: "متوسط",
  LOW: "منخفض",
};

export function AttentionList({ items }: { items: ManagementAttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="management-attention-empty">
        لا توجد عناصر تتطلب انتباهاً حالياً وفق القواعد المتاحة.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line" data-testid="management-attention-list">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={severityTone[item.severity] ?? "neutral"}>
                {severityLabelAr[item.severity] ?? item.severity}
              </Badge>
              <Link
                href={item.href}
                className="font-medium text-navy underline"
                data-testid={`management-attention-link-${item.id}`}
              >
                {item.titleAr}
              </Link>
            </div>
            <p className="mt-1 text-sm text-muted">{item.reasonAr}</p>
          </div>
          <span className="tabular-nums text-lg font-semibold text-navy">{item.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function RiskFindingsList({ findings }: { findings: RiskFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="management-risks-empty">
        لا توجد مخاطر مكتشفة حالياً وفق القواعد الحتمية المتاحة.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line" data-testid="management-risks-list">
      {findings.map((f) => (
        <li
          key={f.id}
          className="py-4"
          data-testid="management-risk-item"
          data-rule-id={f.ruleId}
          data-severity={f.severity}
          data-category={f.category}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severityTone[f.severity] ?? "neutral"}>
                  {severityLabelAr[f.severity] ?? f.severity}
                </Badge>
                <Badge tone="neutral">{f.category}</Badge>
                <Link
                  href={f.href}
                  className="break-words font-medium text-navy underline"
                  data-testid={`management-risk-link-${f.ruleId}`}
                >
                  {f.titleAr}
                </Link>
              </div>
              <p className="mt-2 text-sm text-ink" data-testid="management-risk-explanation">
                {f.explanationAr}
              </p>
              <dl className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
                <div>
                  <dt className="inline">المصدر: </dt>
                  <dd className="inline font-mono">
                    {f.sourceType}/{f.sourceId.slice(0, 8)}…
                  </dd>
                </div>
                {f.effectiveSince ? (
                  <div>
                    <dt className="inline">منذ: </dt>
                    <dd className="inline tabular-nums">{f.effectiveSince}</dd>
                    {f.ageDays != null ? (
                      <span className="ms-1 tabular-nums">({f.ageDays} يوماً)</span>
                    ) : null}
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="inline">دليل: </dt>
                  <dd className="inline break-all font-mono">
                    {Object.entries(f.evidence)
                      .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
                      .join(" · ")}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MetricGrid({
  metrics,
}: {
  metrics: Array<{ key: string; label: string; value: string | number; href?: string }>;
}) {
  if (metrics.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => {
        const body = (
          <div className="mt-metric mt-tint-navy h-full" data-testid={`management-metric-${m.key}`}>
            <p className="text-[11px] font-medium text-muted">{m.label}</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums text-navy">{m.value}</p>
          </div>
        );
        return m.href ? (
          <Link key={m.key} href={m.href} className="block">
            {body}
          </Link>
        ) : (
          <div key={m.key}>{body}</div>
        );
      })}
    </div>
  );
}
