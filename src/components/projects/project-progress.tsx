import { cn } from "@/lib/utils";

export function ProjectProgress({
  percent,
  completed,
  total,
  tone = "info",
}: {
  percent: number;
  completed: number;
  total: number;
  tone?: "info" | "success" | "warning" | "danger";
}) {
  const safe = Math.min(100, Math.max(0, percent));
  return (
    <div data-testid="project-progress">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">التقدم</p>
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">{safe}%</span>
          {total > 0 ? ` · ${completed} من ${total} مراحل مكتملة` : null}
        </p>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-strong"
        role="progressbar"
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="تقدم المشروع"
      >
        <div
          className={cn(
            "h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500",
            tone === "info" && "bg-primary",
            tone === "success" && "bg-success",
            tone === "warning" && "bg-warning",
            tone === "danger" && "bg-danger",
          )}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
