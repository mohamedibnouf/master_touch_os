import { Button, Field, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { DocumentOpenControl, DocumentSourceBadge } from "@/components/documents/document-open-control";
import { createCurrentWorkflowGateApprovalAction } from "@/server/use-cases/platform";
import { ApprovalActionPanel } from "@/components/projects/approval-action-panel";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";

export type GateSupportingDocumentOption = {
  documentId: string;
  documentVersionId: string;
  title: string;
  revision: string;
  fileSource: string | null;
  isCurrent: boolean;
  filePath: string | null;
  externalUrl: string | null;
};

export type FrozenGateDocument = {
  documentId: string;
  documentVersionId: string;
  title: string;
  revision: string;
  fileSource: string | null;
  filePath: string | null;
  externalUrl: string | null;
};

function formatStamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

export function WorkflowGateSubmitFields({
  projectId,
  projectCode,
  stageNameAr,
  approvers,
  documents,
}: {
  projectId: string;
  projectCode: string;
  stageNameAr: string;
  approvers: Array<{ id: string; name: string }>;
  documents: GateSupportingDocumentOption[];
}) {
  return (
    <ServerActionForm action={createCurrentWorkflowGateApprovalAction} className="space-y-3" testId="workflow-gate-submit-form">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="title" value={`اعتماد مرحلة ${stageNameAr} — ${projectCode}`} />
      <Field label="المعتمد">
        <Select name="approverProfileId" required>
          {approvers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-navy">المستندات الداعمة</legend>
        {documents.length === 0 ? (
          <p className="text-sm text-muted">لا توجد مستندات حالية مرتبطة بهذا المشروع.</p>
        ) : (
          documents.map((doc) => (
            <label key={doc.documentVersionId} className="flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-paper px-3 py-2 text-sm">
              <input type="checkbox" name="documentVersionId" value={doc.documentVersionId} className="mt-1" />
              <span>
                <span className="block font-medium text-ink">{doc.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  مراجعة {doc.revision}
                  <DocumentSourceBadge source={doc.fileSource} />
                  {doc.isCurrent ? "حالية" : "تاريخية"}
                </span>
              </span>
            </label>
          ))
        )}
      </fieldset>
      <Button type="submit">إرسال المرحلة للاعتماد</Button>
    </ServerActionForm>
  );
}

export function WorkflowGateApprovalCard({
  node,
  projectId,
  projectCode,
  approvers,
  documents,
  frozenDocuments,
  submittedAt,
  canCreate,
  canOpenStorage,
}: {
  node: WorkflowViewNode;
  projectId: string;
  projectCode: string;
  approvers: Array<{ id: string; name: string }>;
  documents: GateSupportingDocumentOption[];
  frozenDocuments: FrozenGateDocument[];
  submittedAt: string | null;
  canCreate: boolean;
  canOpenStorage: boolean;
}) {
  const waiting = Boolean(node.openApproval);
  return (
    <section data-testid="workflow-gate-approval-card" className="rounded-[var(--radius-card)] border-2 border-navy bg-white p-5 shadow-[var(--shadow-1)]">
      <p className="text-xs font-semibold tracking-wide text-navy">اعتماد سير العمل</p>
      <h2 className="mt-1 text-lg font-semibold text-navy">اعتماد المرحلة الحالية</h2>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">المرحلة</dt>
          <dd>
            {String(node.sequence).padStart(2, "0")} — {node.nameAr}
          </dd>
        </div>
        <div>
          <dt className="text-muted">الحالة</dt>
          <dd>{waiting ? "بانتظار قرار المعتمد" : "بانتظار الإرسال للاعتماد"}</dd>
        </div>
        <div>
          <dt className="text-muted">المسؤول</dt>
          <dd>{node.responsibleLabel ?? "غير محدد"}</dd>
        </div>
        {waiting ? (
          <>
            <div>
              <dt className="text-muted">المعتمد</dt>
              <dd>{node.openApproval?.approverLabel ?? node.approverLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">تاريخ الإرسال</dt>
              <dd>{formatStamp(submittedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted">حالة الطلب</dt>
              <dd>{node.openApproval?.status ?? "—"}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {waiting ? (
        <div className="mt-4 space-y-3" data-testid="workflow-gate-submitted">
          <p className="text-sm font-medium text-navy">المستندات المقدّمة (مراجعة مجمّدة)</p>
          {frozenDocuments.length === 0 ? (
            <p className="text-sm text-muted">لا توجد مستندات مربوطة بهذا الطلب.</p>
          ) : (
            <ul className="space-y-2">
              {frozenDocuments.map((doc) => (
                <li key={doc.documentVersionId} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">
                  <span>
                    {doc.title} · مراجعة {doc.revision}{" "}
                    <DocumentSourceBadge source={doc.fileSource} />
                  </span>
                  <DocumentOpenControl
                    documentId={doc.documentId}
                    versionId={doc.documentVersionId}
                    canOpenStorage={canOpenStorage}
                    file={{
                      file_source: doc.fileSource,
                      file_path: doc.filePath,
                      external_url: doc.externalUrl,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <ApprovalActionPanel node={node} projectId={projectId} />
        </div>
      ) : canCreate && node.canSubmitApproval ? (
        <div className="mt-4">
          <WorkflowGateSubmitFields
            projectId={projectId}
            projectCode={projectCode}
            stageNameAr={node.nameAr}
            approvers={approvers}
            documents={documents}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">لا يمكن إرسال هذه المرحلة للاعتماد من حسابك الحالي.</p>
      )}
    </section>
  );
}
