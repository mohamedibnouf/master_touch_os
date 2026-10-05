import Link from "next/link";
import { Badge, Button } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { openStorageDocumentAction } from "@/server/use-cases/platform";
import { documentFileSourceLabelAr, driveOpenHref } from "@/modules/documents/file-source";

export type DocumentFileRef = {
  file_source: string | null;
  external_url: string | null;
  file_path: string | null;
};

export function DocumentOpenControl({
  documentId,
  file,
  canOpenStorage,
}: {
  documentId: string;
  file: DocumentFileRef | null;
  canOpenStorage: boolean;
}) {
  const driveHref = driveOpenHref(file);
  if (driveHref) {
    return (
      <a
        href={driveHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line bg-white px-3 py-2 text-sm font-medium text-navy shadow-[var(--shadow-1)]"
        data-testid={`document-open-drive-${documentId}`}
      >
        فتح الملف
      </a>
    );
  }
  if (file?.file_source === "storage" && file.file_path && canOpenStorage) {
    return (
      <ServerActionForm action={openStorageDocumentAction}>
        <input type="hidden" name="documentId" value={documentId} />
        <Button type="submit" variant="secondary" data-testid={`document-open-storage-${documentId}`}>
          فتح الملف
        </Button>
      </ServerActionForm>
    );
  }
  return null;
}

export function DocumentSourceBadge({ source }: { source: string | null | undefined }) {
  const value = source ?? "storage";
  const tone = value === "google_drive" || value === "drive" ? "info" : value === "archived" ? "neutral" : "neutral";
  return (
    <Badge tone={tone} data-testid="document-source-badge">
      {documentFileSourceLabelAr(value)}
    </Badge>
  );
}

export function DocumentDetailsLink({ documentId }: { documentId: string }) {
  return (
    <Link href={`/documents/${documentId}`} className="text-sm text-navy underline" data-testid={`document-details-${documentId}`}>
      عرض التفاصيل
    </Link>
  );
}
