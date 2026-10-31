"use client";

import { startTransition, useActionState, useRef } from "react";
import { MessageSquare, SendHorizontal } from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { addCommentAction } from "@/server/use-cases/tasks";
import type { TaskActionState, TaskComment } from "@/modules/tasks/types";
import { formatRelative, formatRiyadhDateTime, personName } from "./detail-format";
import { PersonAvatar } from "./person-avatar";

export function TaskComments({
  taskId,
  comments,
  canComment,
  viewerId,
  nowIso,
}: {
  taskId: string;
  comments: TaskComment[];
  canComment: boolean;
  viewerId: string;
  nowIso: string;
}) {
  const { t, locale } = useI18n();
  const tc = t.tasksDetail.comments;
  const nowMs = new Date(nowIso).getTime();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<TaskActionState, FormData>(async (prev, fd) => {
    const res = await addCommentAction(prev, fd);
    if (res?.ok) formRef.current?.reset();
    return res;
  }, null);

  return (
    <section className="mt-surface p-4 md:p-5" aria-labelledby="task-comments-title" data-testid="task-comments">
      <h2 id="task-comments-title" className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
        <MessageSquare aria-hidden className="h-4 w-4 text-muted" />
        {tc.title}
        {comments.length ? <span className="text-xs font-normal text-muted tabular-nums">({comments.length})</span> : null}
      </h2>

      {comments.length === 0 ? (
        <div className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-6 text-center">
          <p className="text-sm font-medium text-ink">{tc.empty}</p>
          {canComment ? <p className="mt-1 text-xs text-muted">{tc.emptyHint}</p> : null}
        </div>
      ) : (
        <ol className="space-y-4">
          {comments.map((c) => {
            const mine = c.author_id === viewerId;
            const name = mine ? t.tasksDetail.you : personName(c.author, locale, t.tasksDetail.unknownPerson);
            const fullName = personName(c.author, locale, t.tasksDetail.unknownPerson);
            return (
              <li key={c.id} className="flex gap-3">
                <PersonAvatar name={fullName} seed={c.author_id ?? c.id} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-ink" dir="auto">
                      {name}
                    </span>
                    <time
                      dateTime={c.created_at}
                      title={formatRiyadhDateTime(c.created_at, locale)}
                      className="text-xs text-muted"
                    >
                      {formatRelative(c.created_at, nowMs, locale, t.tasksDetail.justNow)}
                    </time>
                    {c.edited_at ? <span className="text-xs text-muted">· {tc.edited}</span> : null}
                  </div>
                  <div
                    className={cn(
                      "mt-1.5 rounded-[var(--radius-control)] border px-3 py-2",
                      mine ? "border-info-border bg-primary-soft/60" : "border-line bg-surface-muted",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink" dir="auto">
                      {c.body}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canComment ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => action(fd));
          }}
          className="mt-5 border-t border-line pt-4"
          data-testid="task-comment-form"
          aria-busy={pending}
        >
          <input type="hidden" name="taskId" value={taskId} />
          <label htmlFor="task-comment-body" className="sr-only">
            {tc.label}
          </label>
          <Textarea
            id="task-comment-body"
            name="body"
            required
            maxLength={10000}
            rows={3}
            dir="auto"
            placeholder={tc.placeholder}
            className="min-h-20 resize-y"
            aria-describedby="task-comment-hint"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span id="task-comment-hint" className="text-xs text-muted">
              {tc.shortcut}
            </span>
            <Button type="submit" className="min-h-9" disabled={pending}>
              <SendHorizontal aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
              {tc.submit}
            </Button>
          </div>
          {state && !state.ok && state.message ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="mt-4 text-xs text-muted">{tc.noPermission}</p>
      )}
    </section>
  );
}
