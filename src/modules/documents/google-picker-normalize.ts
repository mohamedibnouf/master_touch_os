import {
  canonicalGoogleDriveUrl,
  isGoogleDriveFileId,
  parseGoogleDriveUrl,
  type GoogleDriveKind,
  type ParsedGoogleDriveRef,
} from "./google-drive-url";

export type GooglePickerDocumentLike = {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
  type?: string;
  sizeBytes?: number;
};

export type NormalizedGooglePickerFile = {
  fileId: string;
  name: string;
  mimeType: string | null;
  kind: GoogleDriveKind;
  canonicalUrl: string;
};

const NATIVE_MIME: Record<string, GoogleDriveKind> = {
  "application/vnd.google-apps.document": "document",
  "application/vnd.google-apps.spreadsheet": "spreadsheets",
  "application/vnd.google-apps.presentation": "presentation",
};

const REJECTED_MIME = new Set([
  "application/vnd.google-apps.folder",
  "application/vnd.google-apps.shortcut",
]);

export function driveKindFromMimeType(mimeType: string | undefined): GoogleDriveKind {
  if (!mimeType) return "file";
  return NATIVE_MIME[mimeType] ?? "file";
}

function safeMimeType(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value || value.length > 180) return null;
  if (!/^[a-z0-9.+*-]+\/[a-z0-9.+*-]+$/i.test(value)) return null;
  return value;
}

/**
 * Map a Picker document into the Phase 1 Drive reference.
 * Canonical URL is always rebuilt; Picker `url` is only a hint for parseGoogleDriveUrl.
 */
export function normalizeGooglePickerDocument(doc: GooglePickerDocumentLike | null | undefined): NormalizedGooglePickerFile | null {
  if (!doc) return null;
  const mime = safeMimeType(doc.mimeType);
  if (mime && REJECTED_MIME.has(mime)) return null;

  const fromHint = doc.url ? parseGoogleDriveUrl(doc.url) : null;
  const fileId = (doc.id && isGoogleDriveFileId(doc.id) ? doc.id : null) ?? fromHint?.fileId ?? null;
  if (!fileId) return null;

  const kind = fromHint?.kind ?? driveKindFromMimeType(mime ?? undefined);
  const rebuilt = canonicalGoogleDriveUrl(kind, fileId);
  const authoritative = parseGoogleDriveUrl(rebuilt);
  if (!authoritative) return null;

  const name = (doc.name ?? "").trim().slice(0, 240);
  return {
    fileId: authoritative.fileId,
    name: name || "Google Drive",
    mimeType: mime,
    kind: authoritative.kind,
    canonicalUrl: authoritative.canonicalUrl,
  };
}

export function parsedDriveFromCanonicalUrl(url: string): ParsedGoogleDriveRef | null {
  return parseGoogleDriveUrl(url);
}

/** Fields allowed on Drive create FormData — never access tokens. */
export const DRIVE_DOCUMENT_FORM_FIELDS = [
  "title",
  "category",
  "projectId",
  "documentId",
  "confidentiality",
  "fileSource",
  "driveUrl",
  "driveMimeType",
  "file",
] as const;

export function driveSubmitIncludesTokenField(fieldNames: readonly string[]): boolean {
  return fieldNames.some((name) => /access[_-]?token|refresh[_-]?token|oauth/i.test(name));
}
