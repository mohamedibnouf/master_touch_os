"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { archiveDocumentAction, restoreDocumentAction } from "@/server/use-cases/document-lifecycle";
import { ARCHIVE_CONFIRM_COPY } from "@/modules/documents/lifecycle";

export function DocumentArchiveControl({
  documentId,
  fileSource,
}: {
  documentId: string;
  fileSource: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const isDrive = fileSource === "google_drive";

  return (
    <div>
      <Button type="button" variant="danger" onClick={() => setOpen(true)} data-testid={`document-archive-${documentId}`}>
        حذف المستند
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[var(--radius-control)] border border-line bg-white p-4 shadow-[var(--shadow-2)]">
            <h3 className="font-semibold text-navy">{isDrive ? ARCHIVE_CONFIRM_COPY.driveTitle : ARCHIVE_CONFIRM_COPY.storageTitle}</h3>
            <p className="mt-2 text-sm text-ink">{isDrive ? ARCHIVE_CONFIRM_COPY.driveBody : ARCHIVE_CONFIRM_COPY.storageBody}</p>
            <ServerActionForm action={archiveDocumentAction} className="mt-4 grid gap-2" testId={`document-archive-form-${documentId}`}>
              <input type="hidden" name="documentId" value={documentId} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit">{ARCHIVE_CONFIRM_COPY.confirm}</Button>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  {ARCHIVE_CONFIRM_COPY.cancel}
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
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} data-testid={`document-restore-${documentId}`}>
        استعادة المستند
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[var(--radius-control)] border border-line bg-white p-4 shadow-[var(--shadow-2)]">
            <h3 className="font-semibold text-navy">{ARCHIVE_CONFIRM_COPY.restoreTitle}</h3>
            <p className="mt-2 text-sm text-ink">{ARCHIVE_CONFIRM_COPY.restoreBody}</p>
            <ServerActionForm action={restoreDocumentAction} className="mt-4 grid gap-2">
              <input type="hidden" name="documentId" value={documentId} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit">{ARCHIVE_CONFIRM_COPY.restoreConfirm}</Button>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  {ARCHIVE_CONFIRM_COPY.cancel}
                </Button>
              </div>
            </ServerActionForm>
          </div>
        </div>
      ) : null}
    </div>
  );
}
