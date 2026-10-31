import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Info, Workflow } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { TaskActionsMenu } from "@/components/tasks/detail/task-actions-menu";
import { TaskAssignees } from "@/components/tasks/detail/task-assignees";
import { TaskComments } from "@/components/tasks/detail/task-comments";
import { TaskDescription } from "@/components/tasks/detail/task-description";
import { TaskMeta } from "@/components/tasks/detail/task-meta";
import { TaskPrioritySelect } from "@/components/tasks/detail/task-priority-select";
import { TaskProperties } from "@/components/tasks/detail/task-properties";
import { TaskStatusSelect } from "@/components/tasks/detail/task-status-select";
import { TaskSubtasks } from "@/components/tasks/detail/task-subtasks";
import { TaskTimeTracker } from "@/components/tasks/detail/task-time-tracker";
import { TaskTitleEditor } from "@/components/tasks/detail/task-title-editor";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { isPostgresUuid } from "@/lib/postgres-uuid";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { todayInRiyadh } from "@/lib/time/riyadh";
import { dueDayInRiyadh, isOverdue, splitMinutes, taskDisplayTitle } from "@/modules/tasks/logic";
import type { TaskMemberOption } from "@/modules/tasks/types";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { TaskRepository } from "@/server/repositories/task.repository";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.tasksDetail.metaTitle };
}

