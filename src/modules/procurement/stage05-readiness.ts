import { isPostgresUuid } from "@/lib/postgres-uuid";

export const PROCUREMENT_STEP_KEY = "procurement";

export const ISSUED_PO_STATUSES = [
  "issued",
  "partially_delivered",
  "delivered",
  "partially_invoiced",
  "invoiced",
  "closed",
] as const;

export type IssuedPoStatus = (typeof ISSUED_PO_STATUSES)[number];

export const PROCUREMENT_DOCUMENT_POLICY = "ui_advisory" as const;

export type ProcurementReadinessCounts = {
  purchase_request_count: number;
  rfq_count: number;
  quotation_count: number;
  awarded_count: number;
  issued_po_count: number;
  issued_po_with_delivery_date_count: number;
  supporting_document_count: number;
};

export type ProjectProcurementReadiness = ProcurementReadinessCounts & {
  ready: boolean;
  document_enforced: false;
  document_policy: typeof PROCUREMENT_DOCUMENT_POLICY;
  missing: string[];
};

export const PROCUREMENT_MISSING_LABELS: Record<string, string> = {
  pr: "طلب شراء مرتبط بالمشروع",
  rfq: "طلب عروض أسعار صادر عن طلب الشراء",
  quotation: "عرض مورد على طلب العروض",
  award: "ترسية رسمية عبر المقارنة",
  issued_po: "أمر شراء صادر",
  delivery_date: "تاريخ تسليم مطلوب على أمر الشراء",
};

export function isIssuedPurchaseOrderStatus(status: string | null | undefined): boolean {
  return Boolean(status && (ISSUED_PO_STATUSES as readonly string[]).includes(status));
}

export function parseScopedProjectId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return isPostgresUuid(trimmed) ? trimmed : null;
}

export function procurementHrefForProject(projectId: string): string {
  const id = parseScopedProjectId(projectId);
  if (!id) return "/procurement";
  return `/procurement?project=${id}`;
}

export function newPurchaseRequestHref(projectId: string | null): string {
  const id = parseScopedProjectId(projectId);
  if (!id) return "/procurement/purchase-requests/new";
  return `/procurement/purchase-requests/new?project=${id}`;
}

export function evaluateProcurementReadiness(counts: ProcurementReadinessCounts): ProjectProcurementReadiness {
  const missing: string[] = [];
  if (counts.purchase_request_count < 1) missing.push("pr");
  if (counts.rfq_count < 1) missing.push("rfq");
  if (counts.quotation_count < 1) missing.push("quotation");
  if (counts.awarded_count < 1) missing.push("award");
  if (counts.issued_po_count < 1) missing.push("issued_po");
  if (counts.issued_po_with_delivery_date_count < 1) missing.push("delivery_date");
  return {
    ...counts,
    ready: missing.length === 0,
    document_enforced: false,
    document_policy: PROCUREMENT_DOCUMENT_POLICY,
    missing,
  };
}

export function parseProcurementReadiness(raw: unknown): ProjectProcurementReadiness | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const counted = evaluateProcurementReadiness({
    purchase_request_count: num("purchase_request_count"),
    rfq_count: num("rfq_count"),
    quotation_count: num("quotation_count"),
    awarded_count: num("awarded_count"),
    issued_po_count: num("issued_po_count"),
    issued_po_with_delivery_date_count: num("issued_po_with_delivery_date_count"),
    supporting_document_count: num("supporting_document_count"),
  });
  if (typeof row.ready === "boolean") {
    return { ...counted, ready: row.ready, missing: row.ready ? [] : counted.missing };
  }
  return counted;
}

export function milestoneState(count: number): "empty" | "progress" | "complete" {
  if (count <= 0) return "empty";
  return "complete";
}
