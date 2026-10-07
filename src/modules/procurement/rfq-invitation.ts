import { isPostgresUuid } from "@/lib/postgres-uuid";

export const RFQ_INVITE_EDITABLE_STATUSES = ["draft", "ready_to_issue"] as const;

export type RfqInviteEditableStatus = (typeof RFQ_INVITE_EDITABLE_STATUSES)[number];

export function isRfqInvitationEditable(status: string | null | undefined): boolean {
  return Boolean(status && (RFQ_INVITE_EDITABLE_STATUSES as readonly string[]).includes(status));
}

export function parseSupplierId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return isPostgresUuid(trimmed) ? trimmed : null;
}

export function evaluateRfqSupplierEligibility(input: {
  supplierId: string | null;
  actorOrganizationId: string;
  supplierOrganizationId: string | null;
  supplierStatus: string | null;
}): { ok: true } | { ok: false; code: "INVALID_ID" | "ORG_MISMATCH" | "INACTIVE" } {
  if (!input.supplierId) return { ok: false, code: "INVALID_ID" };
  if (!input.supplierOrganizationId || input.supplierOrganizationId !== input.actorOrganizationId) {
    return { ok: false, code: "ORG_MISMATCH" };
  }
  if (input.supplierStatus !== "active") return { ok: false, code: "INACTIVE" };
  return { ok: true };
}

export const RFQ_INVITE_ERROR = {
  INVALID_ID: { ar: "معرّف المورد غير صالح.", en: "Invalid supplier id." },
  ORG_MISMATCH: { ar: "لا يمكن دعوة مورد من خارج المؤسسة.", en: "Supplier is not in this organization." },
  INACTIVE: { ar: "يمكن دعوة الموردين النشطين فقط.", en: "Only active suppliers can be invited." },
  DUPLICATE: { ar: "هذا المورد مدعو مسبقاً إلى طلب العروض.", en: "Supplier is already invited to this RFQ." },
  NOT_EDITABLE: { ar: "لا يمكن تعديل قائمة الموردين بعد إصدار طلب العروض.", en: "Supplier list cannot be changed after the RFQ is issued." },
} as const;