/** Request instant, taken once so every "now"-dependent value on the page agrees. */
function requestNow(): Date {
  return new Date();
}

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "task.read")) redirect("/");

  const { id } = await params;
  if (!isPostgresUuid(id)) notFound();

  const { t, locale } = await getI18n();
  const td = t.tasksDetail;
  const canCreate = hasPermission(ctx, "task.create");
  const canManage = hasPermission(ctx, "task.manage");

  const supabase = await createServerSupabaseClient();
  const repo = new TaskRepository(supabase);
  const detail = await repo.getTaskDetail(ctx.organization.id, id, {
    profileId: ctx.profile.id,
    canCreate,
    canManage,
  });
  if (!detail) notFound();

  const { task, list, space, parent, capabilities: caps } = detail;
  const [members, otherTimer] = await Promise.all([
    caps.canAssign ? repo.listMembers(ctx.organization.id) : Promise.resolve([] as TaskMemberOption[]),
    caps.canTrackTime && !detail.runningEntry
      ? repo.getRunningTimer(ctx.organization.id, ctx.profile.id)
      : Promise.resolve(null),
  ]);

  const now = requestNow();
  const nowIso = now.toISOString();
  const overdue = isOverdue(task, now);
  const title = taskDisplayTitle(task, locale) || td.untitled;
  const titleField = locale === "en" && task.title_en?.trim() ? "titleEn" : "title";
  const spaceName = pickLocalized(locale, space.name_ar, space.name_en);
  const listName = pickLocalized(locale, list.name_ar, list.name_en);
  const estimate = splitMinutes(task.estimate_minutes ?? 0);
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;

  const crumbs: Array<{ label: string; href: string }> = [
    { label: td.tasksRoot, href: "/tasks" },
    { label: spaceName, href: `/tasks?space=${space.id}` },
    { label: listName, href: `/tasks?list=${list.id}` },
  ];
  if (parent) crumbs.push({ label: taskDisplayTitle(parent, locale) || td.untitled, href: `/tasks/${parent.id}` });

  const afterDeleteHref = parent ? `/tasks/${parent.id}` : `/tasks?list=${list.id}`;
  const otherRunning =
    otherTimer && otherTimer.task_id !== task.id
      ? {
          taskId: otherTimer.task_id,
          title: taskDisplayTitle({ title: otherTimer.task_title, title_en: otherTimer.task_title_en }, locale),
        }
      : null;

  return (
    <PageContainer data-testid="task-detail">
      <nav aria-label={td.breadcrumbLabel} className="mb-3">
        <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((c, i) => (
            <li key={c.href} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <Chevron aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-60" /> : null}
              <Link
                href={c.href}
                className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded px-1 py-0.5 hover:bg-surface-muted hover:text-ink"
                dir="auto"
              >
                {i === 1 ? (
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: space.color }} />
                ) : null}
                <span className="truncate">{c.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <header className="mb-6 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <TaskTitleEditor
              taskId={task.id}
              title={title}
              field={titleField}
              canEdit={caps.canEdit && !caps.isAutoTask}
            />
          </div>
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            <TaskStatusSelect taskId={task.id} status={task.status} disabled={!caps.canChangeStatus} />
            <TaskPrioritySelect taskId={task.id} priority={task.priority} disabled={!caps.canEdit} />
            <TaskActionsMenu taskId={task.id} canDelete={caps.canDelete} afterDeleteHref={afterDeleteHref} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {caps.isAutoTask ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-info-border bg-info-soft px-2.5 py-1 font-medium text-primary"
              title={td.header.autoHint}
              data-testid="task-auto-badge"
            >
              <Workflow aria-hidden className="h-3.5 w-3.5" />
              {task.source === "approval_step" ? td.header.autoApproval : td.header.autoWorkflow}
            </span>
          ) : null}
          {overdue ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 font-medium text-danger">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-danger" />
              {td.overdue}
            </span>
          ) : null}
          {!caps.canEdit && !caps.canChangeStatus ? (
            <span className="rounded-full bg-surface-strong px-2.5 py-1 text-muted">{td.readOnly}</span>
          ) : null}
        </div>
        {caps.isAutoTask ? (
          <p className="flex max-w-3xl items-start gap-2 text-xs leading-relaxed text-muted">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {td.header.autoHint}
          </p>
        ) : null}
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-5">
          <TaskDescription taskId={task.id} description={task.description} canEdit={caps.canEdit} />
          {!task.parent_task_id ? (
            <TaskSubtasks
              taskId={task.id}
              subtasks={detail.subtasks}
              canAdd={canCreate && !list.is_archived}
              canToggle={caps.canChangeStatus}
              nowIso={nowIso}
            />
          ) : null}
          <TaskComments
            taskId={task.id}
            comments={detail.comments}
            canComment={caps.canComment}
            viewerId={ctx.profile.id}
            nowIso={nowIso}
          />
        </div>

        <aside className="min-w-0 space-y-5">
          <TaskTimeTracker
            taskId={task.id}
            runningEntry={detail.runningEntry ? { id: detail.runningEntry.id, started_at: detail.runningEntry.started_at } : null}
            otherRunning={otherRunning}
            entries={detail.timeEntries}
            loggedMinutes={detail.loggedMinutes}
            estimateMinutes={task.estimate_minutes}
            canTrack={caps.canTrackTime}
            showAll={canManage}
            viewerId={ctx.profile.id}
            todayYmd={todayInRiyadh(now)}
            nowIso={nowIso}
          />
          <TaskAssignees
            taskId={task.id}
            assignees={detail.assignees}
            members={members}
            canAssign={caps.canAssign}
            viewerId={ctx.profile.id}
          />
          <section className="mt-surface p-4" aria-labelledby="task-details-title">
            <h2 id="task-details-title" className="mb-4 text-sm font-semibold text-ink">
              {td.side.details}
            </h2>
            <TaskProperties
              taskId={task.id}
              initial={{
                startDate: task.start_date ?? "",
                dueDate: dueDayInRiyadh(task.due_at) ?? "",
                estimateHours: task.estimate_minutes ? String(estimate.hours) : "",
                estimateMinutes: task.estimate_minutes ? String(estimate.minutes) : "",
                points: String(task.points),
              }}
              dueAtIso={task.due_at}
              overdue={overdue}
              estimateTotal={task.estimate_minutes}
              loggedMinutes={detail.loggedMinutes}
              canEdit={caps.canEdit}
              dueLocked={caps.isAutoTask}
            />
            <div className="mt-5 border-t border-line pt-4">
              <TaskMeta detail={detail} t={t} locale={locale} />
            </div>
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}
