"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import {
  evaluateRfqSupplierEligibility,
  isRfqInvitationEditable,
  parseSupplierId,
  RFQ_INVITE_ERROR,
} from "@/modules/procurement/rfq-invitation";
import type { AuthContext } from "@/types/models";
import { AuditService } from "@/server/services/audit.service";
import { EventService } from "@/server/services/event.service";
import { createNotificationService } from "@/server/services/notification.service";
import { grossWithVat, lineTotal, roundMoney, vatAmount } from "@/server/domain/commercial";
import { generateCorrelationId } from "@/lib/utils";

function revalidateCommercial(...paths: string[]) {
  for (const path of paths) revalidatePath(path);
}

function authorizeRfqInvitationMutation(ctx: AuthContext | null): AuthContext {
  const user = authorize(ctx, "rfq.read");
  if (!hasPermission(user, "rfq.issue") && !hasPermission(user, "rfq.manage")) {
    throw new ForbiddenError({ permission: "rfq.issue" });
  }
  return user;
}

export async function createSupplierAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "supplier.manage");
  const legalName = String(formData.get("legalName") ?? "").trim();
  const tradeName = String(formData.get("tradeName") ?? "") || null;
  const email = String(formData.get("email") ?? "") || null;
  const phone = String(formData.get("phone") ?? "") || null;
  const city = String(formData.get("city") ?? "") || null;
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  const commercialRegistration = String(formData.get("commercialRegistration") ?? "") || null;
  const vatNumber = String(formData.get("vatNumber") ?? "") || null;
  const paymentTermsDays = Number(formData.get("paymentTermsDays") ?? 30) || 30;
  const notes = String(formData.get("notes") ?? "") || null;
  if (legalName.length < 2) {
    throw new ValidationError("اسم المورد غير مكتمل.", "Supplier name incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: code, error: codeErr } = await supabase.rpc("generate_supplier_code", {
    p_organization_id: ctx.organization.id,
  });
  if (codeErr || !code) throw new DatabaseError(codeErr);

  const { data: supplier, error } = await supabase
    .from("suppliers")
    .insert({
      organization_id: ctx.organization.id,
      supplier_code: code,
      legal_name: legalName,
      trade_name: tradeName,
      email,
      phone,
      city,
      category_id: categoryId,
      commercial_registration: commercialRegistration,
      vat_number: vatNumber,
      payment_terms_days: paymentTermsDays,
      notes,
      status: "active",
      created_by: ctx.userId,
    })
    .select("id, supplier_code")
    .single();
  if (error || !supplier) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "supplier.created",
    entityType: "supplier",
    entityId: supplier.id,
    newValues: { supplier_code: supplier.supplier_code },
  });

  revalidateCommercial("/procurement", "/procurement/suppliers");
  });
}

