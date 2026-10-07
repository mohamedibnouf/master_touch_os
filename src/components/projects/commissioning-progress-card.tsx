"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setCommissioningItemAction } from "@/server/use-cases/platform";
import {
  COMMISSIONING_ITEM_KEYS,
  COMMISSIONING_ITEM_LABELS,
  COMMISSIONING_ITEM_STATUSES,
  COMMISSIONING_NOTE_MAX,
  COMMISSIONING_STATUS_LABELS,
  type CommissioningItemStatus,
  type ProjectCommissioningProgress,
} from "@/modules/projects/stage08-commissioning";

function formatStamp(value: string | null): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

export function CommissioningProgressCard({
  progress,
  projectId,
  canMutate,
}: {
  progress: ProjectCommissioningProgress;
  projectId: string;
  canMutate: boolean;
}) {
  const required = progress.required_count || 6;
  const passed = progress.passed_count;
  return (
    <section
      data-testid="commissioning-progress"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-paper px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-navy">الاختبار والتشغيل</h3>
        <p className="mt-1 text-xs tabular-nums text-muted" data-testid="commissioning-passed-count">
          {passed} / {required} ناجحة
        </p>
      </div>
      <ul className="space-y-3">
        {COMMISSIONING_ITEM_KEYS.map((key) => {
          const item = progress.items.find((row) => row.item_key === key);
          const status = item?.status ?? "pending";
          const failed = status === "failed";
          const ok = status === "passed";
          return (
            <li key={key} className="border-t border-line pt-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className={ok ? "text-ink" : failed ? "text-danger" : "text-muted"}>
                  <span className="ms-1 font-semibold text-navy" aria-hidden>
                    {ok ? "✓" : failed ? "!" : "○"}
                  </span>{" "}
                  {COMMISSIONING_ITEM_LABELS[key]}
                </span>
                <span className={`text-xs ${failed ? "text-danger" : "text-muted"}`}>
                  {COMMISSIONING_STATUS_LABELS[status]}
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
                <CommissioningItemForm
                  projectId={projectId}
                  itemKey={key}
                  status={status}
                  note={item?.note ?? ""}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {!progress.ready ? (
        <p className="text-sm text-warning" data-testid="commissioning-not-ready-hint">
          يجب اجتياز جميع اختبارات التشغيل قبل إكمال المرحلة.
        </p>
      ) : (
        <p className="text-sm text-ink">الاختبار والتشغيل جاهز لإكمال المرحلة</p>
      )}
      <Link href={`/projects/${projectId}?tab=documents`} className="text-sm font-medium text-primary">
        مستندات المشروع
      </Link>
    </section>
  );
}

function CommissioningItemForm({
  projectId,
  itemKey,
  status,
  note,
}: {
  projectId: string;
  itemKey: string;
  status: CommissioningItemStatus;
  note: string;
}) {
  const [currentStatus, setCurrentStatus] = useState<CommissioningItemStatus>(status);
  return (
    <ServerActionForm action={setCommissioningItemAction} className="mt-2 space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="itemKey" value={itemKey} />
      <label className="block text-xs text-muted">
        نتيجة الاختبار
        <Select
          name="status"
          className="mt-1 min-h-11"
          value={currentStatus}
          onChange={(event) => setCurrentStatus(event.target.value as CommissioningItemStatus)}
        >
          {COMMISSIONING_ITEM_STATUSES.map((value) => (
            <option key={value} value={value}>
              {COMMISSIONING_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-xs text-muted">
        ملاحظة
        <Input name="note" maxLength={COMMISSIONING_NOTE_MAX} defaultValue={note} className="mt-1 min-h-11" />
      </label>
      <Button type="submit" variant="secondary" className="min-h-11 w-full">
        حفظ
      </Button>
    </ServerActionForm>
  );
}
