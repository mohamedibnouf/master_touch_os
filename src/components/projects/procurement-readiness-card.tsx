import Link from "next/link";
import {
  PROCUREMENT_MISSING_LABELS,
  milestoneState,
  newPurchaseRequestHref,
  procurementHrefForProject,
  type ProjectProcurementReadiness,
} from "@/modules/procurement/stage05-readiness";

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
        <span className="ms-1 font-semibold text-navy" aria-hidden>
          {mark}
        </span>{" "}
        {label}
      </span>
      <span className="tabular-nums text-xs text-muted">{count}</span>
    </li>
  );
}

export function ProcurementReadinessCard({
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
  return (
    <section
      data-testid="procurement-readiness"
      className="space-y-3 rounded-[var(--radius-control)] border border-line bg-paper px-3 py-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-navy">حالة المشتريات</h3>
        <p className="text-xs text-muted">
          {readiness.ready
            ? "دورة الشراء المطلوبة مكتملة. راجع ثم أكمل المرحلة يدوياً."
            : "لا يمكن إكمال المرحلة قبل إصدار أمر شراء مترابط لهذا المشروع."}
        </p>
      </div>
      <ul className="space-y-1.5">
        <Row label="طلب شراء" count={readiness.purchase_request_count} completeWhen={readiness.purchase_request_count > 0} />
        <Row label="طلب عروض أسعار" count={readiness.rfq_count} completeWhen={readiness.rfq_count > 0} />
        <Row label="عروض الموردين" count={readiness.quotation_count} completeWhen={readiness.quotation_count > 0} />
        <Row label="الترسية" count={readiness.awarded_count} completeWhen={readiness.awarded_count > 0} />
        <Row label="أمر شراء صادر" count={readiness.issued_po_count} completeWhen={readiness.issued_po_count > 0} />
        <Row
          label="تاريخ التسليم على أمر الشراء"
          count={readiness.issued_po_with_delivery_date_count}
          completeWhen={readiness.issued_po_with_delivery_date_count > 0}
        />
        <Row
          label="مستندات داعمة (إرشاد)"
          count={readiness.supporting_document_count}
          completeWhen={readiness.supporting_document_count > 0}
        />
      </ul>
      {!readiness.ready && readiness.missing.length > 0 ? (
        <p className="text-sm text-warning" data-testid="procurement-readiness-missing">
          ناقص: {readiness.missing.map((key) => PROCUREMENT_MISSING_LABELS[key] ?? key).join(" · ")}
        </p>
      ) : null}
      <p className="text-xs text-muted">المستندات ليست شرطاً لإكمال المرحلة في هذه النسخة.</p>
      {canOpenProcurement ? (
        <div className="flex flex-wrap gap-3">
          <Link
            href={procurementHrefForProject(projectId)}
            className="text-sm font-medium text-primary"
            data-testid="procurement-open-cta"
          >
            فتح المشتريات
          </Link>
          {canCreatePr ? (
            <Link href={newPurchaseRequestHref(projectId)} className="text-sm font-medium text-primary">
              طلب شراء لهذا المشروع
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted" data-testid="procurement-permission-hint">
          تنفيذ دورة المشتريات يتطلب صلاحيات المشتريات التشغيلية. يمكن لمسؤول المرحلة متابعة الحالة هنا دون توسيع صلاحيات الموظف الأساسية.
        </p>
      )}
    </section>
  );
}