export async function createPurchaseRequestAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "purchase_request.create");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      justification: z.string().trim().min(3).max(4000),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      requiredDate: z.string().optional(),
      itemDescription: z.string().trim().min(2).max(500),
      quantity: z.coerce.number().positive(),
      estimatedUnitCost: z.coerce.number().nonnegative().optional(),
    })
    .safeParse({
      projectId: formData.get("projectId"),
      justification: formData.get("justification"),
      priority: formData.get("priority") || "medium",
      requiredDate: formData.get("requiredDate") || undefined,
      itemDescription: formData.get("itemDescription"),
      quantity: formData.get("quantity"),
      estimatedUnitCost: formData.get("estimatedUnitCost") || undefined,
    });
  if (!parsed.success) {
    throw new ValidationError("بيانات طلب الشراء غير مكتملة.", "PR data incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: number, error: numErr } = await supabase.rpc("generate_commercial_number", {
    p_organization_id: ctx.organization.id,
    p_project_id: parsed.data.projectId,
    p_doc_type: "PR",
  });
  if (numErr || !number) throw new DatabaseError(numErr);

  const estimated =
    parsed.data.estimatedUnitCost != null
      ? roundMoney(parsed.data.quantity * parsed.data.estimatedUnitCost)
      : null;

  const { data: pr, error } = await supabase
    .from("purchase_requests")
    .insert({
      organization_id: ctx.organization.id,
      project_id: parsed.data.projectId,
      pr_number: number,
      requested_by: ctx.userId,
      justification: parsed.data.justification,
      priority: parsed.data.priority,
      required_date: parsed.data.requiredDate || null,
      estimated_cost: estimated,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id, pr_number")
    .single();
  if (error || !pr) throw new DatabaseError(error);

  const { error: itemErr } = await supabase.from("purchase_request_items").insert({
    organization_id: ctx.organization.id,
    purchase_request_id: pr.id,
    line_no: 1,
    description: parsed.data.itemDescription,
    quantity: parsed.data.quantity,
    estimated_unit_cost: parsed.data.estimatedUnitCost ?? null,
    estimated_total: estimated,
  });
  if (itemErr) throw new DatabaseError(itemErr);

  await new EventService(supabase).publish({
    type: "purchase_request.created",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "purchase_request",
    entityId: pr.id,
    payload: { pr_number: pr.pr_number },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidateCommercial("/procurement", "/procurement/purchase-requests", `/projects/${parsed.data.projectId}`);
  });
}

async function createCommercialApproval(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>,
  input: { title: string; entityType: string; entityId: string; approverProfileId: string },
) {
  const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: request, error } = await supabase
    .from("approval_requests")
    .insert({
      organization_id: ctx.organization.id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      title: input.title,
      status: "in_progress",
      mode: "sequential",
      requested_by: ctx.userId,
      due_at: dueAt,
      warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !request) throw new DatabaseError(error);

  const { error: stepError } = await supabase.from("approval_steps").insert({
    organization_id: ctx.organization.id,
    request_id: request.id,
    sequence: 1,
    approver_type: "user",
    user_id: input.approverProfileId,
    status: "pending",
    due_at: dueAt,
    warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
  });
  if (stepError) throw new DatabaseError(stepError);

  await createNotificationService(supabase).notify({
    organizationId: ctx.organization.id,
    recipientProfileId: input.approverProfileId,
    type: "approval.required",
    title: input.title,
    message: "مطلوب إجراء موافقة",
    entityType: input.entityType,
    entityId: input.entityId,
  });

  return request.id;
}

async function requireThresholdRule(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: string,
  processType: string,
  amount: number,
) {
  const { data: rules } = await supabase
    .from("approval_threshold_rules")
    .select("id, min_amount, max_amount, required_roles, notes")
    .eq("organization_id", organizationId)
    .eq("process_type", processType)
    .eq("is_active", true)
    .order("min_amount", { ascending: true });

  const match = (rules ?? []).find((rule) => {
    const min = Number(rule.min_amount);
    const max = rule.max_amount == null ? Number.POSITIVE_INFINITY : Number(rule.max_amount);
    return amount >= min && amount <= max;
  });
  if (!match) {
    throw new ValidationError(
      "لا توجد قاعدة اعتماد مفعّلة لهذا المبلغ. أوقف الترسية حتى يضبط المسؤول قواعد العتبات.",
      "No active approval threshold rule matches this amount. Award is blocked until admin configures thresholds.",
    );
  }
  return match;
}

export async function submitPurchaseRequestForApprovalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "purchase_request.create");
  const prId = String(formData.get("prId") ?? "");
  const approverProfileId = String(formData.get("approverProfileId") ?? "");
  if (!prId || !approverProfileId) {
    throw new ValidationError("بيانات التقديم غير مكتملة.", "Submit data incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("purchase_requests")
    .select("id, status, project_id, pr_number")
    .eq("id", prId)
    .maybeSingle();
  if (!existing || !["draft", "submitted"].includes(existing.status)) {
    throw new ValidationError("لا يمكن تقديم الطلب من حالته الحالية.", "Invalid PR status.");
  }

  const approvalId = await createCommercialApproval(supabase, ctx, {
    title: `اعتماد طلب شراء ${existing.pr_number}`,
    entityType: "purchase_request",
    entityId: prId,
    approverProfileId,
  });

  const { error } = await supabase
    .from("purchase_requests")
    .update({
      status: "under_review",
      submitted_at: new Date().toISOString(),
      approval_request_id: approvalId,
    })
    .eq("id", prId);
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "purchase_request.submitted",
    entityType: "purchase_request",
    entityId: prId,
    newValues: { status: "under_review", approval_request_id: approvalId },
  });

  revalidateCommercial("/procurement/purchase-requests", `/procurement/purchase-requests/${prId}`, "/approvals", "/");
  });
}

export async function applyCommercialApprovalDecisionAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const officialCode = String(formData.get("officialCode") ?? "");
  const permission = officialCode === "D" ? "approval.reject" : "approval.approve";
  authorize(await getAuthContext(), permission);

  const stepId = String(formData.get("stepId") ?? "");
  const comment = String(formData.get("comment") ?? "") || null;
  const supabase = await createServerSupabaseClient();

  const { data: step } = await supabase
    .from("approval_steps")
    .select("id, request_id, approval_requests(entity_type, entity_id)")
    .eq("id", stepId)
    .maybeSingle();
  if (!step) throw new NotFoundError("خطوة الاعتماد", "Approval step");

  const { error } = await supabase.rpc("submit_approval_decision", {
    p_step_id: stepId,
    p_official_code: officialCode,
    p_comment: comment,
  });
  if (error) throw new DatabaseError(error);

  const request = Array.isArray(step.approval_requests) ? step.approval_requests[0] : step.approval_requests;
  const approved = officialCode === "A" || officialCode === "B";
  if (request?.entity_type === "purchase_request") {
    await supabase
      .from("purchase_requests")
      .update({
        status: approved ? "approved" : "rejected",
        approved_at: approved ? new Date().toISOString() : null,
        rejected_at: approved ? null : new Date().toISOString(),
      })
      .eq("id", request.entity_id);
    revalidateCommercial(`/procurement/purchase-requests/${request.entity_id}`);
  }
  if (request?.entity_type === "quotation_comparison") {
    await supabase
      .from("quotation_comparisons")
      .update({ status: approved ? "awarded" : "cancelled" })
      .eq("id", request.entity_id);
    const { data: comparison } = await supabase
      .from("quotation_comparisons")
      .select("rfq_id, recommended_quotation_id")
      .eq("id", request.entity_id)
      .maybeSingle();
    if (comparison?.rfq_id) {
      await supabase
        .from("rfqs")
        .update({ status: approved ? "awarded" : "under_comparison" })
        .eq("id", comparison.rfq_id);
      if (approved && comparison.recommended_quotation_id) {
        await supabase
          .from("supplier_quotations")
          .update({ status: "accepted" })
          .eq("id", comparison.recommended_quotation_id);
      }
      revalidateCommercial(`/procurement/rfqs/${comparison.rfq_id}`, `/procurement/rfqs/${comparison.rfq_id}/comparison`);
    }
  }
  if (request?.entity_type === "purchase_order") {
    await supabase
      .from("purchase_orders")
      .update({ status: approved ? "approved" : "cancelled" })
      .eq("id", request.entity_id);
    revalidateCommercial(`/procurement/purchase-orders/${request.entity_id}`);
  }

  revalidateCommercial("/approvals", "/");
  });
}

export async function createRfqFromPrAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "rfq.create");
  const prId = String(formData.get("prId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const responseDueDate = String(formData.get("responseDueDate") ?? "") || null;
  const supplierIds = formData.getAll("supplierIds").map(String).filter(Boolean);

  const supabase = await createServerSupabaseClient();
  const { data: pr } = await supabase
    .from("purchase_requests")
    .select("id, project_id, status, pr_number, purchase_request_items(*)")
    .eq("id", prId)
    .maybeSingle();
  if (!pr || pr.status !== "approved") {
    throw new ValidationError("يجب أن يكون طلب الشراء معتمداً.", "PR must be approved.");
  }

  const { data: rfqNum, error: numErr } = await supabase.rpc("generate_commercial_number", {
    p_organization_id: ctx.organization.id,
    p_project_id: pr.project_id,
    p_doc_type: "RFQ",
  });
  if (numErr || !rfqNum) throw new DatabaseError(numErr);

  const { data: rfq, error } = await supabase
    .from("rfqs")
    .insert({
      organization_id: ctx.organization.id,
      project_id: pr.project_id,
      purchase_request_id: pr.id,
      rfq_number: rfqNum,
      title: title || `RFQ ${pr.pr_number}`,
      response_due_date: responseDueDate,
      responsible_officer_id: ctx.userId,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !rfq) throw new DatabaseError(error);

  const items = (pr.purchase_request_items as Array<Record<string, unknown>>) ?? [];
  const selected = formData.getAll("itemIds").map(String);
  const used = selected.length ? items.filter((item) => selected.includes(String(item.id))) : items;
  for (let i = 0; i < used.length; i++) {
    const item = used[i];
    await supabase.from("rfq_items").insert({
      organization_id: ctx.organization.id,
      rfq_id: rfq.id,
      purchase_request_item_id: item.id as string,
      line_no: i + 1,
      description: item.description as string,
      specification: (item.specification as string) ?? null,
      quantity: item.quantity as number,
      unit: (item.unit as string) ?? null,
    });
  }

  const uniqueSupplierIds = [...new Set(supplierIds.map((id) => parseSupplierId(id)).filter((id): id is string => Boolean(id)))];
  for (const supplierId of uniqueSupplierIds) {
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("id, organization_id, status")
      .eq("id", supplierId)
      .maybeSingle<{ id: string; organization_id: string; status: string }>();
    const eligibility = evaluateRfqSupplierEligibility({
      supplierId,
      actorOrganizationId: ctx.organization.id,
      supplierOrganizationId: supplier?.organization_id ?? null,
      supplierStatus: supplier?.status ?? null,
    });
    if (!eligibility.ok) {
      throw new ValidationError(RFQ_INVITE_ERROR[eligibility.code].ar, RFQ_INVITE_ERROR[eligibility.code].en);
    }
    await supabase.from("rfq_suppliers").insert({
      organization_id: ctx.organization.id,
      rfq_id: rfq.id,
      supplier_id: supplierId,
      sent_by: ctx.userId,
    });
  }

  await supabase.from("purchase_requests").update({ status: "converted_to_rfq" }).eq("id", pr.id);
  revalidateCommercial(`/procurement/rfqs/${rfq.id}`, "/procurement/rfqs", `/procurement/purchase-requests/${prId}`);
  });
}

