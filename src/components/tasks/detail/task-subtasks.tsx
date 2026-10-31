"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ListChecks, Plus } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { format } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { quickAddTask, setTaskStatus } from "@/server/use-cases/tasks";
import { isOverdue, taskDisplayTitle, taskHref } from "@/modules/tasks/logic";
import type { TaskListItem, TaskStatus } from "@/modules/tasks/types";
import { formatRiyadhDate, personName, STATUS_TONE } from "./detail-format";
import { PersonAvatar } from "./person-avatar";

type Override = { id: string; status: TaskStatus };

export function TaskSubtasks({
  taskId,
  subtasks,
  canAdd,
  canToggle,
  nowIso,
}: {
  taskId: string;
  subtasks: TaskListItem[];
  /** Quick-add allowed (task.create, top-level task, list not archived). */
  canAdd: boolean;
  canToggle: boolean;
  nowIso: string;
}) {
  const { t, locale } = useI18n();
  const ts = t.tasksDetail.subtasks;
  const now = new Date(nowIso);
  const [optimistic, applyOverride] = useOptimistic(subtasks, (rows: TaskListItem[], o: Override) =>
    rows.map((r) => (r.id === o.id ? { ...r, status: o.status } : r)),
  );
  const [, startToggle] = useTransition();
  const [adding, startAdd] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = optimistic.length;
  const done = optimistic.filter((s) => s.status === "done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  function toggle(row: TaskListItem) {
    const next: TaskStatus = row.status === "done" ? "todo" : "done";
    setError(null);
    startToggle(async () => {
      applyOverride({ id: row.id, status: next });
      const res = await setTaskStatus(row.id, next);
      if (!res?.ok) setError(res?.message || t.tasks.messages.unexpected);
    });
  }

  function add(form: HTMLFormElement) {
    const raw = new FormData(form).get("title");
    const title = typeof raw === "string" ? raw.trim() : "";
    if (!title || adding) return;
    setError(null);
    startAdd(async () => {
      const res = await quickAddTask({ title, parentTaskId: taskId });
      if (res?.ok) form.reset();
      else setError(res?.message || t.tasks.messages.unexpected);
      form.querySelector<HTMLInputElement>("input[name=title]")?.focus();
    });
  }

  return (
    <section className="mt-surface p-4 md:p-5" aria-labelledby="task-subtasks-title" data-testid="task-subtasks">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="task-subtasks-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ListChecks aria-hidden className="h-4 w-4 text-muted" />
          {ts.title}
          {total ? <span className="text-xs font-normal text-muted tabular-nums">{format(ts.progress, { done, total })}</span> : null}
        </h2>
        {total ? (
          <div
            className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-strong"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={format(ts.progress, { done, total })}
          >
            <div className="mt-progress-fill h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-5 text-center">
          <p className="text-sm font-medium text-ink">{ts.empty}</p>
          {canAdd ? <p className="mt-1 text-xs text-muted">{ts.emptyHint}</p> : null}
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-control)] border border-line">
          {optimistic.map((row) => {
            const title = taskDisplayTitle(row, locale);
            const isDone = row.status === "done";
            const overdue = isOverdue(row, now);
            return (
              <li key={row.id} className="flex items-center gap-3 bg-surface px-3 py-2.5 transition-colors hover:bg-surface-muted">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  disabled={!canToggle || row.status === "cancelled"}
                  onClick={() => toggle(row)}
                  aria-label={format(isDone ? ts.reopen : ts.markDone, { title })}
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-default",
                    isDone ? "border-success bg-success text-white" : "border-border-strong bg-surface hover:border-success",
                  )}
                >
                  {isDone ? <Check aria-hidden className="h-3 w-3" strokeWidth={3} /> : null}
                </button>
                <Link
                  href={taskHref(row.id)}
                  dir="auto"
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm text-ink hover:text-primary hover:underline",
                    (isDone || row.status === "cancelled") && "text-muted line-through decoration-1",
                  )}
                >
                  {title}
                </Link>
                <span className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex">
                  <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", STATUS_TONE[row.status].dot)} />
                  {t.tasks.status[row.status]}
                </span>
                {row.due_at ? (
                  <span className={cn("shrink-0 text-xs tabular-nums", overdue ? "font-medium text-danger" : "text-muted")}>
                    {formatRiyadhDate(row.due_at, locale)}
                  </span>
                ) : null}
                {row.assignees.length ? (
                  <span className="flex shrink-0 -space-x-1.5 rtl:space-x-reverse">
                    {row.assignees.slice(0, 3).map((p) => {
                      const name = personName(p, locale, t.tasksDetail.unknownPerson);
                      return <PersonAvatar key={p.profile_id} name={name} seed={p.profile_id} size="sm" title={name} />;
                    })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canAdd ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(e.currentTarget);
          }}
          aria-busy={adding}
          data-testid="task-subtask-add"
        >
          <Input
            name="title"
            required
            maxLength={500}
            dir="auto"
            placeholder={ts.addPlaceholder}
            aria-label={ts.addLabel}
            readOnly={adding}
          />
          <Button type="button" variant="secondary" disabled={adding} onClick={(e) => e.currentTarget.form?.requestSubmit()}>
            <Plus aria-hidden className="h-4 w-4" />
            {ts.add}
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
