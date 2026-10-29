import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setHandoverItemAction } from "@/server/use-cases/platform";
import {
  HANDOVER_ITEM_KEYS,
  handoverItemLabel,
  HANDOVER_NOTE_MAX,
  type ProjectHandoverReadiness,
} from "@/modules/projects/stage09-handover";
import { format, intlLocale, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

function formatStamp(value: string | null, locale: Locale): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
}

export async function HandoverReadinessCard({
  readiness,
  projectId,
  canMutate,
}: {
  readiness: ProjectHandoverReadiness;
  projectId: string;
  canMutate: boolean;
}) {
  const { t, locale } = await getI18n();
  const common = t.projectWorkflow.common;
  const required = readiness.required_count || 5;
  const confirmed = readiness.confirmed_required_count;
  return (
    <section
      data-testid="handover-readiness"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">{t.projectWorkflow.handover.title}</h3>
        <p className="mt-1 text-xs tabular-nums text-muted" data-testid="handover-progress">
          {format(common.completedOfTotal, { done: confirmed, total: required })}
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
                  <span className="ms-1 font-semibold text-primary" aria-hidden>
                    {confirmedRow ? "✓" : "○"}
                  </span>{" "}
                  {handoverItemLabel(key, locale)}
                </span>
              </div>
              {confirmedRow && (item?.confirmed_by_name || item?.confirmed_at) ? (
                <p className="mt-1 text-xs text-muted">
                  {item?.confirmed_by_name ?? "—"}
                  {item?.confirmed_at ? ` · ${formatStamp(item.confirmed_at, locale)}` : ""}
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
                      placeholder={common.optionalNote}
                      className="min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-xs"
                    />
                  ) : null}
                  <Button type="submit" variant={confirmedRow ? "ghost" : "secondary"} className="min-h-11 w-full">
                    {confirmedRow ? common.unconfirm : common.confirm}
                  </Button>
                </ServerActionForm>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!readiness.ready ? (
        <p className="text-sm text-warning" data-testid="handover-not-ready-hint">
          {t.projectWorkflow.handover.notReadyHint}
        </p>
      ) : (
        <p className="text-sm text-success">{t.projectWorkflow.handover.ready}</p>
      )}
      <Link href={`/projects/${projectId}?tab=documents`} className="text-sm font-medium text-primary">
        {common.projectDocuments}
      </Link>
    </section>
  );
}
