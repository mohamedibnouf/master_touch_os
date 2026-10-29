"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setExecutionItemAction } from "@/server/use-cases/platform";
import {
  EXECUTION_ITEM_KEYS,
  executionItemLabel,
  EXECUTION_ITEM_STATUSES,
  EXECUTION_NOTE_MAX,
  executionStatusLabel,
  type ExecutionItemStatus,
  type ProjectExecutionProgress,
} from "@/modules/projects/stage07-execution";
import { format, intlLocale, type Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

function formatStamp(value: string | null, locale: Locale): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
}

function suggestedProgress(status: ExecutionItemStatus, current: number): number {
  if (status === "not_started") return 0;
  if (status === "completed") return 100;
  if (status === "in_progress" && (current < 1 || current > 99)) return 1;
  if (status === "blocked" && current > 99) return 99;
  return current;
}

export function ExecutionProgressCard({
  progress,
  projectId,
  canMutate,
}: {
  progress: ProjectExecutionProgress;
  projectId: string;
  canMutate: boolean;
}) {
  const { t, locale } = useI18n();
  const copy = t.projectWorkflow.execution;
  const required = progress.required_count || 6;
  const completed = progress.completed_count;
  const overall = Math.max(0, Math.min(100, progress.overall_progress));
  return (
    <section
      data-testid="execution-progress"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">{copy.title}</h3>
        <p className="mt-2 text-lg font-semibold tabular-nums text-ink" data-testid="execution-progress-percent">
          {overall}%
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={overall}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={copy.title}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${overall}%` }} />
        </div>
        <p className="mt-1 text-xs tabular-nums text-muted" data-testid="execution-completed-count">
          {format(t.projectWorkflow.common.completedOfTotal, { done: completed, total: required })}
        </p>
      </div>
      <ul className="space-y-3">
        <li className="pt-1 text-sm font-semibold text-ink">{copy.items}</li>
        {EXECUTION_ITEM_KEYS.map((key) => {
          const item = progress.items.find((row) => row.item_key === key);
          const status = item?.status ?? "not_started";
          const blocked = status === "blocked";
          const done = status === "completed";
          return (
            <li key={key} className="border-t border-line pt-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className={done ? "text-ink" : blocked ? "text-warning" : "text-muted"}>
                  <span className="ms-1 font-semibold text-primary" aria-hidden>
                    {done ? "✓" : blocked ? "!" : "○"}
                  </span>{" "}
                  {executionItemLabel(key, locale)}
                </span>
                <span className={`text-xs ${blocked ? "text-warning" : "text-muted"}`}>
                  {executionStatusLabel(status, locale)} · {item?.progress_percent ?? 0}%
                </span>
              </div>
              {item?.updated_by_name || item?.updated_at ? (
                <p className="mt-1 text-xs text-muted">
                  {item?.updated_by_name ?? "—"}
                  {item?.updated_at ? ` · ${formatStamp(item.updated_at, locale)}` : ""}
                </p>
              ) : null}
              {item?.note ? <p className="mt-1 text-xs text-ink">{item.note}</p> : null}
              {canMutate ? (
                <ExecutionItemForm
                  projectId={projectId}
                  itemKey={key}
                  status={status}
                  progressPercent={item?.progress_percent ?? 0}
                  note={item?.note ?? ""}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {!progress.ready ? (
        <p className="text-sm text-warning" data-testid="execution-not-ready-hint">
          {copy.notReadyHint}
        </p>
      ) : (
        <p className="text-sm text-success">{copy.ready}</p>
      )}
      <Link href={`/projects/${projectId}?tab=documents`} className="text-sm font-medium text-primary">
        {t.projectWorkflow.common.projectDocuments}
      </Link>
    </section>
  );
}

function ExecutionItemForm({
  projectId,
  itemKey,
  status,
  progressPercent,
  note,
}: {
  projectId: string;
  itemKey: string;
  status: ExecutionItemStatus;
  progressPercent: number;
  note: string;
}) {
  const { t, locale } = useI18n();
  const copy = t.projectWorkflow.execution;
  const [currentStatus, setCurrentStatus] = useState<ExecutionItemStatus>(status);
  const [currentProgress, setCurrentProgress] = useState(String(progressPercent));

  return (
    <ServerActionForm action={setExecutionItemAction} className="mt-2 space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="itemKey" value={itemKey} />
      <label className="block text-xs text-muted">
        {copy.status}
        <Select
          name="status"
          className="mt-1 min-h-11"
          value={currentStatus}
          onChange={(event) => {
            const next = event.target.value as ExecutionItemStatus;
            setCurrentStatus(next);
            setCurrentProgress(String(suggestedProgress(next, Number(currentProgress) || 0)));
          }}
        >
          {EXECUTION_ITEM_STATUSES.map((value) => (
            <option key={value} value={value}>
              {executionStatusLabel(value, locale)}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-xs text-muted">
        {copy.progressPercent}
        <Input
          name="progressPercent"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          className="mt-1 min-h-11"
          value={currentProgress}
          onChange={(event) => setCurrentProgress(event.target.value)}
        />
      </label>
      <label className="block text-xs text-muted">
        {copy.optionalNote}
        <Input
          name="note"
          maxLength={EXECUTION_NOTE_MAX}
          placeholder={copy.optionalNote}
          defaultValue={note}
          className="mt-1 min-h-11"
        />
      </label>
      <Button type="submit" variant="secondary" className="min-h-11 w-full">
        {copy.saveUpdate}
      </Button>
    </ServerActionForm>
  );
}