export async function issueRfqAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "rfq.issue");
  const rfqId = String(formData.get("rfqId") ?? "");
  const supabase = await createServerSupabaseClient();

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("id, rfq_number, status")
    .eq("id", rfqId)
    .maybeSingle();
  if (!rfq || !["draft", "ready_to_issue"].includes(rfq.status)) {
    throw new ValidationError("لا يمكن إصدار RFQ من حالته الحالية.", "Invalid RFQ status.");
  }

  const { count } = await supabase
    .from("rfq_suppliers")
    .select("id", { count: "exact", head: true })
    .eq("rfq_id", rfqId);
  if (!count) throw new ValidationError("أضف مورداً واحداً على الأقل قبل الإصدار.", "Invite at least one supplier.");

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from("rfqs")
    .update({
      status: "issued",
      issue_date: today,
      issued_at: new Date().toISOString(),
      issued_by: ctx.userId,
    })
    .eq("id", rfqId);
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "rfq.issued",
    entityType: "rfq",
    entityId: rfqId,
    newValues: { status: "issued" },
  });
  await new EventService(supabase).publish({
    type: "rfq.issued",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "rfq",
    entityId: rfqId,
    payload: { rfq_number: rfq.rfq_number },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidateCommercial(`/procurement/rfqs/${rfqId}`, "/procurement/rfqs", "/procurement");
  });
}

export async function inviteRfqSupplierAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
    const ctx = authorizeRfqInvitationMutation(await getAuthContext());
    const rfqId = parseSupplierId(String(formData.get("rfqId") ?? ""));
    const supplierId = parseSupplierId(String(formData.get("supplierId") ?? ""));
    if (!rfqId) throw new ValidationError("معرّف طلب العروض غير صالح.", "Invalid RFQ id.");
    if (!supplierId) throw new ValidationError(RFQ_INVITE_ERROR.INVALID_ID.ar, RFQ_INVITE_ERROR.INVALID_ID.en);

    const supabase = await createServerSupabaseClient();
    const { data: rfq } = await supabase
      .from("rfqs")
      .select("id, organization_id, status")
      .eq("id", rfqId)
      .maybeSingle<{ id: string; organization_id: string; status: string }>();
    if (!rfq) throw new NotFoundError("طلب عرض السعر", "RFQ");
    if (rfq.organization_id !== ctx.organization.id) throw new ForbiddenError();
    if (!isRfqInvitationEditable(rfq.status)) {
      throw new ValidationError(RFQ_INVITE_ERROR.NOT_EDITABLE.ar, RFQ_INVITE_ERROR.NOT_EDITABLE.en);
    }

    const { data: supplier } = await supabase
      .from("suppliers")
      .select("id, organization_id, status")
      .eq("id", supplierId)
      .maybeSingle<{ id: string; organization_id: string; status: string }>();
    const eligibility = evaluateRfqSupplierEligibility({
      supplierId,
      actorOrganizationId: ctx.organization.id,
      supplierOrganizationId: supplier?.organization_id ?? null,
      supplierStatus: supplier?.status ?? null,
    });
    if (!eligibility.ok) {
      throw new ValidationError(RFQ_INVITE_ERROR[eligibility.code].ar, RFQ_INVITE_ERROR[eligibility.code].en);
    }

    const { data: existing } = await supabase
      .from("rfq_suppliers")
      .select("id")
      .eq("rfq_id", rfqId)
      .eq("supplier_id", supplierId)
      .maybeSingle<{ id: string }>();
    if (existing) {
      throw new ValidationError(RFQ_INVITE_ERROR.DUPLICATE.ar, RFQ_INVITE_ERROR.DUPLICATE.en);
    }

    const { error } = await supabase.from("rfq_suppliers").insert({
      organization_id: ctx.organization.id,
      rfq_id: rfqId,
      supplier_id: supplierId,
      sent_by: ctx.userId,
    });
    if (error) throw new DatabaseError(error);

    revalidateCommercial(`/procurement/rfqs/${rfqId}`, "/procurement/rfqs");
  });
}

