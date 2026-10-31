"use client";

import { startTransition, useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { updateTaskAction } from "@/server/use-cases/tasks";
import type { TaskActionState } from "@/modules/tasks/types";

/**
 * Task title. Click (or the pencil) to edit inline when `canEdit`; Escape cancels.
 * `field` is the column shown to this viewer: `title`, or `titleEn` in the English UI
 * when the task has an English title.
 */
export function TaskTitleEditor({
  taskId,
  title,
  field,
  canEdit,
}: {
  taskId: string;
  title: string;
  field: "title" | "titleEn";
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const td = t.tasksDetail;
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<TaskActionState, FormData>(async (prev, fd) => {
    const res = await updateTaskAction(prev, fd);
    if (res?.ok) setEditing(false);
    return res;
  }, null);

  if (!editing) {
    return (
      <div className="group flex min-w-0 items-start gap-2">
        <h1
          className="min-w-0 break-words text-[1.375rem] font-semibold leading-snug tracking-tight text-ink md:text-2xl"
          dir="auto"
          data-testid="task-title"
          onDoubleClick={canEdit ? () => setEditing(true) : undefined}
        >
          {title}
        </h1>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted opacity-70 transition hover:bg-surface-muted hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={td.header.editTitle}
            title={td.header.editTitle}
            data-testid="task-title-edit"
          >
            <Pencil aria-hidden className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="w-full min-w-0 space-y-2"
      aria-busy={pending}
    >
      <input type="hidden" name="taskId" value={taskId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          name={field}
          defaultValue={title}
          required
          maxLength={500}
          autoFocus
          dir="auto"
          aria-label={td.header.titleLabel}
          className="h-11 text-lg font-semibold"
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <div className="flex shrink-0 gap-2">
          <Button type="submit" disabled={pending}>
            {td.save}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            {td.cancel}
          </Button>
        </div>
      </div>
      {state && !state.ok && state.message ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
