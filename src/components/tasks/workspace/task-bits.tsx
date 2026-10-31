/**
 * Small presentational pieces shared by the list, board and calendar views.
 * No hooks: usable from server and client components alike.
 */

import Link from "next/link";
import { CalendarClock, Flag, Link2, ListTree, MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import type { TaskPriority, TaskStatus } from "@/modules/tasks/types";
import { PRIORITY_STYLE, STATUS_STYLE, type TaskPersonView, type TaskView } from "./model";

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", STATUS_STYLE[status].dot, className)} />;
}

export function SpaceDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px] ring-1 ring-black/5", className)}
      style={{ backgroundColor: color ?? "var(--muted)" }}
    />
  );
}

export function PriorityFlag({
  priority,
  t,
  showLabel = false,
}: {
  priority: TaskPriority;
  t: Dictionary;
  showLabel?: boolean;
}) {
  const label = t.tasks.priority[priority];
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs font-medium", PRIORITY_STYLE[priority].text)}
      title={`${t.tasks.fields.priority}: ${label}`}
    >
      <Flag className={cn("size-3.5", priority === "urgent" && "fill-current")} aria-hidden />
      {showLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

export function AssigneeStack({ people, t, max = 3 }: { people: TaskPersonView[]; t: Dictionary; max?: number }) {
  if (people.length === 0) {
    return (
      <span
        className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-line text-[10px] text-muted"
        title={t.tasksWorkspace.task.unassigned}
      >
        <span aria-hidden>—</span>
        <span className="sr-only">{t.tasksWorkspace.task.unassigned}</span>
      </span>
    );
  }
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1.5 rtl:space-x-reverse" title={people.map((p) => p.name).join("، ")}>
      {shown.map((p) => (
        <span
          key={p.id}
          className="inline-flex size-6 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary ring-2 ring-surface"
        >
          <span aria-hidden>{p.initials}</span>
          <span className="sr-only">{p.name}</span>
        </span>
      ))}
      {extra > 0 ? (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-strong text-[10px] font-semibold text-muted ring-2 ring-surface">
          {format(t.tasksWorkspace.task.moreAssignees, { count: extra })}
        </span>
      ) : null}
    </span>
  );
}

export function DueChip({ view, t }: { view: Pick<TaskView, "dueLabel" | "dueTone">; t: Dictionary }) {
  if (!view.dueLabel) return null;
  const tone = view.dueTone;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs tabular-nums",
        tone === "overdue" && "bg-danger-soft font-medium text-danger",
        tone === "today" && "bg-warning-soft font-medium text-warning",
        tone === "normal" && "text-muted",
      )}
    >
      <CalendarClock className="size-3.5" aria-hidden />
      <span>{tone === "today" ? t.tasksWorkspace.task.dueToday : view.dueLabel}</span>
      {tone === "overdue" ? <span className="sr-only">({t.tasksWorkspace.task.overdue})</span> : null}
    </span>
  );
}

export function SubtaskProgress({ done, total, t }: { done: number; total: number; t: Dictionary }) {
  if (total <= 0) return null;
  const pct = Math.round((done / total) * 100);
  const label = format(t.tasksWorkspace.task.subtasks, { done, total });
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={label}>
      <ListTree className="size-3.5" aria-hidden />
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-strong" aria-hidden>
        <span className="mt-progress-fill block h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">
        {done}/{total}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function CommentCount({ count, t }: { count: number; t: Dictionary }) {
  if (count <= 0) return null;
  const label = format(t.tasksWorkspace.task.comments, { count });
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" title={label}>
      <MessageSquare className="size-3.5" aria-hidden />
      <span className="tabular-nums">{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EntityChip({ entity, t }: { entity: TaskView["entity"]; t: Dictionary }) {
  if (!entity) return null;
  const title = format(t.tasksWorkspace.task.linked, { entity: entity.label });
  const cls =
    "relative z-10 inline-flex max-w-[11rem] items-center gap-1 truncate rounded-md border border-line bg-surface-muted px-1.5 py-0.5 text-xs text-muted";
  if (!entity.href) {
    return (
      <span className={cls} title={title}>
        <Link2 className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{entity.label}</span>
      </span>
    );
  }
  return (
    <Link href={entity.href} className={cn(cls, "hover:border-border-strong hover:text-primary")} title={title}>
      <Link2 className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{entity.label}</span>
    </Link>
  );
}

export function AutoBadge({ t }: { t: Dictionary }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info"
      title={t.tasksWorkspace.task.autoHint}
    >
      <Sparkles className="size-3" aria-hidden />
      {t.tasksWorkspace.task.auto}
    </span>
  );
}

export function ListNameChip({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="inline-flex max-w-[10rem] items-center gap-1.5 truncate text-xs text-muted">
      <SpaceDot color={color} className="size-2" />
      <span className="truncate" dir="auto">
        {name}
      </span>
    </span>
  );
}

/** Secondary info line used by rows and cards. */
export function TaskMetaLine({ view, t, className }: { view: TaskView; t: Dictionary; className?: string }) {
  const hasAny =
    view.isAuto || view.entity || view.subtaskTotal > 0 || view.commentCount > 0 || view.listName || view.isSubtask;
  if (!hasAny) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      {view.listName ? <ListNameChip name={view.listName} color={view.listColor} /> : null}
      {view.isSubtask ? <span className="text-xs text-muted">{t.tasksWorkspace.task.subtaskOf}</span> : null}
      {view.isAuto ? <AutoBadge t={t} /> : null}
      <EntityChip entity={view.entity} t={t} />
      <SubtaskProgress done={view.subtaskDone} total={view.subtaskTotal} t={t} />
      <CommentCount count={view.commentCount} t={t} />
    </div>
  );
}
