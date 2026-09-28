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
  "outline-none focus-visible:border-navy focus-visible:ring-2 focus-visible:ring-ring/35";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium duration-150 transition-[background-color,box-shadow,color,border-color] disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:opacity-50 md:min-h-10",
        variant === "primary" &&
          "bg-navy text-white shadow-[var(--shadow-1)] hover:bg-navy-deep hover:shadow-[var(--shadow-2)] active:bg-navy-deep",
        variant === "secondary" &&
          "border border-line bg-white text-ink shadow-[var(--shadow-1)] hover:border-border-strong hover:bg-paper",
        variant === "ghost" && "text-muted hover:bg-white/80 hover:text-ink",
        variant === "danger" && "bg-danger text-white shadow-[var(--shadow-1)] hover:bg-danger/90",
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
        "h-11 w-full max-w-full rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm text-ink placeholder:text-muted/80 disabled:bg-paper disabled:text-disabled-foreground md:h-10",
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
        "h-11 w-full max-w-full rounded-[var(--radius-control)] border border-line bg-white px-3 text-sm text-ink disabled:bg-paper disabled:text-disabled-foreground md:h-10",
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
        "min-h-24 w-full max-w-full rounded-[var(--radius-control)] border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/80 disabled:bg-paper disabled:text-disabled-foreground",
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
        tone === "neutral" && "bg-paper text-muted",
        tone === "success" && "bg-success/10 text-success",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "warning" && "bg-warning/10 text-warning",
        (tone === "navy" || tone === "info") && "bg-navy/10 text-navy",
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
          (tone === "navy" || tone === "info") && "bg-navy",
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
    <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-navy sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
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
    <div className="mt-surface px-6 py-10 text-center">
      <p className="text-sm font-medium text-navy">{title}</p>
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
