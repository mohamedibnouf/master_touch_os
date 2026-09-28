import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EntityHeader({
  initials,
  title,
  subtitle,
  meta,
  badges,
  actions,
  titleProps,
  subtitleProps,
}: {
  initials: string;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  titleProps?: { "data-testid"?: string; dir?: "auto" };
  subtitleProps?: { "data-testid"?: string; dir?: "auto" };
}) {
  return (
    <header className="mb-5 flex min-w-0 flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-navy text-base font-semibold text-white"
          aria-hidden
        >
          {initials}
        </span>
        <div className="min-w-0">
          <h1
            className="text-xl font-semibold leading-snug text-navy sm:text-2xl"
            dir="auto"
            {...titleProps}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-muted" dir="auto" title={subtitle} {...subtitleProps}>
              {subtitle}
            </p>
          ) : null}
          {meta ? <div className="mt-1 text-sm text-muted">{meta}</div> : null}
          {badges ? <div className="mt-3 flex flex-wrap gap-2">{badges}</div> : null}
        </div>
      </div>
      {actions ? <div className={cn("flex shrink-0 flex-wrap gap-2")}>{actions}</div> : null}
    </header>
  );
}
