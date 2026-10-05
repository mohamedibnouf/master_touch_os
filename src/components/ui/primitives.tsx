import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const controlFocus =
  "outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "icon" | "success" | "warning";
}) {
  return (
    <button
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-medium duration-150 transition-[background-color,box-shadow,color,border-color] disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:opacity-50 md:min-h-9",
        variant === "primary" &&
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
        variant === "success" && "bg-success text-white hover:bg-success/90",
        variant === "warning" &&
          "border border-warning-border bg-warning-soft text-warning hover:bg-warning/15",
        variant === "secondary" &&
          "border border-line bg-surface-muted text-ink hover:border-border-strong hover:bg-surface-strong",
        variant === "outline" &&
          "border border-line bg-white text-ink hover:border-border-strong hover:bg-surface-muted",
        variant === "ghost" && "text-muted hover:bg-surface-muted hover:text-ink",
        variant === "danger" && "bg-danger text-white hover:bg-danger/90",
        variant === "icon" &&
          "h-9 w-9 min-h-9 px-0 text-ink hover:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full max-w-full rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm text-ink placeholder:text-muted disabled:bg-paper disabled:text-disabled-foreground md:h-10",
        "hover:border-border-strong aria-invalid:border-danger",
        controlFocus,
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full max-w-full rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm text-ink disabled:bg-paper disabled:text-disabled-foreground md:h-10",
        "hover:border-border-strong aria-invalid:border-danger",
        controlFocus,
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full max-w-full rounded-[var(--radius-control)] border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted disabled:bg-paper disabled:text-disabled-foreground",
        "hover:border-border-strong aria-invalid:border-danger",
        controlFocus,
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-surface max-w-full p-4 md:p-5", className)}
      {...props}
    />
  );
}

export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mt-surface p-4 md:p-5", className)}>
      {title ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "mt-surface flex items-start justify-between gap-3 border-s-2 p-4",
        tone === "neutral" && "border-s-line",
        tone === "info" && "border-s-primary",
        tone === "success" && "border-s-success",
        tone === "warning" && "border-s-warning",
        tone === "danger" && "border-s-danger",
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted">{label}</p>
        <p
          className={cn(
            "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
            tone === "danger" && "text-danger",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success",
            tone === "info" && "text-primary",
            tone === "neutral" && "text-ink",
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </div>
      {icon ? (
        <span
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            tone === "info" && "bg-info-soft text-primary",
            tone === "success" && "bg-success-soft text-success",
            tone === "warning" && "bg-warning-soft text-warning",
            tone === "danger" && "bg-danger-soft text-danger",
            tone === "neutral" && "bg-surface-strong text-muted",
          )}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
    </div>
  );
}

/** Horizontal scroll wrapper for enterprise tables — keeps desktop column structure intact. */
export function TableScroll({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("table-scroll -mx-1 max-w-full overflow-x-auto overscroll-x-contain px-1", className)}
      {...props}
    />
  );
}

export function Badge({
  className,
  tone = "neutral",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "danger" | "warning" | "navy" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-strong text-muted",
        tone === "success" && "bg-success-soft text-success",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "warning" && "bg-warning-soft text-warning",
        (tone === "navy" || tone === "info") && "bg-info-soft text-primary",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          tone === "neutral" && "bg-muted",
          tone === "success" && "bg-success",
          tone === "danger" && "bg-danger",
          tone === "warning" && "bg-warning",
          (tone === "navy" || tone === "info") && "bg-primary",
        )}
      />
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-2 text-xs text-muted">{meta}</div> : null}
      </div>
      {actions ? (
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ms-1 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </span>
      {children}
      {hint && !error ? <span className="block text-xs text-muted">{hint}</span> : null}
      {error ? <span className="block text-xs text-danger">{error}</span> : null}
    </label>
  );
}
