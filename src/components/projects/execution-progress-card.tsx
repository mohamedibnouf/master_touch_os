"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setExecutionItemAction } from "@/server/use-cases/platform";
import {
  EXECUTION_ITEM_KEYS,
  EXECUTION_ITEM_LABELS,
  EXECUTION_ITEM_STATUSES,
  EXECUTION_NOTE_MAX,
  EXECUTION_STATUS_LABELS,
  type ExecutionItemStatus,
  type ProjectExecutionProgress,
} from "@/modules/projects/stage07-execution";

function formatStamp(value: string | null): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
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
  const required = progress.required_count || 6;
  const completed = progress.completed_count;
  const overall = Math.max(0, Math.min(100, progress.overall_progress));
  return (
    <section
      data-testid="execution-progress"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-paper px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-navy">التقدم في التنفيذ</h3>
        <p className="mt-2 text-sm tabular-nums text-navy" data-testid="execution-progress-percent">
          {overall}%
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={overall}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-primary" style={{ width: `${overall}%` }} />
        </div>
        <p className="mt-1 text-xs tabular-nums text-muted" data-testid="execution-completed-count">
          {completed} / {required} مكتملة
        </p>
      </div>
      <ul className="space-y-3">
        <li className="pt-1 text-sm font-semibold text-navy">عناصر التنفيذ</li>
        {EXECUTION_ITEM_KEYS.map((key) => {
          const item = progress.items.find((row) => row.item_key === key);
          const status = item?.status ?? "not_started";
          const blocked = status === "blocked";
          const done = status === "completed";
          return (
            <li key={key} className="border-t border-line pt-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className={done ? "text-ink" : blocked ? "text-warning" : "text-muted"}>
                  <span className="ms-1 font-semibold text-navy" aria-hidden>
                    {done ? "✓" : blocked ? "!" : "○"}
                  </span>{" "}
                  {EXECUTION_ITEM_LABELS[key]}
                </span>
                <span className={`text-xs ${blocked ? "text-warning" : "text-muted"}`}>
                  {EXECUTION_STATUS_LABELS[status]} · {item?.progress_percent ?? 0}%
                </span>
              </div>
              {item?.updated_by_name || item?.updated_at ? (
                <p className="mt-1 text-xs text-muted">
                  {item?.updated_by_name ?? "—"}
                  {item?.updated_at ? ` · ${formatStamp(item.updated_at)}` : ""}
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
          يجب إكمال جميع عناصر التنفيذ بنسبة 100% قبل إكمال المرحلة.
        </p>
      ) : (
        <p className="text-sm text-ink">التنفيذ جاهز لإكمال المرحلة</p>
      )}
      <Link href={`/projects/${projectId}?tab=documents`} className="text-sm font-medium text-primary">
        مستندات المشروع
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
  const [currentStatus, setCurrentStatus] = useState<ExecutionItemStatus>(status);
  const [currentProgress, setCurrentProgress] = useState(String(progressPercent));

  return (
    <ServerActionForm action={setExecutionItemAction} className="mt-2 space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="itemKey" value={itemKey} />
      <label className="block text-xs text-muted">
        الحالة
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
              {EXECUTION_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-xs text-muted">
        نسبة الإنجاز
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
        ملاحظة اختيارية
        <Input
          name="note"
          maxLength={EXECUTION_NOTE_MAX}
          placeholder="ملاحظة اختيارية"
          defaultValue={note}
          className="mt-1 min-h-11"
        />
      </label>
      <Button type="submit" variant="secondary" className="min-h-11 w-full">
        حفظ التحديث
      </Button>
    </ServerActionForm>
  );
}
