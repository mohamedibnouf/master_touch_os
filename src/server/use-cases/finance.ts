"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { AuditService } from "@/server/services/audit.service";
import { createNotificationService } from "@/server/services/notification.service";
import { grossWithVat, vatAmount } from "@/server/domain/commercial";

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

  await supabase.rpc("evaluate_supplier_invoice_match", { p_invoice_id: inv.id });

  revalidatePath("/finance/supplier-invoices");
  revalidatePath(`/finance/supplier-invoices/${inv.id}`);
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
    revalidatePath(`/finance/supplier-invoices/${invoiceId}`);
    return;
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

  revalidatePath(`/finance/supplier-invoices/${invoiceId}`);
  revalidatePath("/finance/supplier-invoices");
  revalidatePath("/approvals");
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
  const { error } = await supabase.rpc("record_supplier_payment", {
    p_invoice_id: parsed.data.invoiceId,
    p_amount: parsed.data.amount,
    p_payment_date: parsed.data.paymentDate,
    p_payment_reference: parsed.data.paymentReference,
    p_payment_method: parsed.data.paymentMethod,
    p_bank_reference: parsed.data.bankReference ?? null,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "supplier_payment.recorded",
    entityType: "supplier_invoice",
    entityId: parsed.data.invoiceId,
    newValues: { amount: parsed.data.amount },
  });

  revalidatePath(`/finance/supplier-invoices/${parsed.data.invoiceId}`);
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
  const { error } = await supabase.rpc("approve_variation", {
    p_variation_id: variationId,
    p_approved_amount: approvedAmount,
  });
  if (error) throw new DatabaseError(error);
  revalidatePath(`/finance/variations/${variationId}`);
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
  if (error) throw new DatabaseError(error);

  revalidatePath(`/finance/client-invoices/${parsed.data.invoiceId}`);
  revalidatePath("/finance/receivables");
  });
}
