"use client";

import { startTransition, useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, Play, Plus, Square, Timer, Trash2 } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { format } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { addManualTimeEntryAction, deleteTimeEntryAction, startTimer, stopTimer } from "@/server/use-cases/tasks";
import { taskHref } from "@/modules/tasks/logic";
import type { TaskActionState, TaskTimeEntry } from "@/modules/tasks/types";
import {
  formatClock,
  formatDuration,
  formatRiyadhDate,
  formatRiyadhTime,
  personName,
} from "./detail-format";
import { PersonAvatar } from "./person-avatar";

export function TaskTimeTracker({
  taskId,
  runningEntry,
  otherRunning,
  entries,
  loggedMinutes,
  estimateMinutes,
  canTrack,
  showAll,
  viewerId,
  todayYmd,
  nowIso,
}: {
  taskId: string;
  runningEntry: Pick<TaskTimeEntry, "id" | "started_at"> | null;
  /** The viewer's timer running on ANOTHER task, if any. */
  otherRunning: { taskId: string; title: string } | null;
  entries: TaskTimeEntry[];
  loggedMinutes: number;
  estimateMinutes: number | null;
  canTrack: boolean;
  /** task.manage sees everyone's entries. */
  showAll: boolean;
  viewerId: string;
  todayYmd: string;
  nowIso: string;
}) {
  const { t, locale } = useI18n();
  const tt = t.tasksDetail.timer;
  const dur = t.tasksDetail.duration;

  const [startedAt, setOptimisticStartedAt] = useOptimistic<string | null>(runningEntry?.started_at ?? null);
  const running = startedAt !== null;
  const [toggling, startToggle] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => new Date(nowIso).getTime());

  useEffect(() => {
    if (!running) return;
    const tick = () => setNowMs(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [running]);

  const elapsedSec = startedAt !== null ? Math.max(0, (nowMs - new Date(startedAt).getTime()) / 1000) : 0;

  function toggle() {
    setToggleError(null);
    startToggle(async () => {
      if (running) {
        setOptimisticStartedAt(null);
        const res = await stopTimer(runningEntry?.id);
        if (!res?.ok) setToggleError(res?.message || t.tasks.messages.unexpected);
      } else {
        const iso = new Date().toISOString();
        setNowMs(Date.now());
        setOptimisticStartedAt(iso);
        const res = await startTimer(taskId);
        if (!res?.ok) setToggleError(res?.message || t.tasks.messages.unexpected);
      }
    });
  }

  // Total includes the live running time so the bar moves while the clock runs.
  const totalMinutes = loggedMinutes + (running && runningEntry ? Math.floor(elapsedSec / 60) : 0);
  const pct = estimateMinutes ? Math.min(100, Math.round((totalMinutes / estimateMinutes) * 100)) : 0;
  const over = Boolean(estimateMinutes && totalMinutes > estimateMinutes);

  return (
    <section className="mt-surface overflow-hidden" aria-labelledby="task-timer-title" data-testid="task-time-tracker">
      <div className={cn("p-4 transition-colors", running && "bg-primary-soft/50")}>
        <div className="flex items-center justify-between gap-2">
          <h2 id="task-timer-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Timer aria-hidden className="h-4 w-4 text-muted" />
            {tt.title}
          </h2>
          <span className={cn("inline-flex items-center gap-1.5 text-xs", running ? "text-primary" : "text-muted")}>
            <span
              aria-hidden
              className={cn("h-2 w-2 rounded-full", running ? "animate-pulse bg-primary" : "bg-border-strong")}
            />
            {running ? tt.running : tt.idle}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <p
            className={cn(
              "min-w-0 flex-1 font-mono text-[2rem] font-semibold leading-none tracking-tight tabular-nums",
              running ? "text-ink" : "text-muted",
            )}
            dir="ltr"
            aria-live="off"
            role="timer"
            aria-label={running ? tt.running : tt.idle}
          >
            {formatClock(elapsedSec)}
          </p>
          {canTrack ? (
            <button
              type="button"
              onClick={toggle}
              disabled={toggling}
              data-testid="task-timer-toggle"
              aria-pressed={running}
              aria-label={running ? tt.stop : tt.start}
              className={cn(
                "inline-flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-sm transition-[background-color,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/40 disabled:opacity-70",
                running
                  ? "bg-danger-solid text-white hover:bg-danger-solid/90"
                  : "bg-primary text-primary-foreground hover:bg-primary-hover",
              )}
            >
              {running ? (
                <Square aria-hidden className="h-4 w-4" fill="currentColor" />
              ) : (
                <Play aria-hidden className="h-4 w-4 rtl:-scale-x-100" fill="currentColor" />
              )}
              {running ? tt.stop : tt.start}
            </button>
          ) : null}
        </div>
        {running && startedAt ? (
          <p className="mt-2 text-xs text-muted">{format(tt.startedAt, { time: formatRiyadhTime(startedAt, locale) })}</p>
        ) : null}
        {!running && otherRunning && canTrack ? (
          <p className="mt-3 rounded-[var(--radius-control)] border border-warning-border bg-warning-soft px-3 py-2 text-xs text-warning">
            {format(tt.otherRunning, { title: otherRunning.title })}{" "}
            <Link href={taskHref(otherRunning.taskId)} className="font-medium underline">
              {tt.openOther}
            </Link>
          </p>
        ) : null}
        {!canTrack ? <p className="mt-3 text-xs text-muted">{tt.noPermission}</p> : null}
        {toggleError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {toggleError}
          </p>
        ) : null}
      </div>

      <div className="border-t border-line p-4">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted">{tt.total}</span>
          <span className={cn("font-semibold tabular-nums", over ? "text-danger" : "text-ink")}>
            {formatDuration(totalMinutes, dur)}
            {estimateMinutes ? (
              <span className="font-normal text-muted"> / {formatDuration(estimateMinutes, dur)}</span>
            ) : null}
          </span>
        </div>
        {estimateMinutes ? (
          <>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-strong"
              role="progressbar"
              aria-label={tt.total}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className={cn("h-full rounded-full transition-[width] duration-500", over ? "bg-danger" : "bg-primary")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className={cn("mt-1.5 text-xs", over ? "text-danger" : "text-muted")}>
              {over
                ? format(tt.overEstimate, { d: formatDuration(totalMinutes - estimateMinutes, dur) })
                : format(tt.remaining, { d: formatDuration(estimateMinutes - totalMinutes, dur) })}
            </p>
          </>
        ) : null}
      </div>

      {canTrack ? <ManualEntryForm taskId={taskId} todayYmd={todayYmd} /> : null}

      <EntriesList entries={entries} showAll={showAll} viewerId={viewerId} />
    </section>
  );
}

function ManualEntryForm({ taskId, todayYmd }: { taskId: string; todayYmd: string }) {
  const { t } = useI18n();
  const tt = t.tasksDetail.timer;
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<TaskActionState, FormData>(async (prev, fd) => {
    const res = await addManualTimeEntryAction(prev, fd);
    if (res?.ok) formRef.current?.reset();
    return res;
  }, null);

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="task-manual-time"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
      >
        <span className="flex items-center gap-2">
          <Plus aria-hidden className="h-4 w-4 text-muted" />
          {tt.manualTitle}
        </span>
        <ChevronDown aria-hidden className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <form
          id="task-manual-time"
          ref={formRef}
          className="mt-pop-in space-y-3 px-4 pb-4"
          data-testid="task-manual-time-form"
          aria-busy={pending}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => action(fd));
          }}
        >
          <input type="hidden" name="taskId" value={taskId} />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">{tt.date}</span>
            <Input type="date" name="date" defaultValue={todayYmd} max={todayYmd} required className="h-9 md:h-9" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">{tt.hours}</span>
              <Input type="number" name="hours" min={0} max={24} inputMode="numeric" placeholder="0" className="h-9 md:h-9" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">{tt.minutes}</span>
              <Input type="number" name="minutes" min={0} max={1440} inputMode="numeric" placeholder="0" className="h-9 md:h-9" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">{tt.note}</span>
            <Input name="note" maxLength={1000} placeholder={tt.notePlaceholder} dir="auto" className="h-9 md:h-9" />
          </label>
          <Button type="submit" variant="secondary" disabled={pending} className="w-full">
            {tt.add}
          </Button>
          {state && !state.ok && state.message ? (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function EntriesList({ entries, showAll, viewerId }: { entries: TaskTimeEntry[]; showAll: boolean; viewerId: string }) {
  const { t, locale } = useI18n();
  const tt = t.tasksDetail.timer;
  const [pending, startDelete] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function remove(entryId: string) {
    setError(null);
    setBusyId(entryId);
    startDelete(async () => {
      const fd = new FormData();
      fd.set("entryId", entryId);
      const res = await deleteTimeEntryAction(null, fd);
      if (!res?.ok) setError(res?.message || t.tasks.messages.unexpected);
      setBusyId(null);
    });
  }

  return (
    <div className="border-t border-line p-4" data-testid="task-time-entries">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{showAll ? tt.entriesAll : tt.entries}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{tt.noEntries}</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {entries.map((e) => {
            const mine = e.profile_id === viewerId;
            const name = mine ? t.tasksDetail.you : personName(e.person, locale, t.tasksDetail.unknownPerson);
            const isRunning = e.ended_at === null;
            return (
              <li
                key={e.id}
                className={cn(
                  "group flex items-start gap-2.5 rounded-[var(--radius-control)] px-1.5 py-1.5 hover:bg-surface-muted",
                  busyId === e.id && "opacity-50",
                )}
              >
                {showAll ? (
                  <PersonAvatar
                    name={personName(e.person, locale, t.tasksDetail.unknownPerson)}
                    seed={e.profile_id}
                    size="sm"
                    className="mt-0.5"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-ink">
                      {showAll ? <span className="font-medium" dir="auto">{name} · </span> : null}
                      <span className="text-muted">{formatRiyadhDate(e.started_at, locale)}</span>
                    </span>
                    {isRunning ? (
                      <span className="shrink-0 text-xs font-medium text-primary">{tt.runningEntry}</span>
                    ) : (
                      <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
                        {formatDuration(e.minutes ?? 0, t.tasksDetail.duration)}
                      </span>
                    )}
                  </div>
                  {e.note ? (
                    <p className="mt-0.5 break-words text-xs text-muted" dir="auto">
                      {e.note}
                    </p>
                  ) : null}
                </div>
                {mine && !isRunning ? (
                  <button
                    type="button"
                    onClick={() => remove(e.id)}
                    disabled={pending}
                    aria-label={tt.deleteEntry}
                    title={tt.deleteEntry}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-60 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