export async function removeRfqSupplierAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
    const ctx = authorizeRfqInvitationMutation(await getAuthContext());
    const rfqId = parseSupplierId(String(formData.get("rfqId") ?? ""));
    const invitationId = parseSupplierId(String(formData.get("invitationId") ?? ""));
    if (!rfqId || !invitationId) throw new ValidationError("بيانات الدعوة غير صالحة.", "Invalid invitation.");

    const supabase = await createServerSupabaseClient();
    const { data: rfq } = await supabase
      .from("rfqs")
      .select("id, organization_id, status")
      .eq("id", rfqId)
      .maybeSingle<{ id: string; organization_id: string; status: string }>();
    if (!rfq) throw new NotFoundError("طلب عرض السعر", "RFQ");
    if (rfq.organization_id !== ctx.organization.id) throw new ForbiddenError();
    if (!isRfqInvitationEditable(rfq.status)) {
      throw new ValidationError(RFQ_INVITE_ERROR.NOT_EDITABLE.ar, RFQ_INVITE_ERROR.NOT_EDITABLE.en);
    }

    const { data: invite } = await supabase
      .from("rfq_suppliers")
      .select("id, rfq_id")
      .eq("id", invitationId)
      .eq("rfq_id", rfqId)
      .maybeSingle<{ id: string; rfq_id: string }>();
    if (!invite) throw new NotFoundError("دعوة المورد", "Supplier invitation");

    const { error } = await supabase.from("rfq_suppliers").delete().eq("id", invitationId).eq("rfq_id", rfqId);
    if (error) throw new DatabaseError(error);

    revalidateCommercial(`/procurement/rfqs/${rfqId}`, "/procurement/rfqs");
  });
}

export async function updateRfqSupplierResponseAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "rfq.manage");
  const invitationId = String(formData.get("invitationId") ?? "");
  const responseStatus = String(formData.get("responseStatus") ?? "");
  const declineReason = String(formData.get("declineReason") ?? "") || null;
  if (!["acknowledged", "declined"].includes(responseStatus)) {
    throw new ValidationError("حالة الرد غير صالحة.", "Invalid response status.");
  }
  const supabase = await createServerSupabaseClient();
  const { data: invite } = await supabase
    .from("rfq_suppliers")
    .select("id, rfq_id")
    .eq("id", invitationId)
    .maybeSingle();
  if (!invite) throw new NotFoundError("دعوة المورد", "Supplier invitation");

  const { error } = await supabase
    .from("rfq_suppliers")
    .update({
      response_status: responseStatus,
      responded_at: new Date().toISOString(),
      decline_reason: responseStatus === "declined" ? declineReason : null,
    })
    .eq("id", invitationId);
  if (error) throw new DatabaseError(error);
  revalidateCommercial(`/procurement/rfqs/${invite.rfq_id}`);
  });
}

