import { Button, Field, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { DocumentOpenControl, DocumentSourceBadge } from "@/components/documents/document-open-control";
import { createCurrentWorkflowGateApprovalAction } from "@/server/use-cases/platform";
import { ApprovalActionPanel } from "@/components/projects/approval-action-panel";
import type { WorkflowViewNode } from "@/server/use-cases/project-workflow";
import { approvalStatusLabel } from "@/lib/ui/operational-labels";
import { format, intlLocale, pickLocalized, type Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

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

function formatStamp(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
}

export async function WorkflowGateSubmitFields({
  projectId,
  projectCode,
  stageNameAr,
  stageNameEn,
  approvers,
  documents,
}: {
  projectId: string;
  projectCode: string;
  stageNameAr: string;
  stageNameEn?: string | null;
  approvers: Array<{ id: string; name: string }>;
  documents: GateSupportingDocumentOption[];
}) {
  const { t } = await getI18n();
  const copy = t.projectWorkflow.gate;
  return (
    <ServerActionForm action={createCurrentWorkflowGateApprovalAction} className="space-y-3" testId="workflow-gate-submit-form">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="title" value={`اعتماد مرحلة ${stageNameAr} — ${projectCode}`} />
      <input
        type="hidden"
        name="title_en"
        value={`Stage approval: ${stageNameEn?.trim() || stageNameAr} — ${projectCode}`}
      />
      <Field label={copy.approver}>
        <Select name="approverProfileId" required>
          {approvers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-ink">{copy.supportingDocuments}</legend>
        {documents.length === 0 ? (
          <p className="text-sm text-muted">{copy.noProjectDocuments}</p>
        ) : (
          documents.map((doc) => (
            <label key={doc.documentVersionId} className="flex items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-sm">
              <input type="checkbox" name="documentVersionId" value={doc.documentVersionId} className="mt-1" />
              <span>
                <span className="block font-medium text-ink">{doc.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {format(copy.revision, { revision: doc.revision })}
                  <DocumentSourceBadge source={doc.fileSource} />
                  {doc.isCurrent ? copy.current : copy.historical}
                </span>
              </span>
            </label>
          ))
        )}
      </fieldset>
      <Button type="submit">{copy.submit}</Button>
    </ServerActionForm>
  );
}

export async function WorkflowGateApprovalCard({
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
  const { t, locale } = await getI18n();
  const copy = t.projectWorkflow.gate;
  const waiting = Boolean(node.openApproval);
  return (
    <section data-testid="workflow-gate-approval-card" className="rounded-[var(--radius-card)] border-2 border-primary bg-surface p-5 shadow-[var(--shadow-1)]">
      <p className="text-xs font-semibold tracking-wide text-primary">{copy.eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold text-ink">{copy.title}</h2>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{copy.stage}</dt>
          <dd>
            {String(node.sequence).padStart(2, "0")} — {pickLocalized(locale, node.nameAr, node.nameEn)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{copy.status}</dt>
          <dd>{waiting ? copy.awaitingDecision : copy.awaitingSubmission}</dd>
        </div>
        <div>
          <dt className="text-muted">{t.projectWorkflow.common.owner}</dt>
          <dd>{node.responsibleLabel ?? t.projectWorkflow.common.notSet}</dd>
        </div>
        {waiting ? (
          <>
            <div>
              <dt className="text-muted">{copy.approver}</dt>
              <dd>{node.openApproval?.approverLabel ?? node.approverLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">{copy.submittedAt}</dt>
              <dd>{formatStamp(submittedAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-muted">{copy.requestStatus}</dt>
              <dd>{node.openApproval?.status ? approvalStatusLabel(node.openApproval.status, locale) : "—"}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {waiting ? (
        <div className="mt-4 space-y-3" data-testid="workflow-gate-submitted">
          <p className="text-sm font-medium text-ink">{copy.submittedDocuments}</p>
          {frozenDocuments.length === 0 ? (
            <p className="text-sm text-muted">{copy.noLinkedDocuments}</p>
          ) : (
            <ul className="space-y-2">
              {frozenDocuments.map((doc) => (
                <li key={doc.documentVersionId} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm">
                  <span>
                    {doc.title} · {format(copy.revision, { revision: doc.revision })}{" "}
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
            stageNameEn={node.nameEn}
            approvers={approvers}
            documents={documents}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">{copy.cannotSubmit}</p>
      )}
    </section>
  );
}
