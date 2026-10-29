import { Badge } from "@/components/ui/primitives";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import type { Locale } from "@/lib/i18n/config";

const toneMap: Record<string, "neutral" | "success" | "danger" | "warning" | "navy"> = {
  draft: "neutral",
  submitted: "navy",
  under_review: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  issued: "navy",
  paid: "success",
  partially_paid: "warning",
  overdue: "danger",
  discrepancy: "danger",
  matched: "success",
  awarded: "success",
  open: "warning",
  pending_approval: "warning",
  recommended: "navy",
  partially_delivered: "warning",
  delivered: "success",
  approved_for_payment: "success",
  received: "navy",
  active: "success",
  suspended: "warning",
  blocked: "danger",
  converted_to_rfq: "success",
  under_comparison: "warning",
  responses_received: "navy",
  accepted: "success",
  partially_accepted: "warning",
  partially_invoiced: "warning",
  invoiced: "navy",
  closed: "neutral",
  archived: "neutral",
  internal_review: "warning",
  under_client_review: "navy",
  partially_certified: "warning",
  certified: "success",
  eligible: "navy",
  partially_approved: "warning",
  negotiation: "warning",
  terminated: "danger",
  completed: "success",
  planned: "neutral",
  claimed: "navy",
};

export function CommercialStatusBadge({ status, locale = "ar" }: { status: string; locale?: Locale }) {
  const tone = toneMap[status] ?? "neutral";
  return <Badge tone={tone}>{commercialStatusLabel(status, locale)}</Badge>;
}
