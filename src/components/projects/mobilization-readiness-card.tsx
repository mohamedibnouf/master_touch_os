import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setMobilizationReadinessItemAction } from "@/server/use-cases/platform";
import { procurementHrefForProject } from "@/modules/procurement/stage05-readiness";
import {
  MOBILIZATION_ITEM_KEYS,
  MOBILIZATION_ITEM_LABELS,
  MOBILIZATION_NOTE_MAX,
  type ProjectMobilizationReadiness,
} from "@/modules/projects/stage06-mobilization";

function formatStamp(value: string | null): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

export function MobilizationReadinessCard({
  readiness,
  projectId,
  canMutate,
  canOpenProcurement,
}: {
  readiness: ProjectMobilizationReadiness;
  projectId: string;
  canMutate: boolean;
  canOpenProcurement: boolean;
}) {
  const required = readiness.required_count || 6;
  const confirmed = readiness.confirmed_required_count;
  return (
    <section
      data-testid="mobilization-readiness"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-paper px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-navy">حالة التجهيز</h3>
        <p className="text-xs text-muted">
          {readiness.ready
            ? "التجهيز جاهز لإكمال المرحلة"
            : "أكمل عناصر التجهيز المطلوبة قبل إغلاق المرحلة"}
        </p>
        <p className="mt-1 text-sm tabular-nums text-navy" data-testid="mobilization-progress">
          {confirmed} / {required} مكتملة
        </p>
      </div>
      <ul className="space-y-3">
        {MOBILIZATION_ITEM_KEYS.map((key) => {
          const item = readiness.items.find((row) => row.item_key === key);
          const confirmedRow = item?.is_confirmed === true;
          return (
            <li key={key} className="border-t border-line pt-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className={confirmedRow ? "text-ink" : "text-muted"}>
                  <span className="ms-1 font-semibold text-navy" aria-hidden>
                    {confirmedRow ? "✓" : "○"}
                  </span>{" "}
                  {MOBILIZATION_ITEM_LABELS[key]}
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
                <ServerActionForm action={setMobilizationReadinessItemAction} className="mt-2 space-y-2">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="itemKey" value={key} />
                  <input type="hidden" name="isConfirmed" value={confirmedRow ? "false" : "true"} />
                  {!confirmedRow ? (
                    <input
                      name="note"
                      maxLength={MOBILIZATION_NOTE_MAX}
                      placeholder="ملاحظة اختيارية"
                      className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-white px-2 text-xs"
                    />
                  ) : null}
                  <Button type="submit" variant={confirmedRow ? "ghost" : "secondary"}>
                    {confirmedRow ? "إلغاء التأكيد" : "تأكيد"}
                  </Button>
                </ServerActionForm>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!readiness.ready ? (
        <p className="text-sm text-warning" data-testid="mobilization-not-ready-hint">
          يجب إكمال عناصر التجهيز المطلوبة قبل إكمال المرحلة.
        </p>
      ) : null}
      {canOpenProcurement ? (
        <Link href={procurementHrefForProject(projectId)} className="text-sm font-medium text-primary">
          مراجعة المشتريات
        </Link>
      ) : (
        <Link href={`/projects/${projectId}?tab=documents`} className="text-sm font-medium text-primary">
          مستندات المشروع
        </Link>
      )}
    </section>
  );
}
