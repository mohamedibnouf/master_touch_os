"use server";

import "server-only";

import { revalidateViews } from "@/server/revalidate-views";
import { z } from "zod";
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { AuditService } from "@/server/services/audit.service";
import { createNotificationService } from "@/server/services/notification.service";
import { grossWithVat, vatAmount } from "@/server/domain/commercial";
import { paymentErrorCopy } from "@/lib/commercial/payment-errors";
import {
  COMMERCIAL_INTEGRITY_ERROR as INTEGRITY_ERROR,
  checkSupplierInvoiceAgainstPo,
  isSupplierInvoiceApprovable,
  isSupplierInvoicePayable,
  isVariationApprovable,
} from "@/modules/procurement/integrity";

/** Payment RPC failures carry stable codes (050/051); show their localized message instead of a generic error. */
function paymentRpcError(error: { message?: string | null; details?: string | null }): Error {
  const copy = paymentErrorCopy(error);
  if (!copy) return new DatabaseError(error);
  return copy.kind === "conflict" ? new ConflictError(copy.ar, copy.en) : new ValidationError(copy.ar, copy.en);
}

export async function createSupplierInvoiceAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية المالية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "supplier_invoice.create");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      supplierId: z.string().uuid(),
      purchaseOrderId: z.string().uuid().optional(),
      invoiceNumber: z.string().trim().min(1),
      invoiceDate: z.string(),
      dueDate: z.string().optional(),
      subtotal: z.coerce.number().nonnegative(),
      vatRate: z.coerce.number().nonnegative().default(15),
    })
    .safeParse({
      projectId: formData.get("projectId"),
      supplierId: formData.get("supplierId"),
      purchaseOrderId: formData.get("purchaseOrderId") || undefined,
      invoiceNumber: formData.get("invoiceNumber"),
      invoiceDate: formData.get("invoiceDate"),
      dueDate: formData.get("dueDate") || undefined,
      subtotal: formData.get("subtotal"),
      vatRate: formData.get("vatRate") || 15,
    });
  if (!parsed.success) throw new ValidationError("بيانات الفاتورة غير مكتملة.", "Invoice incomplete.");

  const vat = vatAmount(parsed.data.subtotal, parsed.data.vatRate);
  const total = grossWithVat(parsed.data.subtotal, parsed.data.vatRate);

  const supabase = await createServerSupabaseClient();

  if (parsed.data.purchaseOrderId) {
    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .select("id, supplier_id, project_id, status")
      .eq("id", parsed.data.purchaseOrderId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle<{ id: string; supplier_id: string; project_id: string; status: string }>();
    if (poErr) throw new DatabaseError(poErr);
    if (!po) throw new NotFoundError("أمر الشراء", "Purchase order");
    const link = checkSupplierInvoiceAgainstPo({
      invoiceSupplierId: parsed.data.supplierId,
      invoiceProjectId: parsed.data.projectId,
      po,
    });
    if (!link.ok) {
      throw new ValidationError(INTEGRITY_ERROR[link.code].ar, INTEGRITY_ERROR[link.code].en);
    }
  }

  const { data: inv, error } = await supabase
    .from("supplier_invoices")
    .insert({
      organization_id: ctx.organization.id,
      project_id: parsed.data.projectId,
      supplier_id: parsed.data.supplierId,
      purchase_order_id: parsed.data.purchaseOrderId ?? null,
      invoice_number: parsed.data.invoiceNumber,
      invoice_date: parsed.data.invoiceDate,
      due_date: parsed.data.dueDate ?? null,
      subtotal: parsed.data.subtotal,
      vat_amount: vat,
      total,
      status: "received",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !inv) throw new DatabaseError(error);

  // The invoice is saved either way; a failed evaluation leaves it in "received" for manual review.
  const { error: matchErr } = await supabase.rpc("evaluate_supplier_invoice_match", { p_invoice_id: inv.id });
  if (matchErr) {
    logger.error("supplier invoice match evaluation failed", { invoiceId: inv.id, code: matchErr.code });
  }

  revalidateViews("/finance/supplier-invoices");
  revalidateViews(`/finance/supplier-invoices/${inv.id}`);
  });
}

export async function approveSupplierInvoiceForPaymentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية المالية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "supplier_invoice.approve");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { data: invoice, error: invoiceError } = await supabase
    .from("supplier_invoices")
    .select("id, invoice_number, organization_id, status")
    .eq("id", invoiceId)
    .maybeSingle<{ id: string; invoice_number: string; organization_id: string; status: string }>();
  if (invoiceError) throw new DatabaseError(invoiceError);
  if (!invoice) throw new NotFoundError("فاتورة المورد", "Supplier invoice");
  if (invoice.status === "approved_for_payment" || invoice.status === "paid" || invoice.status === "partially_paid") {
    revalidateViews(`/finance/supplier-invoices/${invoiceId}`);
    return;
  }
  if (!isSupplierInvoiceApprovable(invoice.status)) {
    throw new ConflictError(INTEGRITY_ERROR.INVOICE_NOT_APPROVABLE.ar, INTEGRITY_ERROR.INVOICE_NOT_APPROVABLE.en);
  }

  const { data: existingRequest, error: requestError } = await supabase
    .from("approval_requests")
    .select("id, status")
    .eq("organization_id", ctx.organization.id)
    .eq("entity_type", "supplier_invoice")
    .eq("entity_id", invoiceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();
  if (requestError) throw new DatabaseError(requestError);

  let requestId = existingRequest?.id ?? null;
  if (!requestId || existingRequest?.status === "completed") {
    const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { data: request, error } = await supabase
      .from("approval_requests")
      .insert({
        organization_id: ctx.organization.id,
        entity_type: "supplier_invoice",
        entity_id: invoiceId,
        title: `اعتماد فاتورة مورد ${invoice.invoice_number}`,
        title_en: `Approve supplier invoice ${invoice.invoice_number}`,
        status: "in_progress",
        mode: "sequential",
        requested_by: ctx.userId,
        due_at: dueAt,
        warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !request) throw new DatabaseError(error);
    requestId = request.id;

    const { error: stepError } = await supabase.from("approval_steps").insert({
      organization_id: ctx.organization.id,
      request_id: requestId,
      sequence: 1,
      approver_type: "user",
      user_id: ctx.userId,
      status: "in_progress",
      due_at: dueAt,
      warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
    });
    if (stepError) throw new DatabaseError(stepError);

    await createNotificationService(supabase).notify({
      organizationId: ctx.organization.id,
      recipientProfileId: ctx.userId,
      type: "approval.required",
      title: `اعتماد فاتورة مورد ${invoice.invoice_number}`,
      message: "مطلوب إجراء موافقة",
      titleEn: `Approve supplier invoice ${invoice.invoice_number}`,
      messageEn: "Your approval is required.",
      entityType: "supplier_invoice",
      entityId: invoiceId,
      priority: "high",
    });
  }

  const { error } = await supabase.rpc("decide_entity_approval", {
    p_request_id: requestId,
    p_step_id: null,
    p_official_code: "A",
    p_comment: null,
  });
  if (error) throw new DatabaseError(error);

  revalidateViews(`/finance/supplier-invoices/${invoiceId}`);
  revalidateViews("/finance/supplier-invoices");
  revalidateViews("/approvals");
  });
}

