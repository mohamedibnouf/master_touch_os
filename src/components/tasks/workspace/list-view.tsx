import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";
import { BOARD_STATUSES, type TaskStatus } from "@/modules/tasks/types";
import { STATUS_STYLE, type TaskView } from "./model";
import { StatusToggle } from "./status-toggle";
import { AssigneeStack, DueChip, PriorityFlag, StatusDot, TaskMetaLine } from "./task-bits";

/** List view: tasks grouped by status in collapsible sections (native <details>). */
export function TaskListView({
  views,
  t,
  filtered,
  showClosed,
}: {
  views: TaskView[];
  t: Dictionary;
  filtered: boolean;
  showClosed: boolean;
}) {
  const tw = t.tasksWorkspace;
  if (views.length === 0) {
    return (
      <div data-testid="tasks-view-list">
        <EmptyState
          title={filtered ? tw.list.emptyFilteredTitle : tw.list.emptyTitle}
          description={filtered ? tw.list.emptyFilteredDescription : tw.list.emptyDescription}
        />
      </div>
    );
  }

  const groups = new Map<TaskStatus, TaskView[]>();
  for (const v of views) {
    const arr = groups.get(v.status) ?? [];
    arr.push(v);
    groups.set(v.status, arr);
  }

  return (
    <div data-testid="tasks-view-list" className="space-y-3">
      {BOARD_STATUSES.filter((s) => groups.has(s)).map((status) => {
        const rows = groups.get(status) ?? [];
        const closed = status === "done" || status === "cancelled";
        return (
          <details
            key={status}
            open={!closed || showClosed}
            className="group/status mt-surface overflow-hidden p-0"
            data-testid={`task-group-${status}`}
          >
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-ink select-none",
                "hover:bg-surface-muted [&::-webkit-details-marker]:hidden",
              )}
            >
              <ChevronDown
                className="size-4 text-muted duration-150 transition-transform ltr:-rotate-90 rtl:rotate-90 group-open/status:ltr:rotate-0 group-open/status:rtl:rotate-0"
                aria-hidden
              />
              <span className={cn("inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs", STATUS_STYLE[status].soft, STATUS_STYLE[status].text)}>
                <StatusDot status={status} className="size-2" />
                {t.tasks.status[status]}
              </span>
              <span className="text-xs font-medium tabular-nums text-muted">{rows.length}</span>
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {rows.map((view) => (
                <TaskRow key={view.id} view={view} t={t} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function TaskRow({ view, t }: { view: TaskView; t: Dictionary }) {
  const closed = view.status === "done" || view.status === "cancelled";
  return (
    <li
      data-testid="task-row"
      data-task-id={view.id}
      className="relative flex items-start gap-3 px-4 py-3 duration-150 transition-colors hover:bg-surface-muted/70 sm:items-center"
    >
      <span className="relative z-10 mt-0.5 sm:mt-0">
        <StatusToggle taskId={view.id} title={view.title} status={view.status} disabled={!view.canChangeStatus} />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={view.href}
          className={cn(
            "block truncate text-sm font-medium text-ink outline-none after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-primary/30",
            closed && "text-muted line-through decoration-muted/60",
          )}
          dir="auto"
        >
          {view.title}
        </Link>
        <TaskMetaLine view={view} t={t} className="mt-1" />
        {/* Mobile: compact trailing info under the title. */}
        <div className="mt-1.5 flex items-center gap-2.5 sm:hidden">
          <PriorityFlag priority={view.priority} t={t} />
          <DueChip view={view} t={t} />
          <AssigneeStack people={view.assignees} t={t} />
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-4 sm:flex">
        <span className="w-24">
          <PriorityFlag priority={view.priority} t={t} showLabel />
        </span>
        <span className="w-24">
          <DueChip view={view} t={t} />
        </span>
        <span className="flex w-20 justify-end">
          <AssigneeStack people={view.assignees} t={t} />
        </span>
      </div>
    </li>
  );
}

