"use client";

import { startTransition, useActionState, useState } from "react";
import { CalendarClock, CalendarDays, Hourglass, Lock, Star } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { format } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { TaskActionState } from "@/modules/tasks/types";
import { formatDuration, formatRiyadhDate } from "./detail-format";
import { updateTaskFields } from "./update-task-fields";

type Initial = {
  startDate: string;
  dueDate: string;
  estimateHours: string;
  estimateMinutes: string;
  points: string;
};

function estimateFrom(h: string, m: string): string {
  if (h.trim() === "" && m.trim() === "") return "";
  const hours = Number.parseInt(h || "0", 10);
  const minutes = Number.parseInt(m || "0", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  return String(Math.max(0, hours) * 60 + Math.max(0, minutes));
}

/** Dates, estimate and points — one form that sends only the fields that changed. */
export function TaskProperties({
  taskId,
  initial,
  dueAtIso,
  overdue,
  estimateTotal,
  loggedMinutes,
  canEdit,
  dueLocked,
}: {
  taskId: string;
  initial: Initial;
  dueAtIso: string | null;
  overdue: boolean;
  estimateTotal: number | null;
  loggedMinutes: number;
  canEdit: boolean;
  /** Auto tasks: the due date comes from the stage / approval. */
  dueLocked: boolean;
}) {
  const { t, locale } = useI18n();
  const ts = t.tasksDetail.side;
  const [values, setValues] = useState<Initial>(initial);
  const [savedAt, setSavedAt] = useState(0);

  const [state, action, pending] = useActionState<TaskActionState, Initial>(async (_prev, v) => {
    const patch: Record<string, string> = {};
    if (v.startDate !== initial.startDate) patch.startDate = v.startDate;
    if (!dueLocked && v.dueDate !== initial.dueDate) patch.dueDate = v.dueDate;
    const est = estimateFrom(v.estimateHours, v.estimateMinutes);
    if (est !== estimateFrom(initial.estimateHours, initial.estimateMinutes)) patch.estimateMinutes = est;
    if (v.points.trim() !== "" && v.points !== initial.points) patch.points = v.points.trim();
    if (Object.keys(patch).length === 0) return { ok: true };
    const res = await updateTaskFields(taskId, patch);
    if (res?.ok) setSavedAt(Date.now());
    return res;
  }, null);

  const dirty =
    values.startDate !== initial.startDate ||
    (!dueLocked && values.dueDate !== initial.dueDate) ||
    estimateFrom(values.estimateHours, values.estimateMinutes) !==
      estimateFrom(initial.estimateHours, initial.estimateMinutes) ||
    (values.points.trim() !== "" && values.points !== initial.points);

  const set = (key: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSavedAt(0);
    setValues((v) => ({ ...v, [key]: e.target.value }));
  };

  const pct = estimateTotal && estimateTotal > 0 ? Math.min(100, Math.round((loggedMinutes / estimateTotal) * 100)) : 0;
  const over = Boolean(estimateTotal && loggedMinutes > estimateTotal);
  const labelClass = "flex items-center gap-1.5 text-xs font-medium text-muted";

  const estimateBar = (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{ts.logged}</span>
        <span className={cn("tabular-nums", over && "font-medium text-danger")}>
          {estimateTotal
            ? format(ts.loggedOfEstimate, {
                logged: formatDuration(loggedMinutes, t.tasksDetail.duration),
                estimate: formatDuration(estimateTotal, t.tasksDetail.duration),
              })
            : formatDuration(loggedMinutes, t.tasksDetail.duration)}
        </span>
      </div>
      {estimateTotal ? (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-strong"
          role="progressbar"
          aria-label={ts.logged}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            className={cn("mt-progress-fill h-full rounded-full", over ? "bg-danger" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );

  if (!canEdit) {
    return (
      <dl className="space-y-3 text-sm" data-testid="task-properties">
        <ReadRow icon={<CalendarDays aria-hidden className="h-3.5 w-3.5" />} label={ts.startDate}>
          {initial.startDate ? formatRiyadhDate(initial.startDate, locale) : t.tasksDetail.none}
        </ReadRow>
        <ReadRow icon={<CalendarClock aria-hidden className="h-3.5 w-3.5" />} label={ts.dueDate}>
          <span className={cn(overdue && "font-medium text-danger")}>
            {dueAtIso ? formatRiyadhDate(dueAtIso, locale) : t.tasksDetail.none}
            {overdue ? <span className="ms-1.5 text-xs">({t.tasksDetail.overdue})</span> : null}
          </span>
        </ReadRow>
        <div>
          <ReadRow icon={<Hourglass aria-hidden className="h-3.5 w-3.5" />} label={ts.estimate}>
            {estimateTotal ? formatDuration(estimateTotal, t.tasksDetail.duration) : ts.noEstimate}
          </ReadRow>
          {estimateBar}
        </div>
        <ReadRow icon={<Star aria-hidden className="h-3.5 w-3.5" />} label={ts.points}>
          <span className="tabular-nums">{initial.points}</span>
        </ReadRow>
      </dl>
    );
  }

  return (
    <form
      className="space-y-4"
      data-testid="task-properties"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(() => action(values));
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className={labelClass}>
            <CalendarDays aria-hidden className="h-3.5 w-3.5" />
            {ts.startDate}
          </span>
          <Input type="date" value={values.startDate} onChange={set("startDate")} className="h-9 px-2 md:h-9" />
        </label>
        <label className="block space-y-1.5">
          <span className={cn(labelClass, overdue && "text-danger")}>
            <CalendarClock aria-hidden className="h-3.5 w-3.5" />
            {ts.dueDate}
            {dueLocked ? <Lock aria-hidden className="h-3 w-3" /> : null}
          </span>
          {dueLocked ? (
            <span
              className={cn(
                "flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface-muted px-2 text-sm",
                overdue ? "font-medium text-danger" : "text-ink",
              )}
              title={ts.dueLocked}
            >
              {dueAtIso ? formatRiyadhDate(dueAtIso, locale) : t.tasksDetail.none}
            </span>
          ) : (
            <Input
              type="date"
              value={values.dueDate}
              onChange={set("dueDate")}
              aria-invalid={overdue || undefined}
              className={cn("h-9 px-2 md:h-9", overdue && "border-danger text-danger")}
            />
          )}
          {overdue ? <span className="block text-xs font-medium text-danger">{t.tasksDetail.overdue}</span> : null}
          {dueLocked && !overdue ? <span className="block text-xs text-muted">{ts.dueLocked}</span> : null}
        </label>
      </div>

      <fieldset className="min-w-0">
        <legend className={labelClass}>
          <Hourglass aria-hidden className="h-3.5 w-3.5" />
          {ts.estimate}
        </legend>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          <label className="relative block">
            <span className="sr-only">{ts.hours}</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={1666}
              value={values.estimateHours}
              onChange={set("estimateHours")}
              placeholder="0"
              className="h-9 pe-14 md:h-9"
            />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">
              {ts.hours}
            </span>
          </label>
          <label className="relative block">
            <span className="sr-only">{ts.minutes}</span>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={values.estimateMinutes}
              onChange={set("estimateMinutes")}
              placeholder="0"
              className="h-9 pe-14 md:h-9"
            />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">
              {ts.minutes}
            </span>
          </label>
        </div>
        {estimateBar}
      </fieldset>

      <label className="block space-y-1.5">
        <span className={labelClass}>
          <Star aria-hidden className="h-3.5 w-3.5" />
          {ts.points}
        </span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={values.points}
          onChange={set("points")}
          className="h-9 w-28 md:h-9"
        />
      </label>

      <div className="flex min-h-9 items-center gap-3">
        {dirty ? (
          <Button type="submit" disabled={pending} className="min-h-9">
            {ts.saveDetails}
          </Button>
        ) : null}
        {!dirty && savedAt > 0 && state?.ok ? (
          <span className="text-xs text-success" role="status">
            {ts.saved}
          </span>
        ) : null}
      </div>
      {state && !state.ok && state.message ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function ReadRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon}
        {label}
      </dt>
      <dd className="text-end text-sm text-ink">{children}</dd>
    </div>
  );
}
