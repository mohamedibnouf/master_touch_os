import { ConflictError, DatabaseError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";

/** Operational letter revisions (A→B→C). Not register-controlled R00/R01. */

export const OPERATIONAL_REVISION_RPC = "create_operational_document_version";

export const OPERATIONAL_REVISION_AUDIT = "document.revised";

/** Storage has no DELETE policy. Do not invent a cleanup that weakens RLS. */
export const OPERATIONAL_ORPHAN_CLEANUP = "log_only" as const;

export function nextOperationalRevision(current: string): string | null {
  const letter = current.trim().toUpperCase();
  if (!/^[A-Y]$/.test(letter)) return null;
  return String.fromCharCode(letter.charCodeAt(0) + 1);
}

export function operationalStoragePathPrefix(input: {
  organizationId: string;
  projectId: string | null;
  documentId: string;
  revision: string;
}): string {
  return [input.organizationId, input.projectId ?? "org", input.documentId, input.revision].join("/") + "/";
}

export function operationalStorageObjectPath(input: {
  organizationId: string;
  projectId: string | null;
  documentId: string;
  revision: string;
  safeFileName: string;
}): string {
  return `${operationalStoragePathPrefix(input)}${input.safeFileName}`;
}

export function storagePathMatchesRevision(path: string, prefix: string): boolean {
  return path.startsWith(prefix) && path.length > prefix.length;
}

export function canOfferOperationalRevision(input: {
  hasDocumentUpload: boolean;
  isArchived: boolean;
  isRegisterControlled: boolean;
}): boolean {
  return input.hasDocumentUpload && !input.isArchived && !input.isRegisterControlled;
}

export type OperationalRevisionDenial =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "REGISTER_CONTROLLED"
  | "ARCHIVED"
  | "STALE_REVISION"
  | "VALIDATION"
  | "NO_CURRENT_VERSION";

export type OperationalDocumentSnapshot = {
  id: string;
  organizationId: string;
  projectId: string | null;
  currentRevision: string;
  status: string;
  approvalState: string | null;
  officialDecision: string | null;
  submissionStatus: string | null;
  workflowInstanceId: string | null;
  approvalRequestId: string | null;
  isRegisterControlled: boolean;
  archivedAt: string | null;
};

export type OperationalVersionSnapshot = {
  id: string;
  documentId: string;
  revision: string;
  fileSource: "storage" | "google_drive";
  filePath: string | null;
  fileName: string;
  isCurrent: boolean;
  isSuperseded: boolean;
  uploadedBy: string;
};

export type OperationalRevisionActor = {
  userId: string | null;
  organizationId: string;
  membershipActive: boolean;
  profileActive: boolean;
  hasDocumentUpload: boolean;
  hasDocumentApprove: boolean;
  hasWorkflowAdvance: boolean;
};

export type OperationalRevisionFile =
  | {
      fileSource: "storage";
      filePath: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      checksum: string | null;
    }
  | {
      fileSource: "google_drive";
      fileName: string;
      mimeType: string | null;
      externalFileId: string;
      externalUrl: string;
    };

export function authorizeOperationalRevision(input: {
  actor: OperationalRevisionActor;
  document: OperationalDocumentSnapshot | null;
  currentVersion: OperationalVersionSnapshot | null;
  expectedCurrentRevision: string;
}): OperationalRevisionDenial | null {
  if (!input.actor.userId) return "UNAUTHORIZED";
  if (!input.document) return "NOT_FOUND";
  if (input.document.organizationId !== input.actor.organizationId) return "FORBIDDEN";
  if (!input.actor.membershipActive || !input.actor.profileActive) return "FORBIDDEN";
  if (!input.actor.hasDocumentUpload) return "FORBIDDEN";
  if (input.document.isRegisterControlled) return "REGISTER_CONTROLLED";
  if (input.document.archivedAt) return "ARCHIVED";
  if (!input.currentVersion || !input.currentVersion.isCurrent) return "NO_CURRENT_VERSION";
  if (input.currentVersion.documentId !== input.document.id) return "VALIDATION";
  if (input.currentVersion.revision !== input.document.currentRevision) return "VALIDATION";
  if (input.expectedCurrentRevision.trim().toUpperCase() !== input.document.currentRevision) {
    return "STALE_REVISION";
  }
  if (!nextOperationalRevision(input.document.currentRevision)) return "VALIDATION";
  return null;
}

export function applyOperationalRevision(input: {
  actor: OperationalRevisionActor;
  document: OperationalDocumentSnapshot;
  versions: OperationalVersionSnapshot[];
  expectedCurrentRevision: string;
  file: OperationalRevisionFile;
  newVersionId: string;
}):
  | { ok: false; denial: OperationalRevisionDenial }
  | {
      ok: true;
      document: OperationalDocumentSnapshot;
      versions: OperationalVersionSnapshot[];
      nextRevision: string;
    } {
  const currentVersion = input.versions.find((row) => row.isCurrent) ?? null;
  const denial = authorizeOperationalRevision({
    actor: input.actor,
    document: input.document,
    currentVersion,
    expectedCurrentRevision: input.expectedCurrentRevision,
  });
  if (denial) return { ok: false, denial };

  const next = nextOperationalRevision(input.document.currentRevision);
  if (!next) return { ok: false, denial: "VALIDATION" };

  if (input.versions.some((row) => row.revision === next)) {
    return { ok: false, denial: "STALE_REVISION" };
  }

  if (input.file.fileSource === "storage") {
    const prefix = operationalStoragePathPrefix({
      organizationId: input.document.organizationId,
      projectId: input.document.projectId,
      documentId: input.document.id,
      revision: next,
    });
    if (!storagePathMatchesRevision(input.file.filePath, prefix)) {
      return { ok: false, denial: "VALIDATION" };
    }
    if (currentVersion?.filePath && input.file.filePath === currentVersion.filePath) {
      return { ok: false, denial: "VALIDATION" };
    }
  }

  const versions = input.versions.map((row) =>
    row.isCurrent
      ? { ...row, isCurrent: false, isSuperseded: true }
      : row,
  );
  versions.push({
    id: input.newVersionId,
    documentId: input.document.id,
    revision: next,
    fileSource: input.file.fileSource,
    filePath: input.file.fileSource === "storage" ? input.file.filePath : null,
    fileName: input.file.fileName,
    isCurrent: true,
    isSuperseded: false,
    uploadedBy: input.actor.userId as string,
  });

  const currentCount = versions.filter((row) => row.isCurrent).length;
  if (currentCount !== 1) return { ok: false, denial: "VALIDATION" };

  return {
    ok: true,
    nextRevision: next,
    document: {
      ...input.document,
      currentRevision: next,
      status: "submitted",
    },
    versions,
  };
}

export function mapOperationalRevisionRpcError(message: string): {
  kind: "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "VALIDATION" | "NOT_FOUND" | "DATABASE";
  ar: string;
  en: string;
} {
  if (message.includes("UNAUTHORIZED")) {
    return { kind: "UNAUTHORIZED", ar: "يجب تسجيل الدخول للمتابعة.", en: "You must sign in to continue." };
  }
  if (message.includes("STALE_REVISION") || message.includes("CONFLICT")) {
    return {
      kind: "CONFLICT",
      ar: "تم إنشاء إصدار أحدث. حدّث الصفحة ثم أعد المحاولة.",
      en: "A newer revision already exists. Refresh and try again.",
    };
  }
  if (message.includes("REGISTER_CONTROLLED")) {
    return {
      kind: "VALIDATION",
      ar: "لا يمكن إضافة إصدار تشغيلي لمستند سجل رسمي.",
      en: "Register-controlled documents cannot use operational letter revisions.",
    };
  }
  if (message.includes("ARCHIVED")) {
    return {
      kind: "VALIDATION",
      ar: "لا يمكن إضافة إصدار لمستند مؤرشف.",
      en: "Archived documents cannot receive a new revision.",
    };
  }
  if (message.includes("FORBIDDEN")) {
    return {
      kind: "FORBIDDEN",
      ar: "ليست لديك صلاحية لتنفيذ هذه العملية.",
      en: "You cannot perform this action.",
    };
  }
  if (message.includes("NOT_FOUND")) {
    return { kind: "NOT_FOUND", ar: "المستند غير موجود.", en: "Document was not found." };
  }
  if (message.includes("VALIDATION")) {
    return { kind: "VALIDATION", ar: "تعذر تسجيل الإصدار الجديد.", en: "The new revision could not be registered." };
  }
  return { kind: "DATABASE", ar: "حدث خطأ أثناء حفظ البيانات. حاول مرة أخرى.", en: "A data error occurred." };
}

export function throwOperationalRevisionRpcError(message: string): never {
  const mapped = mapOperationalRevisionRpcError(message);
  if (mapped.kind === "UNAUTHORIZED") throw new UnauthorizedError();
  if (mapped.kind === "FORBIDDEN") throw new ForbiddenError({ rpc: OPERATIONAL_REVISION_RPC });
  if (mapped.kind === "CONFLICT") throw new ConflictError(mapped.ar, mapped.en);
  if (mapped.kind === "NOT_FOUND") throw new NotFoundError("المستند", "Document");
  if (mapped.kind === "VALIDATION") throw new ValidationError(mapped.ar, mapped.en);
  throw new DatabaseError(message);
}
