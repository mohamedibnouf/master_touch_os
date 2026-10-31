"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { setTaskStatus } from "@/server/use-cases/tasks";
import { TASK_STATUSES, type TaskStatus } from "@/modules/tasks/types";
import { STATUS_TONE } from "./detail-format";

/** Status pill selector — optimistic; reverts and shows the server message on failure. */
export function TaskStatusSelect({
  taskId,
  status,
  disabled,
}: {
  taskId: string;
  status: TaskStatus;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const tone = STATUS_TONE[optimistic];

  function change(next: TaskStatus) {
    if (next === optimistic) return;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const res = await setTaskStatus(taskId, next);
      if (!res?.ok) setError(res?.message || t.tasksDetail.header.statusFailed);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "relative inline-flex h-9 items-center rounded-full border ps-3 pe-1 text-sm font-medium transition-colors",
          tone.pill,
          pending && "opacity-80",
          disabled && "opacity-90",
        )}
      >
        <span aria-hidden className={cn("me-2 h-2 w-2 shrink-0 rounded-full", tone.dot)} />
        <select
          data-testid="task-status-select"
          aria-label={t.tasksDetail.header.statusLabel}
          value={optimistic}
          disabled={disabled}
          aria-busy={pending}
          onChange={(e) => change(e.target.value as TaskStatus)}
          className="h-full cursor-pointer appearance-none rounded-full bg-transparent pe-7 font-medium text-inherit outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default"
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s} className="bg-surface text-ink no-underline">
              {t.tasks.status[s]}
            </option>
          ))}
        </select>
        {!disabled ? (
          <ChevronDown aria-hidden className="pointer-events-none absolute end-2.5 h-4 w-4 opacity-70" />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
