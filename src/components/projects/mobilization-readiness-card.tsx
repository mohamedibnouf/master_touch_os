import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setMobilizationReadinessItemAction } from "@/server/use-cases/platform";
import { procurementHrefForProject } from "@/modules/procurement/stage05-readiness";
import {
  MOBILIZATION_ITEM_KEYS,
  mobilizationItemLabel,
  MOBILIZATION_NOTE_MAX,
  type ProjectMobilizationReadiness,
} from "@/modules/projects/stage06-mobilization";
import { format, intlLocale, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

function formatStamp(value: string | null, locale: Locale): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
}

export async function MobilizationReadinessCard({
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
  const { t, locale } = await getI18n();
  const common = t.projectWorkflow.common;
  const required = readiness.required_count || 6;
  const confirmed = readiness.confirmed_required_count;
  return (
    <section
      data-testid="mobilization-readiness"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">{t.projectWorkflow.mobilization.title}</h3>
        <p className="text-xs text-muted">
          {readiness.ready
            ? t.projectWorkflow.mobilization.ready
            : t.projectWorkflow.mobilization.pending}
        </p>
        <p className="mt-1 text-sm font-medium tabular-nums text-ink" data-testid="mobilization-progress">
          {format(common.completedOfTotal, { done: confirmed, total: required })}
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
                  <span className="ms-1 font-semibold text-primary" aria-hidden>
                    {confirmedRow ? "✓" : "○"}
                  </span>{" "}
                  {mobilizationItemLabel(key, locale)}
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
                <ServerActionForm action={setMobilizationReadinessItemAction} className="mt-2 space-y-2">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="itemKey" value={key} />
                  <input type="hidden" name="isConfirmed" value={confirmedRow ? "false" : "true"} />
                  {!confirmedRow ? (
                    <input
                      name="note"
                      maxLength={MOBILIZATION_NOTE_MAX}
                      placeholder={common.optionalNote}
                      className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-xs"
                    />
                  ) : null}
                  <Button type="submit" variant={confirmedRow ? "ghost" : "secondary"}>
                    {confirmedRow ? common.unconfirm : common.confirm}
                  </Button>
                </ServerActionForm>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!readiness.ready ? (
        <p className="text-sm text-warning" data-testid="mobilization-not-ready-hint">
          {t.projectWorkflow.mobilization.notReadyHint}
        </p>
      ) : null}
      {canOpenProcurement ? (
        <Link href={procurementHrefForProject(projectId)} className="text-sm font-medium text-primary">
          {t.projectWorkflow.mobilization.reviewProcurement}
        </Link>
      ) : (
        <Link href={`/projects/${projectId}?tab=documents`} className="text-sm font-medium text-primary">
          {common.projectDocuments}
        </Link>
      )}
    </section>
  );
}
