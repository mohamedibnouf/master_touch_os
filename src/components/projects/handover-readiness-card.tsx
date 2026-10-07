import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setHandoverItemAction } from "@/server/use-cases/platform";
import {
  HANDOVER_ITEM_KEYS,
  HANDOVER_ITEM_LABELS,
  HANDOVER_NOTE_MAX,
  type ProjectHandoverReadiness,
} from "@/modules/projects/stage09-handover";

function formatStamp(value: string | null): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

export function HandoverReadinessCard({
  readiness,
  projectId,
  canMutate,
}: {
  readiness: ProjectHandoverReadiness;
  projectId: string;
  canMutate: boolean;
}) {
  const required = readiness.required_count || 5;
  const confirmed = readiness.confirmed_required_count;
  return (
    <section
      data-testid="handover-readiness"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-paper px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-navy">التسليم</h3>
        <p className="mt-1 text-xs tabular-nums text-muted" data-testid="handover-progress">
          {confirmed} / {required} مكتملة
        </p>
      </div>
      <ul className="space-y-3">
        {HANDOVER_ITEM_KEYS.map((key) => {
          const item = readiness.items.find((row) => row.item_key === key);
          const confirmedRow = item?.is_confirmed === true;
          return (
            <li key={key} className="border-t border-line pt-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className={confirmedRow ? "text-ink" : "text-muted"}>
                  <span className="ms-1 font-semibold text-navy" aria-hidden>
                    {confirmedRow ? "✓" : "○"}
                  </span>{" "}
                  {HANDOVER_ITEM_LABELS[key]}
                </span>
              </div>
              {confirmedRow && (item?.confirmed_by_name || item?.confirmed_at) ? (
                <p className="mt-1 text-xs text-muted">
                  {item?.confirmed_by_name ?? "—"}
                  {item?.confirmed_at ? ` · ${formatStamp(item.confirmed_at)}` : ""}
                </p>
              ) : null}
              {item?.note ? <p className="mt-1 text-xs text-ink">{item.note}</p> : null}
              {canMutate ? (
                <ServerActionForm action={setHandoverItemAction} className="mt-2 space-y-2">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="itemKey" value={key} />
                  <input type="hidden" name="isConfirmed" value={confirmedRow ? "false" : "true"} />
                  {!confirmedRow ? (
                    <input
                      name="note"
                      maxLength={HANDOVER_NOTE_MAX}
                      placeholder="ملاحظة اختيارية"
                      className="min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-white px-2 text-xs"
                    />
                  ) : null}
                  <Button type="submit" variant={confirmedRow ? "ghost" : "secondary"} className="min-h-11 w-full">
                    {confirmedRow ? "إلغاء التأكيد" : "تأكيد"}
                  </Button>
                </ServerActionForm>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!readiness.ready ? (
        <p className="text-sm text-warning" data-testid="handover-not-ready-hint">
          يجب إكمال جميع متطلبات التسليم قبل إكمال المرحلة.
        </p>
      ) : (
        <p className="text-sm text-ink">التسليم جاهز لإكمال المرحلة</p>
      )}
      <Link href={`/projects/${projectId}?tab=documents`} className="text-sm font-medium text-primary">
        مستندات المشروع
      </Link>
    </section>
  );
}
