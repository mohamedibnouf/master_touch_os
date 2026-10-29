import Link from "next/link";
import {
  procurementMissingLabel,
  milestoneState,
  newPurchaseRequestHref,
  procurementHrefForProject,
  type ProjectProcurementReadiness,
} from "@/modules/procurement/stage05-readiness";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

function Row({
  label,
  count,
  completeWhen,
}: {
  label: string;
  count: number;
  completeWhen: boolean;
}) {
  const state = completeWhen ? "complete" : milestoneState(count);
  const mark = state === "complete" ? "✓" : state === "progress" ? "…" : "○";
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className={state === "complete" ? "text-ink" : "text-muted"}>
        <span className="ms-1 font-semibold text-primary" aria-hidden>
          {mark}
        </span>{" "}
        {label}
      </span>
      <span className="tabular-nums text-xs text-muted">{count}</span>
    </li>
  );
}

export async function ProcurementReadinessCard({
  readiness,
  projectId,
  canOpenProcurement,
  canCreatePr,
}: {
  readiness: ProjectProcurementReadiness;
  projectId: string;
  canOpenProcurement: boolean;
  canCreatePr: boolean;
}) {
  const { t, locale } = await getI18n();
  const copy = t.projectWorkflow.procurement;
  return (
    <section
      data-testid="procurement-readiness"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">{copy.title}</h3>
        <p className="text-xs text-muted">
          {readiness.ready
            ? copy.ready
            : copy.notReady}
        </p>
      </div>
      <ul className="space-y-1.5">
        <Row label={copy.purchaseRequest} count={readiness.purchase_request_count} completeWhen={readiness.purchase_request_count > 0} />
        <Row label={copy.rfq} count={readiness.rfq_count} completeWhen={readiness.rfq_count > 0} />
        <Row label={copy.quotations} count={readiness.quotation_count} completeWhen={readiness.quotation_count > 0} />
        <Row label={copy.award} count={readiness.awarded_count} completeWhen={readiness.awarded_count > 0} />
        <Row label={copy.issuedPo} count={readiness.issued_po_count} completeWhen={readiness.issued_po_count > 0} />
        <Row
          label={copy.poDeliveryDate}
          count={readiness.issued_po_with_delivery_date_count}
          completeWhen={readiness.issued_po_with_delivery_date_count > 0}
        />
        <Row
          label={copy.supportingDocs}
          count={readiness.supporting_document_count}
          completeWhen={readiness.supporting_document_count > 0}
        />
      </ul>
      {!readiness.ready && readiness.missing.length > 0 ? (
        <p className="text-sm text-warning" data-testid="procurement-readiness-missing">
          {format(copy.missing, { items: readiness.missing.map((key) => procurementMissingLabel(key, locale)).join(" · ") })}
        </p>
      ) : null}
      <p className="text-xs text-muted">{copy.docsAdvisory}</p>
      {canOpenProcurement ? (
        <div className="flex flex-wrap gap-3">
          <Link
            href={procurementHrefForProject(projectId)}
            className="text-sm font-medium text-primary"
            data-testid="procurement-open-cta"
          >
            {copy.open}
          </Link>
          {canCreatePr ? (
            <Link href={newPurchaseRequestHref(projectId)} className="text-sm font-medium text-primary">
              {copy.newPr}
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted" data-testid="procurement-permission-hint">
          {copy.permissionHint}
        </p>
      )}
    </section>
  );
}
