"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { AuditService } from "@/server/services/audit.service";
import { createNotificationService } from "@/server/services/notification.service";
import { StorageService } from "@/server/services/storage.service";
import { grossWithVat, roundMoney, vatAmount } from "@/server/domain/commercial";

async function ensureApprovalAndDecide(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>,
  input: {
    entityType: string;
    entityId: string;
    title: string;
    approverId: string;
  },
) {
  const { data: existing } = await supabase
    .from("approval_requests")
    .select("id, status")
    .eq("organization_id", ctx.organization.id)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();

  let requestId = existing?.id ?? null;
  if (!requestId || existing?.status === "completed") {
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
      .single<{ id: string }>();
    if (error || !request) throw new DatabaseError(error);
    requestId = request.id;

    const { error: stepError } = await supabase.from("approval_steps").insert({
      organization_id: ctx.organization.id,
      request_id: requestId,
      sequence: 1,
      approver_type: "user",
      user_id: input.approverId,
      status: "in_progress",
      due_at: dueAt,
      warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
    });
    if (stepError) throw new DatabaseError(stepError);

    await createNotificationService(supabase).notify({
      organizationId: ctx.organization.id,
      recipientProfileId: input.approverId,
      type: "approval.required",
      title: input.title,
      message: "مطلوب إجراء موافقة",
      entityType: input.entityType,
      entityId: input.entityId,
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
}

export async function attachEntityDocumentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "document.upload");
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const projectId = String(formData.get("projectId") ?? "") || null;
  const role = String(formData.get("role") ?? "attachment");
  const file = formData.get("file");
  const revalidate = String(formData.get("revalidatePath") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    throw new ValidationError("الملف مطلوب.", "File required.");
  }

  const supabase = await createServerSupabaseClient();
  const storage = new StorageService(supabase);
  storage.validate(file);

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .insert({
      organization_id: ctx.organization.id,
      project_id: projectId,
      title: file.name,
      category: "other",
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (docErr || !doc) throw new DatabaseError(docErr);

  const uploaded = await storage.upload({
    organizationId: ctx.organization.id,
    projectId,
    documentId: doc.id,
    revision: "A",
    file,
  });

  const { error: versionErr } = await supabase.from("document_versions").insert({
    organization_id: ctx.organization.id,
    document_id: doc.id,
    revision: "A",
    file_path: uploaded.path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    checksum: uploaded.checksum,
    uploaded_by: ctx.userId,
  });
  if (versionErr) throw new DatabaseError(versionErr);
  const { error: linkErr } = await supabase.from("entity_documents").insert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    entity_type: entityType,
    entity_id: entityId,
    document_id: doc.id,
    role,
    uploaded_by: ctx.userId,
  });
  if (linkErr) throw new DatabaseError(linkErr);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "document.uploaded",
    entityType,
    entityId,
    newValues: { document_id: doc.id, role },
  });

  if (revalidate) revalidatePath(revalidate);
  });
}

export async function createProjectContractAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "finance.manage");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      clientName: z.string().trim().min(1),
      contractNumber: z.string().trim().min(1),
      contractDate: z.string().optional(),
      contractValue: z.coerce.number().nonnegative(),
      currency: z.string().default("SAR"),
      vatRate: z.coerce.number().nonnegative().default(15),
      retentionPercent: z.coerce.number().min(0).max(100).default(0),
      advancePaymentPercent: z.coerce.number().min(0).max(100).default(0),
      startDate: z.string().optional(),
      plannedCompletion: z.string().optional(),
      paymentTerms: z.string().optional(),
      delayPenaltyTerms: z.string().optional(),
      variationRules: z.string().optional(),
    })
    .safeParse({
      projectId: formData.get("projectId"),
      clientName: formData.get("clientName"),
      contractNumber: formData.get("contractNumber"),
      contractDate: formData.get("contractDate") || undefined,
      contractValue: formData.get("contractValue"),
      currency: formData.get("currency") || "SAR",
      vatRate: formData.get("vatRate") || 15,
      retentionPercent: formData.get("retentionPercent") || 0,
      advancePaymentPercent: formData.get("advancePaymentPercent") || 0,
      startDate: formData.get("startDate") || undefined,
      plannedCompletion: formData.get("plannedCompletion") || undefined,
      paymentTerms: formData.get("paymentTerms") || undefined,
      delayPenaltyTerms: formData.get("delayPenaltyTerms") || undefined,
      variationRules: formData.get("variationRules") || undefined,
    });
  if (!parsed.success) throw new ValidationError("بيانات العقد غير مكتملة.", "Contract incomplete.");

  const vatAmt = vatAmount(parsed.data.contractValue, parsed.data.vatRate);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("project_contracts")
    .insert({
      organization_id: ctx.organization.id,
      project_id: parsed.data.projectId,
      client_name: parsed.data.clientName,
      contract_number: parsed.data.contractNumber,
      contract_date: parsed.data.contractDate ?? null,
      contract_value: parsed.data.contractValue,
      currency: parsed.data.currency,
      vat_amount: vatAmt,
      retention_percent: parsed.data.retentionPercent,
      advance_payment_percent: parsed.data.advancePaymentPercent,
      start_date: parsed.data.startDate ?? null,
      planned_completion: parsed.data.plannedCompletion ?? null,
      payment_terms: parsed.data.paymentTerms ?? null,
      delay_penalty_terms: parsed.data.delayPenaltyTerms ?? null,
      variation_rules: parsed.data.variationRules ?? null,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new DatabaseError(error);

  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "contract.created",
    entityType: "project_contract",
    entityId: data.id,
  });

  revalidatePath(`/projects/${parsed.data.projectId}`);
  revalidatePath(`/projects/${parsed.data.projectId}/commercial/contract`);
  });
}