export async function createQuotationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "quotation.create");
  const rfqId = String(formData.get("rfqId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  const quotationNumber = String(formData.get("quotationNumber") ?? "").trim();
  const quotationDate = String(formData.get("quotationDate") ?? "") || new Date().toISOString().slice(0, 10);
  const validityDate = String(formData.get("validityDate") ?? "") || null;
  const paymentTerms = String(formData.get("paymentTerms") ?? "") || null;
  const warranty = String(formData.get("warranty") ?? "") || null;
  const commercialNotes = String(formData.get("commercialNotes") ?? "") || null;
  const leadTimeDays = Number(formData.get("leadTimeDays") ?? 0) || null;
  const discount = roundMoney(Number(formData.get("discount") ?? 0));
  const vatRate = Number(formData.get("vatRate") ?? 15);

  if (!quotationNumber) throw new ValidationError("رقم عرض السعر مطلوب.", "Quotation number required.");

  const supabase = await createServerSupabaseClient();
  const { data: rfq } = await supabase
    .from("rfqs")
    .select("id, project_id, status, rfq_items(*)")
    .eq("id", rfqId)
    .maybeSingle();
  if (!rfq) throw new NotFoundError("طلب عرض السعر", "RFQ");
  if (!["issued", "responses_received", "under_comparison"].includes(rfq.status)) {
    throw new ValidationError("لا يمكن تسجيل عرض إلا بعد إصدار طلب العرض.", "RFQ must be issued.");
  }

  const items = (rfq.rfq_items as Array<Record<string, unknown>>) ?? [];
  const lineInputs: Array<Record<string, unknown>> = [];
  let subtotal = 0;
  for (let i = 0; i < items.length; i++) {
    const rfqItem = items[i];
    const qty = Number(formData.get(`qty_${rfqItem.id}`) ?? rfqItem.quantity);
    const unitPrice = Number(formData.get(`price_${rfqItem.id}`) ?? 0);
    const total = lineTotal(qty, unitPrice);
    subtotal = roundMoney(subtotal + total);
    lineInputs.push({
      rfq_item_id: rfqItem.id,
      line_no: i + 1,
      description: rfqItem.description,
      quantity: qty,
      unit: rfqItem.unit,
      unit_price: unitPrice,
      total_price: total,
      offered_brand: String(formData.get(`brand_${rfqItem.id}`) ?? "") || null,
      offered_model: String(formData.get(`model_${rfqItem.id}`) ?? "") || null,
      lead_time_days: Number(formData.get(`lead_${rfqItem.id}`) ?? "") || null,
      compliance_status: String(formData.get(`compliance_${rfqItem.id}`) ?? "not_assessed"),
      deviation_note: String(formData.get(`deviation_${rfqItem.id}`) ?? "") || null,
    });
  }
  const taxable = roundMoney(Math.max(0, subtotal - discount));
  const vat = vatAmount(taxable, vatRate);
  const total = grossWithVat(taxable, vatRate);

  const { data: quote, error } = await supabase
    .from("supplier_quotations")
    .insert({
      organization_id: ctx.organization.id,
      project_id: rfq.project_id,
      rfq_id: rfqId,
      supplier_id: supplierId,
      quotation_number: quotationNumber,
      quotation_date: quotationDate,
      validity_date: validityDate,
      subtotal,
      discount,
      vat_rate_percent: vatRate,
      vat_amount: vat,
      total,
      delivery_lead_time_days: leadTimeDays,
      payment_terms: paymentTerms,
      warranty,
      commercial_notes: commercialNotes,
      status: "submitted",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !quote) throw new DatabaseError(error);

  for (const line of lineInputs) {
    const { error: lineErr } = await supabase.from("supplier_quotation_items").insert({
      organization_id: ctx.organization.id,
      quotation_id: quote.id,
      ...line,
    });
    if (lineErr) throw new DatabaseError(lineErr);
  }

  await supabase
    .from("rfq_suppliers")
    .update({ response_status: "responded", responded_at: new Date().toISOString() })
    .eq("rfq_id", rfqId)
    .eq("supplier_id", supplierId);

  await supabase.from("rfqs").update({ status: "responses_received" }).eq("id", rfqId).eq("status", "issued");

  await new EventService(supabase).publish({
    type: "quotation.received",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "supplier_quotation",
    entityId: quote.id,
    payload: { quotation_number: quotationNumber, rfq_id: rfqId },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidateCommercial(`/procurement/rfqs/${rfqId}`, `/procurement/quotations/${quote.id}`, "/procurement");
  });
}

export async function recommendAwardAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "quotation.recommend");
  const rfqId = String(formData.get("rfqId") ?? "");
  const quotationId = String(formData.get("quotationId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const approverProfileId = String(formData.get("approverProfileId") ?? "");
  if (reason.length < 8) {
    throw new ValidationError("سبب التوصية مطلوب.", "Recommendation reason is required.");
  }
  if (!approverProfileId) {
    throw new ValidationError("يجب تحديد معتمد الترسية.", "Award approver is required.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: quote } = await supabase
    .from("supplier_quotations")
    .select("id, total, project_id, rfq_id")
    .eq("id", quotationId)
    .maybeSingle();
  if (!quote || quote.rfq_id !== rfqId) throw new NotFoundError("عرض السعر", "Quotation");

  const rule = await requireThresholdRule(supabase, ctx.organization.id, "purchase_order", Number(quote.total));

  const { data: comparison, error } = await supabase
    .from("quotation_comparisons")
    .upsert(
      {
        organization_id: ctx.organization.id,
        project_id: quote.project_id,
        rfq_id: rfqId,
        recommended_supplier_id: supplierId,
        recommended_quotation_id: quotationId,
        recommendation_reason: reason,
        recommended_by: ctx.userId,
        recommended_at: new Date().toISOString(),
        status: "recommended",
        created_by: ctx.userId,
      },
      { onConflict: "rfq_id" },
    )
    .select("id")
    .single();
  if (error || !comparison) throw new DatabaseError(error);

  const approvalId = await createCommercialApproval(supabase, ctx, {
    title: `اعتماد ترسية عرض ${Number(quote.total).toLocaleString("ar-SA")} — قاعدة ${rule.min_amount}`,
    entityType: "quotation_comparison",
    entityId: comparison.id,
    approverProfileId,
  });

  await supabase
    .from("quotation_comparisons")
    .update({ approval_request_id: approvalId, status: "pending_approval" })
    .eq("id", comparison.id);
  await supabase.from("rfqs").update({ status: "under_comparison" }).eq("id", rfqId);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "quotation.recommended",
    entityType: "quotation_comparison",
    entityId: comparison.id,
    newValues: { quotation_id: quotationId, threshold_rule_id: rule.id, reason },
  });

  revalidateCommercial(`/procurement/rfqs/${rfqId}/comparison`, "/approvals");
  });
}

