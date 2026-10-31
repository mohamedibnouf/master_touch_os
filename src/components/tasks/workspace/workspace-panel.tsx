"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ChevronDown,
  FolderTree,
  Inbox,
  LayoutList,
  Lock,
  MoreHorizontal,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { archiveListAction, archiveSpaceAction, createListAction, createSpaceAction } from "@/server/use-cases/tasks";
import type { TaskActionState } from "@/modules/tasks/types";
import { tasksHref, type WorkspaceView } from "./model";
import { SpaceDot } from "./task-bits";

export type PanelList = { id: string; name: string; openCount: number; canArchive: boolean; isProject: boolean };
export type PanelSpace = {
  id: string;
  name: string;
  color: string;
  isSystem: boolean;
  openCount: number;
  canCreateList: boolean;
  canArchive: boolean;
  lists: PanelList[];
};
export type PanelSelection = { kind: "my" | "all" | "space" | "list"; id?: string | null };

/**
 * Left panel: My tasks / All tasks, then spaces → lists with open counts. A drawer below the
 * `lg` breakpoint. Managers create / archive spaces; task.create users create lists.
 */
export function WorkspacePanel({
  spaces,
  selection,
  view,
  canManage,
  myOpenCount,
}: {
  spaces: PanelSpace[];
  selection: PanelSelection;
  view: WorkspaceView;
  canManage: boolean;
  myOpenCount: number | null;
}) {
  const { t } = useI18n();
  const tp = t.tasksWorkspace.panel;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [creatingSpace, setCreatingSpace] = useState(false);
  const viewParam = view === "list" ? null : view;
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleSpace = (id: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const navCls = (active: boolean) =>
    cn(
      "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm duration-150 transition-colors",
      active ? "bg-primary-soft font-medium text-primary" : "text-ink hover:bg-surface-muted",
    );

  const panel = (
    <nav aria-label={tp.aria} className="flex h-full flex-col gap-4">
      <div className="space-y-0.5">
        <Link
          href={tasksHref({}, { assignee: "me", view: viewParam })}
          onClick={close}
          aria-current={selection.kind === "my" ? "page" : undefined}
          className={navCls(selection.kind === "my")}
          data-testid="tasks-nav-my"
        >
          <UserRound className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">{t.tasks.myTasks}</span>
          {myOpenCount !== null && myOpenCount > 0 ? (
            <span className="text-xs tabular-nums text-muted">{myOpenCount}</span>
          ) : null}
        </Link>
        <Link
          href={tasksHref({}, { view: viewParam })}
          onClick={close}
          aria-current={selection.kind === "all" ? "page" : undefined}
          className={navCls(selection.kind === "all")}
          data-testid="tasks-nav-all"
        >
          <Inbox className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">{tp.allTasks}</span>
        </Link>
      </div>

      <div className="min-h-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tp.spaces}</p>
          {canManage ? (
            <button
              type="button"
              onClick={() => setCreatingSpace((v) => !v)}
              aria-expanded={creatingSpace}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-ink"
              title={tp.newSpace}
              aria-label={tp.newSpace}
              data-testid="tasks-new-space"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        {creatingSpace ? <CreateSpaceForm onDone={() => setCreatingSpace(false)} /> : null}

        {spaces.length === 0 ? <p className="px-2.5 py-2 text-sm text-muted">{tp.noSpaces}</p> : null}

        <ul className="space-y-1">
          {spaces.map((space) => {
            const expanded = !collapsed.has(space.id);
            const spaceActive = selection.kind === "space" && selection.id === space.id;
            return (
              <li key={space.id} data-testid="tasks-space">
                <div className={cn("group flex items-center gap-1 rounded-lg", spaceActive && "bg-primary-soft")}>
                  <button
                    type="button"
                    onClick={() => toggleSpace(space.id)}
                    aria-expanded={expanded}
                    aria-label={format(tp.toggleSpace, { name: space.name })}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-muted"
                  >
                    <ChevronDown
                      className={cn(
                        "size-3.5 duration-150 transition-transform",
                        !expanded && "ltr:-rotate-90 rtl:rotate-90",
                      )}
                      aria-hidden
                    />
                  </button>
                  <Link
                    href={tasksHref({}, { space: space.id, view: viewParam })}
                    onClick={close}
                    aria-current={spaceActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-8 min-w-0 flex-1 items-center gap-2 py-1 text-sm font-medium",
                      spaceActive ? "text-primary" : "text-ink hover:text-primary",
                    )}
                  >
                    <SpaceDot color={space.color} />
                    <span className="truncate" dir="auto">
                      {space.name}
                    </span>
                    {space.isSystem ? (
                      <Lock className="size-3 shrink-0 text-muted" aria-label={tp.systemSpaceHint} />
                    ) : null}
                  </Link>
                  {space.openCount > 0 ? (
                    <span className="pe-1 text-xs tabular-nums text-muted">{space.openCount}</span>
                  ) : null}
                  {space.canArchive ? (
                    <ItemMenu
                      label={format(tp.moreActions, { name: space.name })}
                      archive={{ kind: "space", id: space.id, confirm: tp.archiveSpaceConfirm, label: tp.archiveSpace }}
                    />
                  ) : null}
                </div>
                {expanded ? (
                  <ul className="ms-3.5 mt-0.5 space-y-0.5 border-s border-line ps-2">
                    {space.lists.length === 0 ? (
                      <li className="px-2 py-1 text-xs text-muted">{tp.noLists}</li>
                    ) : null}
                    {space.lists.map((list) => {
                      const active = selection.kind === "list" && selection.id === list.id;
                      return (
                        <li key={list.id} className="group/list flex items-center gap-1">
                          <Link
                            href={tasksHref({}, { list: list.id, view: viewParam })}
                            onClick={close}
                            aria-current={active ? "page" : undefined}
                            className={cn(navCls(active), "min-h-8 flex-1 py-1 text-[13px]")}
                            data-testid="tasks-list-link"
                          >
                            {list.isProject ? (
                              <FolderTree className="size-3.5 shrink-0 text-muted" aria-hidden />
                            ) : (
                              <LayoutList className="size-3.5 shrink-0 text-muted" aria-hidden />
                            )}
                            <span className="flex-1 truncate" dir="auto">
                              {list.name}
                            </span>
                            {list.openCount > 0 ? (
                              <span
                                className="text-xs tabular-nums text-muted"
                                title={format(tp.openCount, { count: list.openCount })}
                              >
                                {list.openCount}
                              </span>
                            ) : null}
                          </Link>
                          {list.canArchive ? (
                            <ItemMenu
                              label={format(tp.moreActions, { name: list.name })}
                              archive={{ kind: "list", id: list.id, confirm: tp.archiveListConfirm, label: tp.archiveList }}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                    {space.canCreateList ? <CreateListInline spaceId={space.id} /> : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="tasks-workspace-panel"
        className="mb-3 inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-medium text-ink shadow-card hover:bg-surface-muted lg:hidden"
        data-testid="tasks-panel-open"
      >
        <FolderTree className="size-4 text-muted" aria-hidden />
        {tp.open}
      </button>

      {open ? (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" aria-hidden onClick={close} />
      ) : null}

      <aside
        id="tasks-workspace-panel"
        className={cn(
          "lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:rounded-[var(--radius-card,0.875rem)] lg:border lg:border-line lg:bg-surface lg:p-3 lg:shadow-card",
          open
            ? "max-lg:fixed max-lg:inset-y-0 max-lg:start-0 max-lg:z-50 max-lg:w-[18rem] max-lg:max-w-[85vw] max-lg:overflow-y-auto max-lg:border-e max-lg:border-line max-lg:bg-surface max-lg:p-3 max-lg:pt-[max(0.75rem,env(safe-area-inset-top))] max-lg:shadow-[var(--shadow-2)]"
            : "max-lg:hidden",
        )}
      >
        {open ? (
          <div className="mb-2 flex justify-end lg:hidden">
            <button
              type="button"
              onClick={close}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-ink"
              aria-label={tp.close}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ) : null}
        {panel}
      </aside>
    </>
  );
}

function ItemMenu({
  label,
  archive,
}: {
  label: string;
  archive: { kind: "space" | "list"; id: string; confirm: string; label: string };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const doArchive = () => {
    if (!window.confirm(archive.confirm)) return;
    const fd = new FormData();
    fd.set(archive.kind === "space" ? "spaceId" : "listId", archive.id);
    startTransition(async () => {
      const res =
        archive.kind === "space" ? await archiveSpaceAction(null, fd) : await archiveListAction(null, fd);
      if (!res?.ok) setError(res?.message || t.tasksWorkspace.actionFailed);
      else router.refresh();
    });
  };

  return (
    <details className="relative">
      <summary
        className="inline-flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted opacity-70 hover:bg-surface-muted hover:text-ink hover:opacity-100 [&::-webkit-details-marker]:hidden"
        aria-label={label}
        title={label}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </summary>
      <div className="mt-pop-in absolute end-0 z-30 mt-1 w-48 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-2)]">
        <button
          type="button"
          onClick={doArchive}
          disabled={pending}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm text-danger hover:bg-danger-soft disabled:opacity-50"
        >
          <Archive className="size-4" aria-hidden />
          {archive.label}
        </button>
        {error ? (
          <p role="alert" className="px-2.5 py-1.5 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function CreateListInline({ spaceId }: { spaceId: string }) {
  const { t } = useI18n();
  const tl = t.tasksWorkspace.listForm;
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<TaskActionState, FormData>(createListAction, null);
  const [handled, setHandled] = useState<TaskActionState>(null);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setEditing(false);
  }

  if (!editing) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] text-muted hover:bg-surface-muted hover:text-ink"
          data-testid="tasks-new-list"
        >
          <Plus className="size-3.5" aria-hidden />
          {t.tasksWorkspace.panel.newList}
        </button>
      </li>
    );
  }
  return (
    <li>
      <form action={formAction} className="mt-pop-in space-y-1.5 rounded-lg border border-line bg-surface-muted/60 p-2">
        <input type="hidden" name="spaceId" value={spaceId} />
        <input
          name="nameAr"
          required
          maxLength={160}
          autoFocus
          placeholder={tl.nameAr}
          aria-label={tl.nameAr}
          dir="auto"
          className="h-8 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus-visible:border-primary"
        />
        <input
          name="nameEn"
          maxLength={160}
          placeholder={tl.nameEn}
          aria-label={tl.nameEn}
          dir="ltr"
          className="h-8 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus-visible:border-primary"
        />
        {state && !state.ok && state.message ? (
          <p role="alert" className="text-xs text-danger">
            {state.message}
          </p>
        ) : null}
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-7 rounded-md px-2 text-xs text-muted hover:bg-surface hover:text-ink"
          >
            {tl.cancel}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {tl.submit}
          </button>
        </div>
      </form>
    </li>
  );
}

const SPACE_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

function CreateSpaceForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const ts = t.tasksWorkspace.spaceForm;
  const [state, formAction, pending] = useActionState<TaskActionState, FormData>(createSpaceAction, null);
  const [color, setColor] = useState(SPACE_COLORS[0]);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form
      action={formAction}
      className="mt-pop-in mb-3 space-y-2 rounded-xl border border-line bg-surface-muted/60 p-2.5"
      data-testid="tasks-space-form"
    >
      <p className="text-xs font-semibold text-ink">{ts.title}</p>
      <input
        name="nameAr"
        required
        maxLength={120}
        autoFocus
        placeholder={ts.nameAr}
        aria-label={ts.nameAr}
        dir="rtl"
        className="h-8 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus-visible:border-primary"
      />
      <input
        name="nameEn"
        required
        maxLength={120}
        placeholder={ts.nameEn}
        aria-label={ts.nameEn}
        dir="ltr"
        className="h-8 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus-visible:border-primary"
      />
      <fieldset>
        <legend className="mb-1 text-xs text-muted">{ts.color}</legend>
        <input type="hidden" name="color" value={color} />
        <div className="flex flex-wrap gap-1.5">
          {SPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              aria-label={c}
              className={cn(
                "size-6 rounded-md ring-offset-2 ring-offset-surface duration-150 transition-shadow",
                color === c ? "ring-2 ring-ink" : "ring-1 ring-black/10",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </fieldset>
      {state && !state.ok && state.message ? (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onDone}
          className="h-8 rounded-md px-2.5 text-xs text-muted hover:bg-surface hover:text-ink"
        >
          {ts.cancel}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {ts.submit}
        </button>
      </div>
    </form>
  );
}