export async function activateProjectContractAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "finance.manage");
  const contractId = String(formData.get("contractId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("activate_project_contract", { p_contract_id: contractId });
  if (error) throw new DatabaseError(error);
  revalidatePath(`/projects/${projectId}/commercial/contract`);
  });
}

export async function createContractMilestoneAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "finance.manage");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      contractId: z.string().uuid(),
      milestoneNumber: z.coerce.number().int().positive(),
      name: z.string().trim().min(1),
      description: z.string().trim().min(1),
      percentage: z.coerce.number().min(0).max(100).optional(),
      amount: z.coerce.number().nonnegative(),
      triggerEvent: z.string().optional(),
      plannedDate: z.string().optional(),
    })
    .safeParse({
      projectId: formData.get("projectId"),
      contractId: formData.get("contractId"),
      milestoneNumber: formData.get("milestoneNumber"),
      name: formData.get("name"),
      description: formData.get("description"),
      percentage: formData.get("percentage") || undefined,
      amount: formData.get("amount"),
      triggerEvent: formData.get("triggerEvent") || undefined,
      plannedDate: formData.get("plannedDate") || undefined,
    });
  if (!parsed.success) throw new ValidationError("بيانات المرحلة غير مكتملة.", "Milestone incomplete.");

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("contract_milestones").insert({
    organization_id: ctx.organization.id,
    contract_id: parsed.data.contractId,
    project_id: parsed.data.projectId,
    milestone_number: parsed.data.milestoneNumber,
    name: parsed.data.name,
    description: parsed.data.description,
    percentage: parsed.data.percentage ?? null,
    amount: parsed.data.amount,
    trigger_event: parsed.data.triggerEvent ?? null,
    planned_date: parsed.data.plannedDate ?? null,
    status: "planned",
  });
  if (error) throw new DatabaseError(error);
  revalidatePath(`/projects/${parsed.data.projectId}/commercial/milestones`);
  });
}

export async function markMilestoneEligibleAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "finance.manage");
  const milestoneId = String(formData.get("milestoneId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const comments = String(formData.get("comments") ?? "").trim() || null;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("mark_contract_milestone_eligible", {
    p_milestone_id: milestoneId,
    p_comments: comments,
  });
  if (error) throw new DatabaseError(error);
  revalidatePath(`/projects/${projectId}/commercial/milestones`);
  });
}

