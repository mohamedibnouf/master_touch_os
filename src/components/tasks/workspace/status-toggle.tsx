"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { setTaskStatus } from "@/server/use-cases/tasks";
import type { TaskStatus } from "@/modules/tasks/types";
import { STATUS_STYLE, toggleLabel } from "./model";

/**
 * Checkbox-like status toggle for list rows: open → done, done → todo. Optimistic; the server
 * action revalidates /tasks, and the optimistic value reverts automatically on failure.
 */
export function StatusToggle({
  taskId,
  title,
  status,
  disabled,
}: {
  taskId: string;
  title: string;
  status: TaskStatus;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const done = optimistic === "done";
  const cancelled = optimistic === "cancelled";

  const toggle = () => {
    const next: TaskStatus = done ? "todo" : "done";
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const res = await setTaskStatus(taskId, next);
      if (!res?.ok) setError(res?.message || t.tasksWorkspace.actionFailed);
    });
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={toggleLabel(t, { title, status: optimistic })}
        disabled={disabled || cancelled}
        onClick={toggle}
        aria-busy={pending}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 duration-150 transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60",
          done
            ? "border-success bg-success text-white"
            : cn("border-border-strong bg-surface hover:border-success hover:text-success", "text-transparent"),
          !done && optimistic === "in_progress" && "border-info",
          !done && optimistic === "review" && "border-warning",
          cancelled && "border-dashed",
        )}
      >
        <Check className="size-3" strokeWidth={3} aria-hidden />
        <span className={cn("sr-only", STATUS_STYLE[optimistic].text)}>{t.tasks.status[optimistic]}</span>
      </button>
      {error ? (
        <span
          role="alert"
          className="mt-pop-in pointer-events-none absolute start-7 top-1/2 z-20 w-max max-w-[16rem] -translate-y-1/2 rounded-md border border-danger-border bg-danger-soft px-2 py-1 text-xs text-danger shadow-sm"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
