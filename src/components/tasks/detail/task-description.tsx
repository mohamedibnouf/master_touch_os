"use client";

import { startTransition, useActionState, useState } from "react";
import { TextAlignStart, Pencil } from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { updateTaskAction } from "@/server/use-cases/tasks";
import type { TaskActionState } from "@/modules/tasks/types";

export function TaskDescription({
  taskId,
  description,
  canEdit,
}: {
  taskId: string;
  description: string | null;
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
  const text = description?.trim() ?? "";

  return (
    <section className="mt-surface p-4 md:p-5" aria-labelledby="task-description-title" data-testid="task-description">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="task-description-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <TextAlignStart aria-hidden className="h-4 w-4 text-muted" />
          {td.description.title}
        </h2>
        {canEdit && !editing && text ? (
          <Button type="button" variant="ghost" className="min-h-8 px-2.5 py-1 text-xs" onClick={() => setEditing(true)}>
            <Pencil aria-hidden className="h-3.5 w-3.5" />
            {td.edit}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => action(fd));
          }}
          className="space-y-3"
          aria-busy={pending}
        >
          <input type="hidden" name="taskId" value={taskId} />
          <Textarea
            name="description"
            defaultValue={description ?? ""}
            placeholder={td.description.placeholder}
            aria-label={td.description.title}
            maxLength={20000}
            rows={8}
            autoFocus
            dir="auto"
            className="min-h-40 leading-relaxed"
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {td.save}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {td.cancel}
            </Button>
          </div>
          {state && !state.ok && state.message ? (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : text ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-ink" dir="auto">
          {text}
        </p>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line px-4 py-6 text-sm text-muted transition-colors hover:border-border-strong hover:bg-surface-muted hover:text-ink"
        >
          <Pencil aria-hidden className="h-4 w-4" />
          {td.description.addDescription}
        </button>
      ) : (
        <p className="text-sm text-muted">{td.description.empty}</p>
      )}
    </section>
  );
}