export async function createClientValuationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "client_valuation.create");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      contractId: z.string().uuid(),
      milestoneId: z.string().uuid().optional(),
      periodStart: z.string().optional(),
      periodEnd: z.string().optional(),
      progressPercentage: z.coerce.number().min(0).max(100).optional(),
      grossWorkValue: z.coerce.number().nonnegative(),
      variationsAmount: z.coerce.number().nonnegative().default(0),
      advanceRecovery: z.coerce.number().nonnegative().default(0),
      previousCertifiedAmount: z.coerce.number().nonnegative().default(0),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
    })
    .safeParse({
      projectId: formData.get("projectId"),
      contractId: formData.get("contractId"),
      milestoneId: formData.get("milestoneId") || undefined,
      periodStart: formData.get("periodStart") || undefined,
      periodEnd: formData.get("periodEnd") || undefined,
      progressPercentage: formData.get("progressPercentage") || undefined,
      grossWorkValue: formData.get("grossWorkValue"),
      variationsAmount: formData.get("variationsAmount") || 0,
      advanceRecovery: formData.get("advanceRecovery") || 0,
      previousCertifiedAmount: formData.get("previousCertifiedAmount") || 0,
      dueDate: formData.get("dueDate") || undefined,
      notes: formData.get("notes") || undefined,
    });
  if (!parsed.success) throw new ValidationError("بيانات المستخلص غير مكتملة.", "Valuation incomplete.");

  const supabase = await createServerSupabaseClient();
  const { data: num, error: numErr } = await supabase.rpc("generate_commercial_number", {
    p_organization_id: ctx.organization.id,
    p_project_id: parsed.data.projectId,
    p_doc_type: "VAL",
  });
  if (numErr || !num) throw new DatabaseError(numErr);

  const { data: val, error } = await supabase
    .from("client_valuations")
    .insert({
      organization_id: ctx.organization.id,
      project_id: parsed.data.projectId,
      contract_id: parsed.data.contractId,
      milestone_id: parsed.data.milestoneId ?? null,
      valuation_number: num,
      period_start: parsed.data.periodStart ?? null,
      period_end: parsed.data.periodEnd ?? null,
      progress_percentage: parsed.data.progressPercentage ?? null,
      gross_work_value: parsed.data.grossWorkValue,
      variations_amount: parsed.data.variationsAmount,
      advance_recovery: parsed.data.advanceRecovery,
      previous_certified_amount: parsed.data.previousCertifiedAmount,
      due_date: parsed.data.dueDate ?? null,
      notes: parsed.data.notes ?? null,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !val) throw new DatabaseError(error);

  const { error: calcErr } = await supabase.rpc("recalculate_client_valuation", { p_valuation_id: val.id });
  if (calcErr) throw new DatabaseError(calcErr);

  revalidatePath("/finance/client-valuations");
  revalidatePath(`/finance/client-valuations/${val.id}`);
  });
}

export async function submitClientValuationForReviewAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "client_valuation.submit");
  const valuationId = String(formData.get("valuationId") ?? "");
  const approverId = String(formData.get("approverId") ?? "");
  const supabase = await createServerSupabaseClient();

  const { data: val, error: valErr } = await supabase
    .from("client_valuations")
    .select("id, valuation_number, status")
    .eq("id", valuationId)
    .maybeSingle();
  if (valErr) throw new DatabaseError(valErr);
  if (!val) throw new NotFoundError("المستخلص", "Valuation");

  const { error } = await supabase
    .from("client_valuations")
    .update({ status: "internal_review" })
    .eq("id", valuationId)
    .eq("status", "draft");
  if (error) throw new DatabaseError(error);

  const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: request, error: reqErr } = await supabase
    .from("approval_requests")
    .insert({
      organization_id: ctx.organization.id,
      entity_type: "client_valuation",
      entity_id: valuationId,
      title: `مراجعة مستخلص ${val.valuation_number}`,
      status: "in_progress",
      mode: "sequential",
      requested_by: ctx.userId,
      due_at: dueAt,
      warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (reqErr || !request) throw new DatabaseError(reqErr);

  await supabase.from("approval_steps").insert({
    organization_id: ctx.organization.id,
    request_id: request.id,
    sequence: 1,
    approver_type: "user",
    user_id: approverId,
    status: "in_progress",
    due_at: dueAt,
    warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
  });

  await createNotificationService(supabase).notify({
    organizationId: ctx.organization.id,
    recipientProfileId: approverId,
    type: "approval.required",
    title: `مراجعة مستخلص ${val.valuation_number}`,
    message: "مطلوب مراجعة داخلية للمستخلص",
    entityType: "client_valuation",
    entityId: valuationId,
    priority: "high",
  });

  revalidatePath(`/finance/client-valuations/${valuationId}`);
  revalidatePath("/approvals");
  });
}

export async function approveClientValuationInternalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "client_valuation.approve");
  const valuationId = String(formData.get("valuationId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { data: val } = await supabase
    .from("client_valuations")
    .select("valuation_number")
    .eq("id", valuationId)
    .maybeSingle();
  if (!val) throw new NotFoundError("المستخلص", "Valuation");

  await ensureApprovalAndDecide(supabase, ctx, {
    entityType: "client_valuation",
    entityId: valuationId,
    title: `اعتماد داخلي مستخلص ${val.valuation_number}`,
    approverId: ctx.userId,
  });

  revalidatePath(`/finance/client-valuations/${valuationId}`);
  });
}

export async function markValuationUnderClientReviewAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "client_valuation.submit");
  const valuationId = String(formData.get("valuationId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("client_valuations")
    .update({ status: "under_client_review" })
    .eq("id", valuationId)
    .eq("status", "submitted");
  if (error) throw new DatabaseError(error);
  revalidatePath(`/finance/client-valuations/${valuationId}`);
  });
}

export async function recordClientValuationCertificationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "client_valuation.approve");
  const parsed = z
    .object({
      valuationId: z.string().uuid(),
      clientReference: z.string().trim().min(1),
      certifiedAmount: z.coerce.number().nonnegative(),
      certificationDate: z.string().optional(),
      comments: z.string().optional(),
    })
    .safeParse({
      valuationId: formData.get("valuationId"),
      clientReference: formData.get("clientReference"),
      certifiedAmount: formData.get("certifiedAmount"),
      certificationDate: formData.get("certificationDate") || undefined,
      comments: formData.get("comments") || undefined,
    });
  if (!parsed.success) throw new ValidationError("بيانات التصديق غير مكتملة.", "Certification incomplete.");

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("record_client_valuation_certification", {
    p_valuation_id: parsed.data.valuationId,
    p_client_reference: parsed.data.clientReference,
    p_certified_amount: parsed.data.certifiedAmount,
    p_certification_date: parsed.data.certificationDate ?? null,
    p_comments: parsed.data.comments ?? null,
  });
  if (error) throw new DatabaseError(error);
  revalidatePath(`/finance/client-valuations/${parsed.data.valuationId}`);
  });
}

export async function createClientInvoiceAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "client_invoice.create");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      contractId: z.string().uuid().optional(),
      valuationId: z.string().uuid().optional(),
      invoiceNumber: z.string().trim().min(1),
      invoiceDate: z.string(),
      dueDate: z.string().optional(),
      taxableAmount: z.coerce.number().nonnegative(),
      vatRate: z.coerce.number().nonnegative().default(15),
      currency: z.string().default("SAR"),
    })
    .safeParse({
      projectId: formData.get("projectId"),
      contractId: formData.get("contractId") || undefined,
      valuationId: formData.get("valuationId") || undefined,
      invoiceNumber: formData.get("invoiceNumber"),
      invoiceDate: formData.get("invoiceDate"),
      dueDate: formData.get("dueDate") || undefined,
      taxableAmount: formData.get("taxableAmount"),
      vatRate: formData.get("vatRate") || 15,
      currency: formData.get("currency") || "SAR",
    });
  if (!parsed.success) throw new ValidationError("بيانات الفاتورة غير مكتملة.", "Invoice incomplete.");

  const supabase = await createServerSupabaseClient();

  if (parsed.data.valuationId) {
    const { data: val } = await supabase
      .from("client_valuations")
      .select("status, certified_amount, total_claim")
      .eq("id", parsed.data.valuationId)
      .maybeSingle();
    if (!val || !["certified", "partially_certified"].includes(val.status)) {
      throw new ValidationError("المستخلص غير معتمد من العميل.", "Valuation not client-certified.");
    }
    const certified = Number(val.certified_amount ?? 0);
    const total = grossWithVat(parsed.data.taxableAmount, parsed.data.vatRate);
    if (total > certified + 0.001) {
      throw new ValidationError("مبلغ الفاتورة يتجاوز المبلغ المعتمد.", "Invoice exceeds certified amount.");
    }
  }

  const vat = vatAmount(parsed.data.taxableAmount, parsed.data.vatRate);
  const total = grossWithVat(parsed.data.taxableAmount, parsed.data.vatRate);

  const { data: inv, error } = await supabase
    .from("client_invoices")
    .insert({
      organization_id: ctx.organization.id,
      project_id: parsed.data.projectId,
      contract_id: parsed.data.contractId ?? null,
      valuation_id: parsed.data.valuationId ?? null,
      invoice_number: parsed.data.invoiceNumber,
      invoice_date: parsed.data.invoiceDate,
      due_date: parsed.data.dueDate ?? null,
      currency: parsed.data.currency,
      amount: parsed.data.taxableAmount,
      vat_amount: vat,
      total,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !inv) throw new DatabaseError(error);

  revalidatePath("/finance/client-invoices");
  revalidatePath(`/finance/client-invoices/${inv.id}`);
  redirect(`/finance/client-invoices/${inv.id}`);
  });
}

