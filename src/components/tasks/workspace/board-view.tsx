"use client";

import Link from "next/link";
import { useCallback, useMemo, useOptimistic, useRef, useState, useTransition, type DragEvent } from "react";
import { GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { reorderTask } from "@/server/use-cases/tasks";
import { sortOrderBetween } from "@/modules/tasks/logic";
import { BOARD_STATUSES, type TaskStatus } from "@/modules/tasks/types";
import { STATUS_STYLE, type TaskView } from "./model";
import { AssigneeStack, DueChip, PriorityFlag, StatusDot, TaskMetaLine } from "./task-bits";

type Move = { id: string; status: TaskStatus; sortOrder: number };
type DropTarget = { status: TaskStatus; index: number };

function applyMove(views: TaskView[], move: Move): TaskView[] {
  return views.map((v) => (v.id === move.id ? { ...v, status: move.status, sortOrder: move.sortOrder } : v));
}

/**
 * Board view: one column per status, native HTML5 drag-and-drop between and within columns.
 * Moves are optimistic (useOptimistic reverts automatically when the action fails) and call
 * `reorderTask`, which also changes the status when the column changes. Each card also has a
 * status <select> as the keyboard / touch alternative.
 */
export function TaskBoardView({ views }: { views: TaskView[] }) {
  const { t } = useI18n();
  const tw = t.tasksWorkspace;
  const [items, addMove] = useOptimistic(views, applyMove);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const columnRefs = useRef(new Map<TaskStatus, HTMLElement>());

  const columns = useMemo(() => {
    const map = new Map<TaskStatus, TaskView[]>(BOARD_STATUSES.map((s) => [s, []]));
    items.forEach((v) => map.get(v.status)?.push(v));
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [items]);

  const move = useCallback(
    (id: string, status: TaskStatus, index: number) => {
      const current = items.find((v) => v.id === id);
      if (!current || !current.canChangeStatus) return;
      const column = (columns.get(status) ?? []).filter((v) => v.id !== id);
      const clamped = Math.max(0, Math.min(index, column.length));
      const before = column[clamped - 1];
      const after = column[clamped];
      const original = columns.get(current.status) ?? [];
      const pos = original.findIndex((v) => v.id === id);
      const unchanged =
        status === current.status && original[pos - 1]?.id === before?.id && original[pos + 1]?.id === after?.id;
      if (unchanged) return;
      const sortOrder = sortOrderBetween(before?.sortOrder, after?.sortOrder);
      setError(null);
      startTransition(async () => {
        addMove({ id, status, sortOrder });
        const res = await reorderTask({
          taskId: id,
          beforeId: before?.id,
          afterId: after?.id,
          status: status !== current.status ? status : undefined,
        });
        if (!res?.ok) setError(res?.message ? `${tw.board.moveFailed} ${res.message}` : tw.board.moveFailed);
      });
    },
    [items, columns, addMove, tw.board.moveFailed],
  );

  const indexFromPointer = (status: TaskStatus, clientY: number): number => {
    const el = columnRefs.current.get(status);
    if (!el) return 0;
    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-board-card]")).filter(
      (c) => c.dataset.taskId !== dragId,
    );
    for (let i = 0; i < cards.length; i += 1) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  };

  const onDragOver = (status: TaskStatus) => (e: DragEvent<HTMLElement>) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const index = indexFromPointer(status, e.clientY);
    if (!target || target.status !== status || target.index !== index) setTarget({ status, index });
  };

  const onDrop = (status: TaskStatus) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    const index = target?.status === status ? target.index : indexFromPointer(status, e.clientY);
    setDragId(null);
    setTarget(null);
    if (id) move(id, status, index);
  };

  const onDragLeave = (status: TaskStatus) => (e: DragEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setTarget((cur) => (cur?.status === status ? null : cur));
  };

  return (
    <div data-testid="tasks-view-board" className="space-y-3">
      <p className="hidden text-xs text-muted md:block">{tw.board.hint}</p>
      {error ? (
        <div
          role="alert"
          className="mt-pop-in flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-danger/10"
            aria-label={tw.board.dismiss}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      <div
        role="list"
        aria-label={tw.board.aria}
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-3 md:snap-none"
      >
        {BOARD_STATUSES.map((status) => {
          const cards = columns.get(status) ?? [];
          const isTarget = target?.status === status;
          // The dragged card stays mounted (removing it would cancel the drag); indexes skip it.
          const others = cards.filter((c) => c.id !== dragId);
          return (
            <section
              key={status}
              role="listitem"
              aria-label={`${t.tasks.status[status]} (${cards.length})`}
              data-testid={`board-column-${status}`}
              ref={(el) => {
                if (el) columnRefs.current.set(status, el);
                else columnRefs.current.delete(status);
              }}
              onDragOver={onDragOver(status)}
              onDrop={onDrop(status)}
              onDragLeave={onDragLeave(status)}
              className={cn(
                "flex w-[17.5rem] shrink-0 snap-start flex-col rounded-[var(--radius-card,0.875rem)] border border-line bg-surface-muted/60 duration-150 transition-colors",
                isTarget && "border-primary/40 bg-primary-soft/40",
              )}
            >
              <header className="flex items-center gap-2 px-3 pb-2 pt-3">
                <span aria-hidden className={cn("h-4 w-1 rounded-full", STATUS_STYLE[status].bar)} />
                <h3 className={cn("text-sm font-semibold", status === "todo" ? "text-ink" : STATUS_STYLE[status].text)}>
                  {t.tasks.status[status]}
                </h3>
                <span className="ms-auto rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-muted ring-1 ring-line">
                  {cards.length}
                </span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-3">
                {cards.length === 0 && !isTarget ? (
                  <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                    {tw.board.emptyColumn}
                  </p>
                ) : null}
                {cards.map((view) => {
                  const indicator =
                    view.id !== dragId && isTarget && others[target.index]?.id === view.id ? (
                      <DropIndicator label={tw.board.dropHere} />
                    ) : null;
                  return (
                  <div key={view.id} className="contents">
                    {indicator}
                    <BoardCard
                      view={view}
                      dragging={dragId === view.id}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", view.id);
                        setDragId(view.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setTarget(null);
                      }}
                      onStatusChange={(next) => move(view.id, next, (columns.get(next) ?? []).length)}
                    />
                  </div>
                  );
                })}
                {isTarget && target.index >= others.length ? <DropIndicator label={tw.board.dropHere} /> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DropIndicator({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="flex h-10 items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary-soft/50 text-xs font-medium text-primary"
    >
      {label}
    </div>
  );
}

function BoardCard({
  view,
  dragging,
  onDragStart,
  onDragEnd,
  onStatusChange,
}: {
  view: TaskView;
  dragging: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onStatusChange: (status: TaskStatus) => void;
}) {
  const { t } = useI18n();
  const closed = view.status === "done" || view.status === "cancelled";
  return (
    <article
      data-testid="task-card"
      data-board-card
      data-task-id={view.id}
      draggable={view.canChangeStatus}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-xl border border-line bg-surface p-3 shadow-card duration-150 transition-[box-shadow,border-color,opacity]",
        "hover:border-border-strong hover:shadow-[var(--shadow-2)]",
        view.canChangeStatus && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {view.canChangeStatus ? (
          <GripVertical
            className="mt-0.5 size-4 shrink-0 text-muted/50 opacity-0 duration-150 transition-opacity group-hover:opacity-100 max-md:hidden"
            aria-hidden
          />
        ) : null}
        <Link
          href={view.href}
          draggable={false}
          dir="auto"
          className={cn(
            "min-w-0 flex-1 text-sm font-medium leading-snug text-ink hover:text-primary",
            closed && "text-muted line-through decoration-muted/60",
          )}
        >
          {view.title}
        </Link>
        <PriorityFlag priority={view.priority} t={t} />
      </div>
      <TaskMetaLine view={view} t={t} className="mt-2" />
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <DueChip view={view} t={t} />
        </div>
        <AssigneeStack people={view.assignees} t={t} />
      </div>
      {view.canChangeStatus ? (
        <label className="mt-2.5 flex items-center gap-2 border-t border-line pt-2.5">
          <StatusDot status={view.status} className="size-2" />
          <span className="sr-only">{format(t.tasksWorkspace.board.moveTo, { title: view.title })}</span>
          <select
            value={view.status}
            onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
            className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-xs text-muted outline-none hover:border-line focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            {BOARD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.tasks.status[s]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}
