"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { archiveDocumentAction, restoreDocumentAction } from "@/server/use-cases/document-lifecycle";
import { archiveConfirmCopy } from "@/modules/documents/lifecycle";
import { useI18n } from "@/lib/i18n/client";

const dialogBackdrop = "fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center";
const dialogPanel =
  "w-full max-w-md rounded-[var(--radius-surface)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]";

export function DocumentArchiveControl({
  documentId,
  fileSource,
}: {
  documentId: string;
  fileSource: string | null | undefined;
}) {
  const { t, locale } = useI18n();
  const copy = archiveConfirmCopy(locale);
  const [open, setOpen] = useState(false);
  const isDrive = fileSource === "google_drive";

  return (
    <div>
      <Button type="button" variant="danger" onClick={() => setOpen(true)} data-testid={`document-archive-${documentId}`}>
        {t.documents.lifecycle.delete}
      </Button>
      {open ? (
        <div className={dialogBackdrop} role="dialog" aria-modal="true">
          <div className={dialogPanel}>
            <h3 className="font-semibold text-ink">{isDrive ? copy.driveTitle : copy.storageTitle}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{isDrive ? copy.driveBody : copy.storageBody}</p>
            <ServerActionForm action={archiveDocumentAction} className="mt-4 grid gap-2" testId={`document-archive-form-${documentId}`}>
              <input type="hidden" name="documentId" value={documentId} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger">{copy.confirm}</Button>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  {copy.cancel}
                </Button>
              </div>
            </ServerActionForm>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DocumentRestoreControl({ documentId }: { documentId: string }) {
  const { t, locale } = useI18n();
  const copy = archiveConfirmCopy(locale);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} data-testid={`document-restore-${documentId}`}>
        {t.documents.lifecycle.restore}
      </Button>
      {open ? (
        <div className={dialogBackdrop} role="dialog" aria-modal="true">
          <div className={dialogPanel}>
            <h3 className="font-semibold text-ink">{copy.restoreTitle}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{copy.restoreBody}</p>
            <ServerActionForm action={restoreDocumentAction} className="mt-4 grid gap-2">
              <input type="hidden" name="documentId" value={documentId} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit">{copy.restoreConfirm}</Button>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  {copy.cancel}
                </Button>
              </div>
            </ServerActionForm>
          </div>
        </div>
      ) : null}
    </div>
  );
}
