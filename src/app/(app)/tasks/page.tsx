import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, KanbanSquare, List } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TaskRepository } from "@/server/repositories/task.repository";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";
import { addDaysYmd, todayInRiyadh } from "@/lib/time/riyadh";
import { parseTaskFilters } from "@/modules/tasks/schemas";
import { calendarGridRange, compareTasks } from "@/modules/tasks/logic";
import type { TaskFilters as TaskFilterInput, TaskList, TaskListItem, TaskSpace } from "@/modules/tasks/types";
import {
  buildTaskViews,
  DUE_FILTERS,
  pickWorkspaceParams,
  tasksHref,
  WORKSPACE_SORTS,
  WORKSPACE_VIEWS,
  type DueFilter,
  type ListMeta,
  type WorkspaceSort,
  type WorkspaceView,
} from "@/components/tasks/workspace/model";
import {
  WorkspacePanel,
  type PanelSelection,
  type PanelSpace,
} from "@/components/tasks/workspace/workspace-panel";
import { TaskFilters } from "@/components/tasks/workspace/task-filters";
import { QuickAdd, type QuickAddListOption } from "@/components/tasks/workspace/quick-add";
import { TaskListView } from "@/components/tasks/workspace/list-view";
import { TaskBoardView } from "@/components/tasks/workspace/board-view";
import { TaskCalendarView } from "@/components/tasks/workspace/calendar-view";
import { SpaceDot } from "@/components/tasks/workspace/task-bits";

const OPEN_LIMIT = 300;
const CLOSED_LIMIT = 150;

type SearchParams = Record<string, string | string[] | undefined>;

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Saturday-first week containing `today` (Saudi convention). */
function weekRange(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const from = addDaysYmd(today, -((dow - 6 + 7) % 7));
  return { from, to: addDaysYmd(from, 6) };
}

function parseMonth(value: string | undefined, today: string): { year: number; month: number } {
  const m = value?.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) return { year, month };
  }
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

