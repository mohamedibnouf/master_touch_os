"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { pickLocalized } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/modules/tasks/types";
import type { TaskMemberOption } from "@/modules/tasks/types";
import { tasksHref, type WorkspaceParamKey, type WorkspaceParams, type WorkspaceView } from "./model";

const FILTER_KEYS: WorkspaceParamKey[] = ["assignee", "status", "priority", "due", "q", "sort", "closed"];

const selectCls =
  "h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-sm text-ink outline-none hover:border-border-strong focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25";

/**
 * Filter bar: every value lives in the URL (shareable links). Selects apply immediately;
 * the search box applies after a short pause or on Enter.
 */
export function TaskFilters({
  params,
  members,
  view,
}: {
  params: WorkspaceParams;
  members: TaskMemberOption[];
  view: WorkspaceView;
}) {
  const { t, locale } = useI18n();
  const tf = t.tasksWorkspace.filters;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? "");
  const [pushedQ, setPushedQ] = useState(params.q ?? "");
  // Follow external URL changes (sidebar links, "clear") without clobbering what is being typed.
  const urlQ = params.q ?? "";
  const [seenQ, setSeenQ] = useState(urlQ);
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    if (urlQ !== pushedQ) {
      setQ(urlQ);
      setPushedQ(urlQ);
    }
  }

  const push = (overrides: Partial<Record<WorkspaceParamKey, string | null>>) => {
    const href = tasksHref(params, overrides);
    startTransition(() => router.replace(href, { scroll: false }));
  };

  // Debounced search.
  useEffect(() => {
    const value = q.trim();
    if (value === pushedQ) return;
    const timer = window.setTimeout(() => {
      setPushedQ(value);
      startTransition(() => router.replace(tasksHref(params, { q: value || null }), { scroll: false }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [q, pushedQ, params, router]);

  const active = FILTER_KEYS.some((k) => k !== "sort" && params[k]);
  const statusValue = params.status && !params.status.includes(",") ? params.status : "";

  return (
    <form
      role="search"
      aria-label={tf.aria}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        setPushedQ(q.trim());
        push({ q: q.trim() || null });
      }}
      className={cn("flex flex-wrap items-center gap-2 duration-150 transition-opacity", pending && "opacity-70")}
    >
      <div className="relative min-w-[12rem] flex-1 basis-56">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tf.search}
          aria-label={tf.search}
          className={cn(selectCls, "w-full ps-8")}
          data-testid="tasks-filter-search"
        />
      </div>

      <select
        aria-label={tf.assignee}
        value={params.assignee ?? ""}
        onChange={(e) => push({ assignee: e.target.value || null })}
        className={cn(selectCls, "basis-36")}
        data-testid="tasks-filter-assignee"
      >
        <option value="">{tf.anyAssignee}</option>
        <option value="me">{tf.me}</option>
        <option value="none">{tf.unassigned}</option>
        {members.map((m) => (
          <option key={m.profile_id} value={m.profile_id}>
            {pickLocalized(locale, m.full_name_ar, m.full_name_en)}
          </option>
        ))}
      </select>

      {view !== "board" ? (
        <select
          aria-label={tf.status}
          value={statusValue}
          onChange={(e) => push({ status: e.target.value || null })}
          className={cn(selectCls, "basis-32")}
          data-testid="tasks-filter-status"
        >
          <option value="">{tf.anyStatus}</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.tasks.status[s]}
            </option>
          ))}
        </select>
      ) : null}

      <select
        aria-label={tf.priority}
        value={params.priority && !params.priority.includes(",") ? params.priority : ""}
        onChange={(e) => push({ priority: e.target.value || null })}
        className={cn(selectCls, "basis-32")}
        data-testid="tasks-filter-priority"
      >
        <option value="">{tf.anyPriority}</option>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {t.tasks.priority[p]}
          </option>
        ))}
      </select>

      {view !== "calendar" ? (
        <select
          aria-label={tf.due}
          value={params.due ?? ""}
          onChange={(e) => push({ due: e.target.value || null })}
          className={cn(selectCls, "basis-32")}
          data-testid="tasks-filter-due"
        >
          <option value="">{tf.anyDue}</option>
          <option value="overdue">{tf.overdue}</option>
          <option value="today">{tf.today}</option>
          <option value="week">{tf.week}</option>
          <option value="none">{tf.noDate}</option>
        </select>
      ) : null}

      {view === "list" ? (
        <select
          aria-label={tf.sort}
          value={params.sort ?? "manual"}
          onChange={(e) => push({ sort: e.target.value === "manual" ? null : e.target.value })}
          className={cn(selectCls, "basis-32")}
          data-testid="tasks-filter-sort"
        >
          <option value="manual">
            {tf.sort}: {tf.sortManual}
          </option>
          <option value="due">
            {tf.sort}: {tf.sortDue}
          </option>
          <option value="priority">
            {tf.sort}: {tf.sortPriority}
          </option>
          <option value="updated">
            {tf.sort}: {tf.sortUpdated}
          </option>
        </select>
      ) : null}

      {view === "list" && !statusValue ? (
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm text-muted hover:text-ink">
          <input
            type="checkbox"
            checked={params.closed === "1"}
            onChange={(e) => push({ closed: e.target.checked ? "1" : null })}
            className="size-4 accent-[var(--primary)]"
          />
          {tf.showClosed}
        </label>
      ) : null}

      {active ? (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setPushedQ("");
            push({ assignee: null, status: null, priority: null, due: null, q: null, closed: null });
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-sm text-muted hover:bg-surface-muted hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
          {tf.clear}
        </button>
      ) : null}
    </form>
  );
}
