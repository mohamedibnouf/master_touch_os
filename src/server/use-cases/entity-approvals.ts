"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { isEntityApprovalTypeSupported, type SupportedEntityType } from "@/lib/approvals/entity-approval-types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createNotificationService } from "@/server/services/notification.service";

const decideEntityApprovalSchema = z.object({
  approvalRequestId: z.string().uuid(),
  stepId: z.string().uuid().optional(),
  officialCode: z.enum(["A", "B", "C", "D", "E"]),
  comment: z.string().trim().max(2000).optional(),
});

function requiredEntityPermission(entityType: SupportedEntityType): string | null {
  switch (entityType) {
    case "purchase_request":
      return "purchase_request.approve";
    case "purchase_order":
      return "purchase_order.approve";
    case "supplier_invoice":
      return "supplier_invoice.approve";
    case "client_valuation":
      return "client_valuation.approve";
    case "variation":
      return "variation.approve";
    case "quotation_comparison":
    case "quotation_recommendation":
      return null;
    default:
      return null;
  }
}

async function revalidateEntityPaths(entityType: SupportedEntityType, entityId: string) {
  const supabase = await createServerSupabaseClient();

  revalidatePath("/approvals");
  revalidatePath("/");

  switch (entityType) {
    case "purchase_request":
      revalidatePath("/procurement");
      revalidatePath("/procurement/purchase-requests");
      revalidatePath(`/procurement/purchase-requests/${entityId}`);
      return;
    case "quotation_comparison":
    case "quotation_recommendation": {
      const { data } = await supabase.from("quotation_comparisons").select("rfq_id").eq("id", entityId).maybeSingle();
      if (data?.rfq_id) {
        revalidatePath("/procurement");
        revalidatePath("/procurement/rfqs");
        revalidatePath(`/procurement/rfqs/${data.rfq_id}`);
        revalidatePath(`/procurement/rfqs/${data.rfq_id}/comparison`);
      }
      return;
    }
    case "purchase_order":
      revalidatePath("/procurement");
      revalidatePath("/procurement/purchase-orders");
      revalidatePath(`/procurement/purchase-orders/${entityId}`);
      return;
    case "supplier_invoice":
      revalidatePath("/finance");
      revalidatePath("/finance/supplier-invoices");
      revalidatePath(`/finance/supplier-invoices/${entityId}`);
      return;
    case "client_valuation":
      revalidatePath("/finance");
      revalidatePath("/finance/client-valuations");
      revalidatePath(`/finance/client-valuations/${entityId}`);
      return;
    case "variation":
      revalidatePath("/finance");
      revalidatePath("/finance/variations");
      revalidatePath(`/finance/variations/${entityId}`);
      return;
  }
}

export async function decideEntityApprovalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تسجيل قرار الاعتماد. حاول مرة أخرى.", async () => {
  const parsed = decideEntityApprovalSchema.safeParse({
    approvalRequestId: formData.get("approvalRequestId"),
    stepId: formData.get("stepId") || undefined,
    officialCode: formData.get("officialCode"),
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("قرار الموافقة غير صالح.", "Invalid approval decision.");
  }

  const approvalPermission = parsed.data.officialCode === "D" ? "approval.reject" : "approval.approve";
  const ctx = authorize(await getAuthContext(), approvalPermission);

  const supabase = await createServerSupabaseClient();
  const { data: request, error: requestError } = await supabase
    .from("approval_requests")
    .select("id, entity_type, entity_id, title, requested_by")
    .eq("id", parsed.data.approvalRequestId)
    .maybeSingle<{
      id: string;
      entity_type: string;
      entity_id: string;
      title: string;
      requested_by: string;
    }>();
  if (requestError) throw new DatabaseError(requestError);
  if (!request) throw new NotFoundError("طلب الموافقة", "Approval request");
  if (!isEntityApprovalTypeSupported(request.entity_type)) {
    throw new ValidationError(
      "هذا النوع من الموافقات غير مدعوم عبر المسار الموحّد حالياً.",
      `Unsupported entity approval type: ${request.entity_type}.`,
    );
  }

  const entityPermission = requiredEntityPermission(request.entity_type);
  if (entityPermission) {
    authorize(ctx, entityPermission as never);
  }

  const { data, error } = await supabase.rpc("decide_entity_approval", {
    p_request_id: parsed.data.approvalRequestId,
    p_step_id: parsed.data.stepId ?? null,
    p_official_code: parsed.data.officialCode,
    p_comment: parsed.data.comment ?? null,
  });
  if (error) {
    if (error.message.includes("CONFLICT")) {
      throw new ConflictError("تم اتخاذ قرار على هذه الخطوة مسبقاً.", "This approval step was already decided.");
    }
    if (error.message.includes("FORBIDDEN")) {
      throw new ValidationError("ليست لديك صلاحية الاعتماد.", "You cannot decide this approval.");
    }
    if (error.message.includes("AMBIGUOUS_STEP")) {
      throw new ValidationError("تعذر تحديد خطوة الاعتماد المطلوبة بدقة.", "Approval step selection is ambiguous.");
    }
    if (error.message.includes("NOT_SUPPORTED")) {
      throw new ValidationError("نوع الكيان غير مدعوم.", "Unsupported entity type.");
    }
    if (error.message.includes("VALIDATION")) {
      throw new ValidationError("قرار الموافقة غير صالح لهذه المعاملة.", "Invalid entity approval decision.");
    }
    throw new DatabaseError(error);
  }

  const result = data as {
    entity_type: SupportedEntityType;
    entity_id: string;
    request_status: string;
    official_outcome: string;
    next_step_user_id: string | null;
  } | null;
  if (!result) {
    throw new ValidationError("تعذر إتمام قرار الاعتماد.", "Entity approval RPC returned no result.");
  }

  const notifications = createNotificationService(supabase);
  const outcomeLabel =
    result.official_outcome === "rejected"
      ? "مرفوض"
      : result.official_outcome === "resubmit"
        ? "إعادة تقديم"
        : "معتمد";

  if (request.requested_by && request.requested_by !== ctx.userId) {
    await notifications.notify({
      organizationId: ctx.organization.id,
      recipientProfileId: request.requested_by,
      type: "approval.decided",
      title: request.title,
      message: `تم تحديث طلب الموافقة: ${outcomeLabel}`,
      entityType: request.entity_type,
      entityId: request.entity_id,
      priority: "high",
    });
  }

  if (result.request_status === "in_progress" && result.next_step_user_id && result.next_step_user_id !== ctx.userId) {
    await notifications.notify({
      organizationId: ctx.organization.id,
      recipientProfileId: result.next_step_user_id,
      type: "approval.required",
      title: request.title,
      message: "مطلوب إجراء موافقة",
      entityType: request.entity_type,
      entityId: request.entity_id,
      priority: "high",
    });
  }

  await revalidateEntityPaths(result.entity_type, result.entity_id);
  });
}