export async function recordSupplierPaymentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية المالية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "supplier_payment.record");
  const parsed = z
    .object({
      invoiceId: z.string().uuid(),
      amount: z.coerce.number().positive(),
      paymentDate: z.string(),
      paymentReference: z.string().trim().min(1),
      paymentMethod: z.enum(["bank_transfer", "cheque", "cash", "card", "other"]).default("bank_transfer"),
      bankReference: z.string().optional(),
      notes: z.string().optional(),
    })
    .safeParse({
      invoiceId: formData.get("invoiceId"),
      amount: formData.get("amount"),
      paymentDate: formData.get("paymentDate"),
      paymentReference: formData.get("paymentReference"),
      paymentMethod: formData.get("paymentMethod") || "bank_transfer",
      bankReference: formData.get("bankReference") || undefined,
      notes: formData.get("notes") || undefined,
    });
  if (!parsed.success) throw new ValidationError("بيانات الدفعة غير مكتملة.", "Payment incomplete.");

  const supabase = await createServerSupabaseClient();
  const { data: invoice, error: invoiceErr } = await supabase
    .from("supplier_invoices")
    .select("id, status, project_id, purchase_order_id")
    .eq("id", parsed.data.invoiceId)
    .maybeSingle<{ id: string; status: string; project_id: string; purchase_order_id: string | null }>();
  if (invoiceErr) throw new DatabaseError(invoiceErr);
  if (!invoice) throw new NotFoundError("فاتورة المورد", "Supplier invoice");
  if (!isSupplierInvoicePayable(invoice.status)) {
    throw new ConflictError(INTEGRITY_ERROR.INVOICE_NOT_PAYABLE.ar, INTEGRITY_ERROR.INVOICE_NOT_PAYABLE.en);
  }

  const { error } = await supabase.rpc("record_supplier_payment", {
    p_invoice_id: parsed.data.invoiceId,
    p_amount: parsed.data.amount,
    p_payment_date: parsed.data.paymentDate,
    p_payment_reference: parsed.data.paymentReference,
    p_payment_method: parsed.data.paymentMethod,
    p_bank_reference: parsed.data.bankReference ?? null,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) throw paymentRpcError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "supplier_payment.recorded",
    entityType: "supplier_invoice",
    entityId: parsed.data.invoiceId,
    newValues: { amount: parsed.data.amount },
  });

  revalidateViews(`/finance/supplier-invoices/${parsed.data.invoiceId}`);
  revalidateViews("/finance/supplier-invoices");
  revalidateViews("/finance");
  revalidateViews(`/projects/${invoice.project_id}`);
  if (invoice.purchase_order_id) revalidateViews(`/procurement/purchase-orders/${invoice.purchase_order_id}`);
  });
}

export async function approveVariationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية المالية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "variation.approve");
  const variationId = String(formData.get("variationId") ?? "");
  const approvedAmount = Number(formData.get("approvedAmount") ?? 0);
  const supabase = await createServerSupabaseClient();
  const { data: vo } = await supabase.from("variations").select("id, status").eq("id", variationId).maybeSingle();
  if (!vo) throw new NotFoundError("أمر التغيير", "Variation");
  if (!isVariationApprovable(vo.status)) {
    throw new ConflictError(INTEGRITY_ERROR.VARIATION_NOT_APPROVABLE.ar, INTEGRITY_ERROR.VARIATION_NOT_APPROVABLE.en);
  }
  const { error } = await supabase.rpc("approve_variation", {
    p_variation_id: variationId,
    p_approved_amount: approvedAmount,
  });
  if (error) throw new DatabaseError(error);
  revalidateViews(`/finance/variations/${variationId}`);
  revalidateViews("/finance/variations");
  revalidateViews("/approvals");
  });
}

export async function recordClientPaymentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية المالية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "client_payment.record");
  const parsed = z
    .object({
      invoiceId: z.string().uuid(),
      amount: z.coerce.number().positive(),
      receivedDate: z.string(),
      reference: z.string().trim().min(1),
      paymentMethod: z.enum(["bank_transfer", "cheque", "cash", "card", "other"]).default("bank_transfer"),
    })
    .safeParse({
      invoiceId: formData.get("invoiceId"),
      amount: formData.get("amount"),
      receivedDate: formData.get("receivedDate"),
      reference: formData.get("reference"),
      paymentMethod: formData.get("paymentMethod") || "bank_transfer",
    });
  if (!parsed.success) throw new ValidationError("بيانات التحصيل غير مكتملة.", "Payment incomplete.");

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("record_client_payment", {
    p_invoice_id: parsed.data.invoiceId,
    p_amount: parsed.data.amount,
    p_received_date: parsed.data.receivedDate,
    p_reference: parsed.data.reference,
    p_payment_method: parsed.data.paymentMethod,
  });
  if (error) throw paymentRpcError(error);

  revalidateViews(`/finance/client-invoices/${parsed.data.invoiceId}`, "/finance/client-invoices");
  revalidateViews("/finance/receivables");
  });
}
