"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ChevronDown, Flag } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { TASK_PRIORITIES, type TaskPriority } from "@/modules/tasks/types";
import { PRIORITY_TONE } from "./detail-format";
import { updateTaskFields } from "./update-task-fields";

/** Priority selector — optimistic, patches only `priority`. */
export function TaskPrioritySelect({
  taskId,
  priority,
  disabled,
}: {
  taskId: string;
  priority: TaskPriority;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [optimistic, setOptimistic] = useOptimistic(priority);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: TaskPriority) {
    if (next === optimistic) return;
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const res = await updateTaskFields(taskId, { priority: next });
      if (!res?.ok) setError(res?.message || t.tasks.messages.unexpected);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "relative inline-flex h-9 items-center rounded-full border border-line bg-surface ps-3 pe-1 text-sm font-medium text-ink transition-colors hover:border-border-strong",
          pending && "opacity-80",
        )}
      >
        <Flag aria-hidden className={cn("me-2 h-3.5 w-3.5 shrink-0", PRIORITY_TONE[optimistic])} />
        <select
          data-testid="task-priority-select"
          aria-label={t.tasksDetail.header.priorityLabel}
          value={optimistic}
          disabled={disabled}
          aria-busy={pending}
          onChange={(e) => change(e.target.value as TaskPriority)}
          className="h-full cursor-pointer appearance-none rounded-full bg-transparent pe-7 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default"
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p} className="bg-surface text-ink">
              {t.tasks.priority[p]}
            </option>
          ))}
        </select>
        {!disabled ? (
          <ChevronDown aria-hidden className="pointer-events-none absolute end-2.5 h-4 w-4 opacity-60" />
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
