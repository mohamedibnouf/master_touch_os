/** Google Drive / Docs family URL parse. Server-safe; no network. */

const FILE_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

export type GoogleDriveKind = "file" | "document" | "spreadsheets" | "presentation";

export type ParsedGoogleDriveRef = {
  fileId: string;
  kind: GoogleDriveKind;
  canonicalUrl: string;
};

function exactGoogleHost(hostname: string): "drive" | "docs" | null {
  const host = hostname.toLowerCase();
  if (host === "drive.google.com") return "drive";
  if (host === "docs.google.com") return "docs";
  return null;
}

function validFileId(id: string): boolean {
  return FILE_ID_RE.test(id);
}

export function isGoogleDriveFileId(id: string): boolean {
  return FILE_ID_RE.test(id);
}

export function canonicalGoogleDriveUrl(kind: GoogleDriveKind, fileId: string): string {
  if (kind === "document") return `https://docs.google.com/document/d/${fileId}/view`;
  if (kind === "spreadsheets") return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  if (kind === "presentation") return `https://docs.google.com/presentation/d/${fileId}/view`;
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function canonicalFor(kind: GoogleDriveKind, fileId: string): string {
  return canonicalGoogleDriveUrl(kind, fileId);
}

function kindFromDocsPath(pathname: string): GoogleDriveKind | null {
  if (pathname.includes("/document/d/")) return "document";
  if (pathname.includes("/spreadsheets/d/")) return "spreadsheets";
  if (pathname.includes("/presentation/d/")) return "presentation";
  if (pathname.includes("/file/d/")) return "file";
  return null;
}

function idFromPath(pathname: string): string | null {
  const match = pathname.match(/\/(?:file|document|spreadsheets|presentation)\/d\/([^/]+)/);
  const id = match?.[1] ? decodeURIComponent(match[1]) : null;
  return id && validFileId(id) ? id : null;
}

/**
 * Parse a user-pasted Google Drive/Docs URL into a stable file id and canonical https URL.
 * Rejects non-https, non-exact Google hosts, folders, and malformed ids.
 */
export function parseGoogleDriveUrl(raw: string): ParsedGoogleDriveRef | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const hostKind = exactGoogleHost(url.hostname);
  if (!hostKind) return null;

  const openId = url.searchParams.get("id");
  if (url.pathname === "/open" && openId && validFileId(openId)) {
    return { fileId: openId, kind: "file", canonicalUrl: canonicalFor("file", openId) };
  }

  const fromPath = idFromPath(url.pathname);
  const kind = kindFromDocsPath(url.pathname);
  if (fromPath && kind) {
    if (hostKind === "docs" && kind === "file") return null;
    if (hostKind === "drive" && kind !== "file") return null;
    return { fileId: fromPath, kind, canonicalUrl: canonicalFor(kind, fromPath) };
  }

  return null;
}