export async function createPoFromQuotationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "purchase_order.create");
  const quotationId = String(formData.get("quotationId") ?? "");
  const requiredDeliveryDate = String(formData.get("requiredDeliveryDate") ?? "") || null;
  const deliveryAddress = String(formData.get("deliveryAddress") ?? "") || null;
  const supabase = await createServerSupabaseClient();

  const { data: quote } = await supabase
    .from("supplier_quotations")
    .select("*, supplier_quotation_items(*)")
    .eq("id", quotationId)
    .maybeSingle();
  if (!quote) throw new NotFoundError("عرض السعر", "Quotation");

  const { data: comparison } = await supabase
    .from("quotation_comparisons")
    .select("status, recommended_quotation_id")
    .eq("rfq_id", quote.rfq_id)
    .maybeSingle();
  if (!comparison || comparison.status !== "awarded" || comparison.recommended_quotation_id !== quotationId) {
    throw new ValidationError("لا يمكن إنشاء أمر شراء إلا بعد اعتماد الترسية.", "Award must be approved first.");
  }

  const { data: poNum, error: numErr } = await supabase.rpc("generate_commercial_number", {
    p_organization_id: ctx.organization.id,
    p_project_id: quote.project_id,
    p_doc_type: "PO",
  });
  if (numErr || !poNum) throw new DatabaseError(numErr);

  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      organization_id: ctx.organization.id,
      project_id: quote.project_id,
      supplier_id: quote.supplier_id,
      rfq_id: quote.rfq_id,
      quotation_id: quote.id,
      po_number: poNum,
      currency: quote.currency,
      subtotal: quote.subtotal,
      discount: quote.discount,
      vat_rate_percent: quote.vat_rate_percent,
      vat_amount: quote.vat_amount,
      total: quote.total,
      payment_terms: quote.payment_terms,
      required_delivery_date: requiredDeliveryDate,
      delivery_address: deliveryAddress,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !po) throw new DatabaseError(error);

  const lines = (quote.supplier_quotation_items as Array<Record<string, unknown>>) ?? [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { error: lineErr } = await supabase.from("purchase_order_items").insert({
      organization_id: ctx.organization.id,
      purchase_order_id: po.id,
      line_no: i + 1,
      description: line.description as string,
      quantity: line.quantity as number,
      unit: (line.unit as string) ?? null,
      unit_price: line.unit_price as number,
      vat_amount: 0,
      line_total: line.total_price as number,
      quotation_item_id: line.id as string,
    });
    if (lineErr) throw new DatabaseError(lineErr);
  }

  revalidateCommercial(`/procurement/purchase-orders/${po.id}`, "/procurement/purchase-orders");
  });
}

export async function submitPurchaseOrderForApprovalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "purchase_order.create");
  const poId = String(formData.get("poId") ?? "");
  const approverProfileId = String(formData.get("approverProfileId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { data: po } = await supabase.from("purchase_orders").select("id, status, po_number, total").eq("id", poId).maybeSingle();
  if (!po || po.status !== "draft") throw new ValidationError("لا يمكن تقديم أمر الشراء.", "Invalid PO status.");
  await requireThresholdRule(supabase, ctx.organization.id, "purchase_order", Number(po.total));

  const approvalId = await createCommercialApproval(supabase, ctx, {
    title: `اعتماد أمر شراء ${po.po_number}`,
    entityType: "purchase_order",
    entityId: poId,
    approverProfileId,
  });
  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "pending_approval", approval_request_id: approvalId })
    .eq("id", poId);
  if (error) throw new DatabaseError(error);
  revalidateCommercial(`/procurement/purchase-orders/${poId}`, "/approvals");
  });
}

export async function issuePurchaseOrderAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "purchase_order.issue");
  const poId = String(formData.get("poId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("issue_purchase_order", { p_po_id: poId });
  if (error) throw new DatabaseError(error);
  revalidateCommercial(`/procurement/purchase-orders/${poId}`, "/procurement/purchase-orders", "/procurement");
  });
}

export async function createAndPostGoodsReceiptAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام عملية المشتريات. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "goods_receipt.create");
  const poId = String(formData.get("poId") ?? "");
  const deliveryDate = String(formData.get("deliveryDate") ?? "") || new Date().toISOString().slice(0, 10);
  const deliveryNoteNumber = String(formData.get("deliveryNoteNumber") ?? "") || null;
  const notes = String(formData.get("notes") ?? "") || null;
  const location = String(formData.get("location") ?? "") || null;

  const supabase = await createServerSupabaseClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, project_id, supplier_id, status, purchase_order_items(*)")
    .eq("id", poId)
    .maybeSingle();
  if (!po || !["issued", "partially_delivered"].includes(po.status)) {
    throw new ValidationError("يمكن الاستلام فقط لأمر شراء صادر أو جزئي.", "PO must be issued.");
  }

  const { data: receiptNum, error: numErr } = await supabase.rpc("generate_commercial_number", {
    p_organization_id: ctx.organization.id,
    p_project_id: po.project_id,
    p_doc_type: "GRN",
  });
  if (numErr || !receiptNum) throw new DatabaseError(numErr);

  const { data: receipt, error } = await supabase
    .from("goods_receipts")
    .insert({
      organization_id: ctx.organization.id,
      project_id: po.project_id,
      purchase_order_id: po.id,
      supplier_id: po.supplier_id,
      receipt_number: receiptNum,
      delivery_date: deliveryDate,
      received_by: ctx.userId,
      location,
      delivery_note_number: deliveryNoteNumber,
      notes,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !receipt) throw new DatabaseError(error);

  const items = (po.purchase_order_items as Array<Record<string, unknown>>) ?? [];
  for (const item of items) {
    const remaining = Number(item.quantity) - Number(item.received_quantity ?? 0);
    const receivedNow = Number(formData.get(`received_${item.id}`) ?? 0);
    const accepted = Number(formData.get(`accepted_${item.id}`) ?? receivedNow);
    const rejected = Number(formData.get(`rejected_${item.id}`) ?? 0);
    if (receivedNow <= 0 && accepted <= 0 && rejected <= 0) continue;
    if (receivedNow > remaining + 0.0001) {
      throw new ValidationError("الكمية المستلمة تتجاوز المتبقي.", "Received quantity exceeds remaining.");
    }
    const { error: itemErr } = await supabase.from("goods_receipt_items").insert({
      organization_id: ctx.organization.id,
      goods_receipt_id: receipt.id,
      purchase_order_item_id: item.id as string,
      received_quantity: receivedNow,
      accepted_quantity: accepted,
      rejected_quantity: rejected,
      rejection_reason: String(formData.get(`reason_${item.id}`) ?? "") || null,
    });
    if (itemErr) throw new DatabaseError(itemErr);
  }

  const { error: postErr } = await supabase.rpc("post_goods_receipt", { p_receipt_id: receipt.id });
  if (postErr) throw new DatabaseError(postErr);

  revalidateCommercial(
    `/procurement/goods-receipts/${receipt.id}`,
    `/procurement/purchase-orders/${poId}`,
    "/procurement/goods-receipts",
  );
  });
}