export async function issueClientInvoiceAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "client_invoice.issue");
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!z.string().uuid().safeParse(invoiceId).success) {
    throw new ValidationError("معرف الفاتورة غير صالح.", "Invalid invoice id.");
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("issue_client_invoice", { p_invoice_id: invoiceId });
  if (error) throw new DatabaseError(error);
  revalidatePath(`/finance/client-invoices/${invoiceId}`);
  revalidatePath("/finance/client-invoices");
  redirect(`/finance/client-invoices/${invoiceId}`);
  });
}

export async function createVariationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "variation.create");
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      contractId: z.string().uuid().optional(),
      source: z.string().trim().min(1),
      description: z.string().trim().min(1),
      reason: z.string().optional(),
      requestedAmount: z.coerce.number().nonnegative(),
      costImpact: z.coerce.number().nonnegative().optional(),
      timeImpactDays: z.coerce.number().int().default(0),
      relatedRfiId: z.string().uuid().optional(),
      relatedNcrId: z.string().uuid().optional(),
    })
    .safeParse({
      projectId: formData.get("projectId"),
      contractId: formData.get("contractId") || undefined,
      source: formData.get("source"),
      description: formData.get("description"),
      reason: formData.get("reason") || undefined,
      requestedAmount: formData.get("requestedAmount"),
      costImpact: formData.get("costImpact") || undefined,
      timeImpactDays: formData.get("timeImpactDays") || 0,
      relatedRfiId: formData.get("relatedRfiId") || undefined,
      relatedNcrId: formData.get("relatedNcrId") || undefined,
    });
  if (!parsed.success) throw new ValidationError("بيانات أمر التغيير غير مكتملة.", "Variation incomplete.");

  const supabase = await createServerSupabaseClient();
  const { data: num, error: numErr } = await supabase.rpc("generate_commercial_number", {
    p_organization_id: ctx.organization.id,
    p_project_id: parsed.data.projectId,
    p_doc_type: "VO",
  });
  if (numErr || !num) throw new DatabaseError(numErr);

  const cost = parsed.data.costImpact ?? parsed.data.requestedAmount;
  const { data: vo, error } = await supabase
    .from("variations")
    .insert({
      organization_id: ctx.organization.id,
      project_id: parsed.data.projectId,
      contract_id: parsed.data.contractId ?? null,
      vo_number: num,
      source: parsed.data.source,
      description: parsed.data.description,
      reason: parsed.data.reason ?? null,
      requested_amount: parsed.data.requestedAmount,
      cost_impact: cost,
      submitted_amount: parsed.data.requestedAmount,
      time_impact_days: parsed.data.timeImpactDays,
      related_rfi_id: parsed.data.relatedRfiId ?? null,
      related_ncr_id: parsed.data.relatedNcrId ?? null,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !vo) throw new DatabaseError(error);

  revalidatePath("/finance/variations");
  revalidatePath(`/finance/variations/${vo.id}`);
  });
}

export async function submitVariationAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "variation.submit");
  const variationId = String(formData.get("variationId") ?? "");
  const approverId = String(formData.get("approverId") ?? "");
  const supabase = await createServerSupabaseClient();

  const { data: vo } = await supabase
    .from("variations")
    .select("vo_number, submitted_amount, cost_impact")
    .eq("id", variationId)
    .maybeSingle();
  if (!vo) throw new NotFoundError("أمر التغيير", "Variation");

  await supabase
    .from("variations")
    .update({
      status: "under_review",
      submitted_date: new Date().toISOString().slice(0, 10),
      submitted_amount: roundMoney(Number(vo.submitted_amount || vo.cost_impact || 0)),
    })
    .eq("id", variationId);

  const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: request, error: reqErr } = await supabase
    .from("approval_requests")
    .insert({
      organization_id: ctx.organization.id,
      entity_type: "variation",
      entity_id: variationId,
      title: `اعتماد أمر تغيير ${vo.vo_number}`,
      status: "in_progress",
      mode: "sequential",
      requested_by: ctx.userId,
      due_at: dueAt,
      warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (reqErr || !request) throw new DatabaseError(reqErr);

  await supabase.from("approval_steps").insert({
    organization_id: ctx.organization.id,
    request_id: request.id,
    sequence: 1,
    approver_type: "user",
    user_id: approverId,
    status: "in_progress",
    due_at: dueAt,
    warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
  });

  revalidatePath(`/finance/variations/${variationId}`);
  });
}

export async function approveVariationWithAmountAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية التجارية. حاول مرة أخرى.", async () => {
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
