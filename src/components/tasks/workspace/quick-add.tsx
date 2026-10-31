"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarDays, Flag, Plus, SlidersHorizontal, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { pickLocalized } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { createTaskAction } from "@/server/use-cases/tasks";
import { TASK_PRIORITIES, type TaskMemberOption, type TaskPriority } from "@/modules/tasks/types";

export type QuickAddListOption = { id: string; name: string; group: string };

const controlCls =
  "h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-sm text-ink outline-none hover:border-border-strong focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25";

/**
 * Quick-add row: type a title and press Enter. Optional due date / assignee / priority, and a
 * list picker when the current scope spans several lists. Uses `createTaskAction`
 * (revalidates /tasks, so the new task appears without a manual refresh).
 */
export function QuickAdd({
  fixedListId,
  listOptions,
  members,
  defaultAssigneeId,
}: {
  /** Current list: tasks go here and no picker is shown. */
  fixedListId: string | null;
  /** Lists to choose from when `fixedListId` is null. */
  listOptions: QuickAddListOption[];
  members: TaskMemberOption[];
  defaultAssigneeId?: string | null;
}) {
  const { t, locale } = useI18n();
  const tq = t.tasksWorkspace.quickAdd;
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState(fixedListId ?? (listOptions.length === 1 ? listOptions[0].id : ""));
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState(defaultAssigneeId ?? "");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [showOptions, setShowOptions] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!message?.ok) return;
    const timer = window.setTimeout(() => setMessage(null), 2500);
    return () => window.clearTimeout(timer);
  }, [message]);

  const targetList = fixedListId ?? listId;
  const groups = [...new Set(listOptions.map((o) => o.group))];

  const submit = () => {
    const value = title.trim();
    if (!value || pending) return;
    if (!targetList) {
      setMessage({ ok: false, text: tq.listRequired });
      setShowOptions(true);
      return;
    }
    const fd = new FormData();
    fd.set("title", value);
    fd.set("listId", targetList);
    if (dueDate) fd.set("dueDate", dueDate);
    if (assignee) fd.set("assigneeIds", assignee);
    if (priority !== "normal") fd.set("priority", priority);
    setMessage(null);
    startTransition(async () => {
      const res = await createTaskAction(null, fd);
      if (res?.ok) {
        setTitle("");
        setMessage({ ok: true, text: tq.added });
        inputRef.current?.focus();
      } else {
        setMessage({ ok: false, text: res?.message || t.tasksWorkspace.actionFailed });
      }
    });
  };

  return (
    <form
      data-testid="tasks-quick-add"
      aria-label={tq.aria}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-surface p-2"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary" aria-hidden>
          <Plus className="size-4" />
        </span>
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={tq.placeholder}
          aria-label={tq.placeholder}
          maxLength={500}
          disabled={pending}
          className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-muted"
          data-testid="tasks-quick-add-title"
          dir="auto"
        />
        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          aria-expanded={showOptions}
          aria-label={tq.options}
          title={tq.options}
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-surface-muted hover:text-ink",
            showOptions && "bg-surface-muted text-ink",
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
        </button>
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-control)] bg-primary px-3.5 text-sm font-medium text-primary-foreground duration-150 transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {tq.submit}
        </button>
      </div>

      {showOptions || (!fixedListId && !listId && title.trim()) ? (
        <div className="mt-pop-in mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          {!fixedListId ? (
            <select
              aria-label={tq.list}
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className={cn(controlCls, "basis-48 flex-1 sm:flex-none")}
              data-testid="tasks-quick-add-list"
            >
              <option value="">{tq.chooseList}</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {listOptions
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          ) : null}
          <label className="inline-flex items-center gap-1.5 text-muted">
            <CalendarDays className="size-4" aria-hidden />
            <span className="sr-only">{tq.dueDate}</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={cn(controlCls, "w-40")}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-muted">
            <UserRound className="size-4" aria-hidden />
            <span className="sr-only">{tq.assignee}</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={cn(controlCls, "w-44")}>
              <option value="">{tq.noAssignee}</option>
              {members.map((m) => (
                <option key={m.profile_id} value={m.profile_id}>
                  {pickLocalized(locale, m.full_name_ar, m.full_name_en)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-muted">
            <Flag className="size-4" aria-hidden />
            <span className="sr-only">{tq.priority}</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className={cn(controlCls, "w-32")}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t.tasks.priority[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn("mt-2 px-1 text-xs", message.ok ? "text-success" : "text-danger")}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
