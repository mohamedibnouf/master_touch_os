"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Users, X } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { format, pickLocalized } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { assignTask, unassignTask } from "@/server/use-cases/tasks";
import type { TaskAssignee, TaskMemberOption } from "@/modules/tasks/types";
import { personName } from "./detail-format";
import { PersonAvatar } from "./person-avatar";

export function TaskAssignees({
  taskId,
  assignees,
  members,
  canAssign,
  viewerId,
}: {
  taskId: string;
  assignees: TaskAssignee[];
  /** Active org members (empty when the viewer cannot assign). */
  members: TaskMemberOption[];
  canAssign: boolean;
  viewerId: string;
}) {
  const { t, locale } = useI18n();
  const ts = t.tasksDetail.side;
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const taken = new Set(assignees.map((a) => a.profile_id));
    return members
      .filter((m) => !taken.has(m.profile_id))
      .map((m) => ({ id: m.profile_id, name: pickLocalized(locale, m.full_name_ar, m.full_name_en) || m.profile_id }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [assignees, members, locale]);

  function run(id: string, fn: () => ReturnType<typeof assignTask>, after?: () => void) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      if (res?.ok) after?.();
      else setError(res?.message || t.tasks.messages.unexpected);
      setBusyId(null);
    });
  }

  return (
    <section className="mt-surface p-4" aria-labelledby="task-assignees-title" data-testid="task-assignees">
      <h2 id="task-assignees-title" className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <Users aria-hidden className="h-4 w-4 text-muted" />
        {ts.assignees}
        {assignees.length ? <span className="text-xs font-normal text-muted tabular-nums">({assignees.length})</span> : null}
      </h2>

      {assignees.length === 0 ? (
        <p className="text-sm text-muted">{ts.noAssignees}</p>
      ) : (
        <ul className="space-y-1">
          {assignees.map((a) => {
            const name = personName(a, locale, t.tasksDetail.unknownPerson);
            return (
              <li
                key={a.profile_id}
                className="group flex items-center gap-2.5 rounded-[var(--radius-control)] px-1.5 py-1.5 hover:bg-surface-muted"
                aria-busy={busyId === a.profile_id}
              >
                <PersonAvatar name={name} seed={a.profile_id} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink" dir="auto">
                    {name}
                    {a.profile_id === viewerId ? <span className="ms-1.5 text-xs font-normal text-muted">({t.tasksDetail.you})</span> : null}
                  </p>
                  {a.assigned_by === null ? <p className="text-xs text-muted">{ts.autoAssigned}</p> : null}
                </div>
                {canAssign ? (
                  <button
                    type="button"
                    onClick={() => run(a.profile_id, () => unassignTask(taskId, a.profile_id))}
                    disabled={pending}
                    aria-label={format(ts.remove, { name })}
                    title={format(ts.remove, { name })}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-60 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canAssign && options.length > 0 ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!selected) return;
            const id = selected;
            run(id, () => assignTask(taskId, id), () => setSelected(""));
          }}
        >
          <Select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            aria-label={ts.addAssignee}
            disabled={pending}
            className="h-9 md:h-9"
            data-testid="task-assignee-select"
          >
            <option value="">{ts.choosePerson}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" className="shrink-0" disabled={!selected || pending} onClick={(e) => e.currentTarget.form?.requestSubmit()}>
            <Plus aria-hidden className="h-4 w-4" />
            {ts.add}
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
