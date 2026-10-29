"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { openStorageDocumentAction } from "@/server/use-cases/platform";
import { documentFileSourceLabel, driveOpenHref } from "@/modules/documents/file-source";
import { useI18n } from "@/lib/i18n/client";

export type DocumentFileRef = {
  file_source: string | null;
  external_url: string | null;
  file_path: string | null;
};

export function DocumentOpenControl({
  documentId,
  file,
  canOpenStorage,
  versionId,
}: {
  documentId: string;
  file: DocumentFileRef | null;
  canOpenStorage: boolean;
  versionId?: string;
}) {
  const { t } = useI18n();
  const driveHref = driveOpenHref(file);
  if (driveHref) {
    return (
      <a
        href={driveHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink shadow-card transition-colors hover:border-border-strong hover:bg-surface-muted md:min-h-9"
        data-testid={`document-open-drive-${versionId ?? documentId}`}
      >
        <ExternalLink className="size-3.5 text-muted" aria-hidden />
        {t.documents.openControl.openFile}
      </a>
    );
  }
  if (file?.file_source === "storage" && file.file_path && canOpenStorage) {
    return (
      <ServerActionForm action={openStorageDocumentAction}>
        <input type="hidden" name="documentId" value={documentId} />
        {versionId ? <input type="hidden" name="versionId" value={versionId} /> : null}
        <Button type="submit" variant="secondary" data-testid={`document-open-storage-${versionId ?? documentId}`}>
          {t.documents.openControl.openFile}
        </Button>
      </ServerActionForm>
    );
  }
  return null;
}

export function DocumentSourceBadge({ source }: { source: string | null | undefined }) {
  const { locale } = useI18n();
  const value = source ?? "storage";
  const tone = value === "google_drive" || value === "drive" ? "info" : "neutral";
  return (
    <Badge tone={tone} data-testid="document-source-badge">
      {documentFileSourceLabel(value, locale)}
    </Badge>
  );
}

export function DocumentDetailsLink({ documentId }: { documentId: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/documents/${documentId}`}
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      data-testid={`document-details-${documentId}`}
    >
      {t.documents.openControl.details}
    </Link>
  );
}
