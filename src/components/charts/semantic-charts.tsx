export type ChartTone = "info" | "success" | "warning" | "danger" | "neutral";

export type DonutSegment = {
  label: string;
  value: number;
  tone: ChartTone;
};

const TONE_VAR: Record<ChartTone, string> = {
  info: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  neutral: "var(--text-muted)",
};

export function DonutChart({
  title,
  segments,
  centerValue,
  centerLabel,
}: {
  title: string;
  segments: DonutSegment[];
  centerValue: string | number;
  centerLabel: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-sm font-medium text-ink">لا توجد بيانات كافية بعد</p>
        <p className="mt-1 text-xs text-muted">{title}</p>
      </div>
    );
  }

  const r = 42;
  const c = 2 * Math.PI * r;
  const nonzero = segments.filter((s) => s.value > 0);
  const arcs = nonzero.reduce<Array<DonutSegment & { dash: string; offset: number }>>((acc, s) => {
    const len = (s.value / total) * c;
    const offset = acc.reduce((sum, item) => sum + ((item.value / total) * c), 0);
    acc.push({ ...s, dash: `${len} ${c - len}`, offset });
    return acc;
  }, []);

  return (
    <figure className="min-w-0" aria-label={title}>
      <figcaption className="mb-3 text-sm font-semibold text-ink">{title}</figcaption>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0" role="img">
          <title>{`${title}: ${centerValue}`}</title>
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="12" />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={TONE_VAR[arc.tone]}
              strokeWidth="12"
              strokeDasharray={arc.dash}
              strokeDashoffset={-arc.offset}
              strokeLinecap="butt"
              transform="rotate(-90 60 60)"
            >
              <title>{`${arc.label}: ${arc.value}`}</title>
            </circle>
          ))}
          <text x="60" y="56" textAnchor="middle" className="fill-ink" fontSize="16" fontWeight="600">
            {centerValue}
          </text>
          <text x="60" y="72" textAnchor="middle" className="fill-[var(--muted)]" fontSize="8">
            {centerLabel}
          </text>
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: TONE_VAR[s.tone] }}
                  aria-hidden
                />
                <span className="truncate text-muted">{s.label}</span>
              </span>
              <span className="tabular-nums font-medium text-ink">{s.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

export function HorizontalBarList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; label: string; href?: string; percent: number; hint?: string }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-sm font-medium text-ink">لا توجد بيانات كافية بعد</p>
        <p className="mt-1 text-xs text-muted">{title}</p>
      </div>
    );
  }

  return (
    <figure className="min-w-0" aria-label={title}>
      <figcaption className="mb-3 text-sm font-semibold text-ink">{title}</figcaption>
      <ul className="space-y-3">
        {rows.map((row) => {
          const safe = Math.min(100, Math.max(0, row.percent));
          const inner = (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm text-ink" dir="auto">
                  {row.label}
                </p>
                <p className="shrink-0 text-xs tabular-nums text-muted">
                  {safe}%{row.hint ? ` · ${row.hint}` : ""}
                </p>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-surface-strong"
                role="progressbar"
                aria-valuenow={safe}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={row.label}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${safe}%` }} />
              </div>
            </>
          );
          return (
            <li key={row.id}>
              {row.href ? (
                <a href={row.href} className="block rounded-[var(--radius-control)] outline-none hover:opacity-90">
                  {inner}
                </a>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

export function StackedCountBars({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number; tone: ChartTone }>;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (max <= 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
        <p className="text-sm font-medium text-ink">لا توجد بيانات كافية بعد</p>
        <p className="mt-1 text-xs text-muted">{title}</p>
      </div>
    );
  }

  return (
    <figure className="min-w-0" aria-label={title}>
      <figcaption className="mb-3 text-sm font-semibold text-ink">{title}</figcaption>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="mb-1 flex justify-between gap-2 text-sm">
              <span className="text-muted">{row.label}</span>
              <span className="tabular-nums font-medium text-ink">{row.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-strong">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round((row.value / max) * 100)}%`,
                  background: TONE_VAR[row.tone],
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
