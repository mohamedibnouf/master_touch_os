import type { Locale } from "@/lib/i18n/config";

export const ARCHIVE_RESTRICTION_AR = {
  register: "لا يمكن حذف هذا المستند لأنه مسجل كمستند رسمي خاضع للتحكم.",
  transmittal: "لا يمكن حذف هذا المستند لأنه مرتبط بإرسالية رسمية.",
  engineering: "لا يمكن حذف هذا المستند لأنه مرتبط بسجل هندسي.",
  workflow: "لا يمكن حذف هذا المستند أثناء ارتباطه بسير عمل أو طلب اعتماد نشط.",
  employee: "لا يمكن حذف هذا المستند لأنه مرتبط بملف موظف.",
  businessCase: "لا يمكن حذف هذا المستند لأنه مستخدم كدراسة حالة للمشروع.",
  alreadyArchived: "هذا المستند مؤرشف مسبقاً.",
  notArchived: "هذا المستند غير مؤرشف.",
} as const;

export type ArchiveRestrictionCode = keyof typeof ARCHIVE_RESTRICTION_AR;

export const ARCHIVE_RESTRICTION_EN: Record<ArchiveRestrictionCode, string> = {
  register: "This document cannot be deleted because it is a controlled register document.",
  transmittal: "This document cannot be deleted because it is linked to an official transmittal.",
  engineering: "This document cannot be deleted because it is linked to an engineering record.",
  workflow: "This document cannot be deleted while it is linked to an active workflow or approval request.",
  employee: "This document cannot be deleted because it is linked to an employee file.",
  businessCase: "This document cannot be deleted because it is used as the project business case.",
  alreadyArchived: "This document is already archived.",
  notArchived: "This document is not archived.",
};

export function archiveRestrictionMessage(code: ArchiveRestrictionCode, locale: Locale = "ar"): string {
  return locale === "en" ? ARCHIVE_RESTRICTION_EN[code] : ARCHIVE_RESTRICTION_AR[code];
}

export type ArchiveRestrictionInput = {
  is_register_controlled: boolean;
  approval_request_id: string | null;
  workflow_instance_id: string | null;
  hasEngineeringLink: boolean;
  hasTransmittalItem: boolean;
  isProjectBusinessCase: boolean;
  hasEmployeeDocumentLink: boolean;
};

export function archiveRestrictionFor(input: ArchiveRestrictionInput): ArchiveRestrictionCode | null {
  if (input.is_register_controlled) return "register";
  if (input.approval_request_id || input.workflow_instance_id) return "workflow";
  if (input.hasEngineeringLink) return "engineering";
  if (input.hasTransmittalItem) return "transmittal";
  if (input.isProjectBusinessCase) return "businessCase";
  if (input.hasEmployeeDocumentLink) return "employee";
  return null;
}

export function isDocumentArchived(archivedAt: string | null | undefined): boolean {
  return Boolean(archivedAt);
}

export function applyArchiveFields(actorProfileId: string, atIso: string): {
  archived_at: string;
  archived_by: string;
} {
  return { archived_at: atIso, archived_by: actorProfileId };
}

export function applyRestoreFields(): { archived_at: null; archived_by: null } {
  return { archived_at: null, archived_by: null };
}

export function archivePairIsValid(archivedAt: string | null, archivedBy: string | null): boolean {
  return (archivedAt === null && archivedBy === null) || (archivedAt !== null && archivedBy !== null);
}

/** Default operational lists exclude archived rows. */
export function shouldIncludeInActiveDocumentList(archivedAt: string | null | undefined): boolean {
  return !isDocumentArchived(archivedAt);
}

export const LIFECYCLE_AUDIT = {
  archived: "document.archived",
  restored: "document.restored",
} as const;

export const ARCHIVE_CONFIRM_COPY = {
  driveTitle: "حذف المستند من النظام؟",
  driveBody:
    "سيتم إزالة المستند من نظام Master Touch فقط، ولن يتم حذف الملف الأصلي من Google Drive. يمكن استعادة المستند لاحقاً من الأرشيف.",
  storageTitle: "حذف المستند من النظام؟",
  storageBody:
    "سيتم إخفاء المستند من النظام مع الاحتفاظ بالملف والسجل والإصدارات لأغراض التدقيق، ويمكن استعادته لاحقاً.",
  confirm: "حذف المستند",
  cancel: "إلغاء",
  restoreTitle: "استعادة المستند؟",
  restoreBody: "سيظهر المستند مجدداً في القوائم التشغيلية دون تغيير الحالة أو الملفات.",
  restoreConfirm: "استعادة المستند",
} as const;

export type ArchiveConfirmCopy = { [K in keyof typeof ARCHIVE_CONFIRM_COPY]: string };

export const ARCHIVE_CONFIRM_COPY_EN: ArchiveConfirmCopy = {
  driveTitle: "Delete the document from the system?",
  driveBody:
    "The document will be removed from Master Touch only; the original file in Google Drive will not be deleted. You can restore the document later from the archive.",
  storageTitle: "Delete the document from the system?",
  storageBody:
    "The document will be hidden from the system while its file, history and revisions are kept for audit. You can restore it later.",
  confirm: "Delete document",
  cancel: "Cancel",
  restoreTitle: "Restore the document?",
  restoreBody: "The document will reappear in operational lists without changing its status or files.",
  restoreConfirm: "Restore document",
};

export function archiveConfirmCopy(locale: Locale = "ar"): ArchiveConfirmCopy {
  return locale === "en" ? ARCHIVE_CONFIRM_COPY_EN : ARCHIVE_CONFIRM_COPY;
}