function monthParam(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { t, locale } = await getI18n();
  const tw = t.tasksWorkspace;

  if (!hasPermission(ctx, "task.read")) {
    return (
      <PageContainer data-testid="tasks-page">
        <PageHeader title={t.tasks.title} />
        <EmptyState title={tw.forbiddenTitle} description={tw.forbiddenDescription} />
      </PageContainer>
    );
  }

  const raw = await searchParams;
  const params = pickWorkspaceParams(raw);
  const view = oneOf<WorkspaceView>(params.view, WORKSPACE_VIEWS, "list");
  const sort = oneOf<WorkspaceSort>(params.sort, WORKSPACE_SORTS, "manual");
  const due = params.due && (DUE_FILTERS as readonly string[]).includes(params.due) ? (params.due as DueFilter) : null;
  const me = ctx.profile.id;
  const orgId = ctx.organization.id;
  const canCreate = hasPermission(ctx, "task.create");
  const canManage = hasPermission(ctx, "task.manage");
  const today = todayInRiyadh();

  const supabase = await createServerSupabaseClient();
  const repo = new TaskRepository(supabase);

  // ---- filters -------------------------------------------------------------
  const filters: TaskFilterInput = parseTaskFilters(raw, me);
  if (view !== "calendar") {
    if (due === "overdue") filters.overdueOnly = true;
    else if (due === "today") {
      filters.dueFrom = today;
      filters.dueTo = today;
    } else if (due === "week") {
      const week = weekRange(today);
      filters.dueFrom = week.from;
      filters.dueTo = week.to;
    }
  }
  // "My tasks" / a person's tasks include subtasks assigned to them.
  if (filters.assigneeId) filters.includeSubtasks = true;
  const wantClosed = view === "board" || filters.includeClosed === true;

  const { year, month } = parseMonth(params.month, today);
  const grid = view === "calendar" ? calendarGridRange(year, month) : null;

  async function loadTasks(): Promise<{ rows: TaskListItem[]; truncated: boolean }> {
    if (grid) {
      const { dueFrom: _f, dueTo: _t, overdueOnly: _o, ...rest } = filters;
      void _f;
      void _t;
      void _o;
      const rows = await repo.listCalendarTasks(orgId, grid.from, grid.to, rest);
      return { rows, truncated: rows.length >= 1000 };
    }
    if (filters.status?.length || !wantClosed) {
      const rows = await repo.listTasks(orgId, { ...filters, limit: OPEN_LIMIT });
      return { rows, truncated: rows.length >= OPEN_LIMIT };
    }
    // Open and closed are fetched separately so a long done history never crowds out open work.
    const [open, closed] = await Promise.all([
      repo.listTasks(orgId, { ...filters, includeClosed: false, limit: OPEN_LIMIT }),
      repo.listTasks(orgId, { ...filters, status: ["done", "cancelled"], limit: CLOSED_LIMIT }),
    ]);
    return { rows: [...open, ...closed], truncated: open.length >= OPEN_LIMIT || closed.length >= CLOSED_LIMIT };
  }

  const [tree, members, loaded] = await Promise.all([
    repo.listSpacesTree(orgId),
    repo.listMembers(orgId),
    loadTasks(),
  ]);

  let rows = loaded.rows;
  if (due === "none" && view !== "calendar") rows = rows.filter((r) => !r.due_at);

  // ---- selection (list / space / my / all) --------------------------------
  const listsById = new Map<string, { list: TaskList; space: TaskSpace }>();
  for (const space of tree) for (const list of space.lists) listsById.set(list.id, { list, space });

  let currentList: { list: TaskList; space: TaskSpace } | null = null;
  let listMissing = false;
  if (filters.listId) {
    currentList = listsById.get(filters.listId) ?? null;
    if (!currentList) {
      const list = await repo.getList(orgId, filters.listId);
      const space = list ? await repo.getSpace(orgId, list.space_id) : null;
      if (list && space) {
        currentList = { list, space };
        listsById.set(list.id, currentList);
      } else listMissing = true;
    }
  }
  const currentSpace: TaskSpace | null = currentList
    ? currentList.space
    : filters.spaceId
      ? (tree.find((s) => s.id === filters.spaceId) ?? (await repo.getSpace(orgId, filters.spaceId)))
      : null;

  const selection: PanelSelection = filters.listId
    ? { kind: "list", id: filters.listId }
    : filters.spaceId
      ? { kind: "space", id: filters.spaceId }
      : params.assignee === "me"
        ? { kind: "my" }
        : { kind: "all" };
  const scopeKey = `${selection.kind}:${selection.id ?? ""}`;

  // ---- view models ---------------------------------------------------------
  const listMeta = new Map<string, ListMeta>();
  for (const { list, space } of listsById.values()) {
    listMeta.set(list.id, {
      name: pickLocalized(locale, list.name_ar, list.name_en),
      projectId: list.project_id,
      color: space.color,
    });
  }

  if (view === "list") {
    if (sort === "updated") rows = [...rows].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    else rows = [...rows].sort(compareTasks(sort));
  } else {
    rows = [...rows].sort(compareTasks("manual"));
  }

  const views = buildTaskViews(rows, {
    locale,
    t,
    lists: listMeta,
    showListName: selection.kind !== "list",
    viewer: { userId: me, canCreate, canManage },
  });

  // ---- panel ---------------------------------------------------------------
  const panelSpaces: PanelSpace[] = tree.map((space) => ({
    id: space.id,
    name:
      pickLocalized(locale, space.name_ar, space.name_en) ||
      (space.system_key ? t.tasks.systemSpace[space.system_key] : ""),
    color: space.color,
    isSystem: Boolean(space.system_key),
    openCount: space.open_count,
    canCreateList: canCreate && space.system_key !== "projects",
    canArchive: canManage && !space.system_key,
    lists: space.lists.map((list) => ({
      id: list.id,
      name: pickLocalized(locale, list.name_ar, list.name_en),
      openCount: list.open_count,
      isProject: Boolean(list.project_id),
      canArchive: canCreate && !list.project_id && !list.system_key && (canManage || list.created_by === me),
    })),
  }));

  // ---- quick add -----------------------------------------------------------
  const quickAddLists: QuickAddListOption[] = tree
    .filter((space) => !currentSpace || space.id === currentSpace.id)
    .flatMap((space) =>
      space.lists.map((list) => ({
        id: list.id,
        name: pickLocalized(locale, list.name_ar, list.name_en),
        group: pickLocalized(locale, space.name_ar, space.name_en),
      })),
    );
  const fixedListId = currentList && !currentList.list.is_archived ? currentList.list.id : null;
  const showQuickAdd = canCreate && !listMissing && !(currentList && currentList.list.is_archived);

  // ---- header --------------------------------------------------------------
  const spaceName = currentSpace ? pickLocalized(locale, currentSpace.name_ar, currentSpace.name_en) : null;
  const listName = currentList ? pickLocalized(locale, currentList.list.name_ar, currentList.list.name_en) : null;
  const title = listName ?? spaceName ?? (selection.kind === "my" ? t.tasks.myTasks : tw.header.allTitle);
  const description = listMissing
    ? tw.header.listMissing
    : currentList
      ? undefined
      : currentSpace
        ? format(tw.header.spaceDescription, {
            count: tree.find((s) => s.id === currentSpace.id)?.lists.length ?? 0,
          })
        : selection.kind === "my"
          ? tw.header.myDescription
          : tw.header.allDescription;

  const filtered = Boolean(params.assignee || params.status || params.priority || params.due || params.q);
  const viewHref = (v: WorkspaceView) =>
    tasksHref(params, { view: v === "list" ? null : v, month: v === "calendar" ? params.month : null });
  const Crumb = locale === "ar" ? ChevronLeft : ChevronRight;

  const viewIcons = { list: List, board: KanbanSquare, calendar: CalendarDays } as const;

  return (
    <PageContainer data-testid="tasks-page" className="lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:items-start lg:gap-5">
      <WorkspacePanel
        spaces={panelSpaces}
        selection={selection}
        view={view}
        canManage={canManage}
        myOpenCount={null}
      />

      <div className="min-w-0 space-y-4">
        <nav aria-label={tw.header.root} className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <Link href={tasksHref({}, { view: params.view ?? null })} className="hover:text-primary">
            {tw.header.root}
          </Link>
          {currentSpace ? (
            <>
              <Crumb className="size-3" aria-hidden />
              {currentList ? (
                <Link
                  href={tasksHref({}, { space: currentSpace.id, view: params.view ?? null })}
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                >
                  <SpaceDot color={currentSpace.color} className="size-2" />
                  <span dir="auto">{spaceName}</span>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <SpaceDot color={currentSpace.color} className="size-2" />
                  <span dir="auto">{spaceName}</span>
                </span>
              )}
            </>
          ) : null}
          {listName ? (
            <>
              <Crumb className="size-3" aria-hidden />
              <span className="text-ink" dir="auto">
                {listName}
              </span>
            </>
          ) : null}
        </nav>

        <PageHeader
          title={title}
          description={description ?? tw.description}
          meta={
            currentList && (currentList.list.is_archived || currentList.list.project_id) ? (
              <span className="flex flex-wrap items-center gap-2">
                {currentList.list.is_archived ? <Badge tone="warning">{tw.header.archived}</Badge> : null}
                {currentList.list.project_id ? (
                  <>
                    <Badge tone="info">{tw.header.projectList}</Badge>
                    <Link
                      href={`/projects/${currentList.list.project_id}`}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      {tw.header.openProject}
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  </>
                ) : null}
              </span>
            ) : undefined
          }
          actions={
            <nav
              aria-label={tw.viewsAria}
              className="inline-flex rounded-[var(--radius-control)] border border-line bg-surface-muted p-0.5"
            >
              {WORKSPACE_VIEWS.map((v) => {
                const Icon = viewIcons[v];
                const active = v === view;
                return (
                  <Link
                    key={v}
                    href={viewHref(v)}
                    aria-current={active ? "page" : undefined}
                    data-testid={`tasks-view-switch-${v}`}
                    className={cn(
                      "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-3 text-sm duration-150 transition-colors",
                      active ? "bg-surface font-medium text-ink shadow-card" : "text-muted hover:text-ink",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {t.tasks.views[v]}
                  </Link>
                );
              })}
            </nav>
          }
        />

        <TaskFilters key={`filters-${scopeKey}`} params={params} members={members} view={view} />

        {showQuickAdd ? (
          quickAddLists.length > 0 || fixedListId ? (
            <QuickAdd
              key={`quick-${scopeKey}`}
              fixedListId={fixedListId}
              listOptions={quickAddLists}
              members={members}
              defaultAssigneeId={selection.kind === "my" || params.assignee === "me" ? me : null}
            />
          ) : (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line px-4 py-3 text-sm text-muted">
              {tw.quickAdd.noList}
            </p>
          )
        ) : null}

        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>{format(tw.resultsCount, { count: views.length })}</span>
          {loaded.truncated ? <span>{format(tw.limitNote, { count: rows.length })}</span> : null}
        </div>

        {view === "list" ? (
          <TaskListView views={views} t={t} filtered={filtered} showClosed={filters.includeClosed === true} />
        ) : view === "board" ? (
          <TaskBoardView key={`board-${scopeKey}`} views={views} />
        ) : grid ? (
          <TaskCalendarView
            views={views}
            days={grid.days}
            year={year}
            month={month}
            today={today}
            prevHref={tasksHref(params, { month: monthParam(year, month - 1) })}
            nextHref={tasksHref(params, { month: monthParam(year, month + 1) })}
            todayHref={tasksHref(params, { month: null })}
            locale={locale}
            t={t}
          />
        ) : null}
      </div>
    </PageContainer>
  );
}
