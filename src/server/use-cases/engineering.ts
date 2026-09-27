"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConflictError, DatabaseError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createNotificationService } from "@/server/services/notification.service";
import { AuditService } from "@/server/services/audit.service";
import { EventService } from "@/server/services/event.service";
import { generateCorrelationId } from "@/lib/utils";

const createRfiSchema = z.object({
  projectId: z.string().uuid(),
  disciplineCode: z.string().min(2).max(16),
  subject: z.string().trim().min(3).max(300),
  question: z.string().trim().min(5).max(8000),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  responseRequiredBy: z.string().optional(),
  drawingReferences: z.string().optional(),
  specificationReferences: z.string().optional(),
  location: z.string().optional(),
});

export async function createRfiAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "rfi.create");
  const parsed = createRfiSchema.safeParse({
    projectId: formData.get("projectId"),
    disciplineCode: formData.get("disciplineCode"),
    subject: formData.get("subject"),
    question: formData.get("question"),
    priority: formData.get("priority") || "medium",
    responseRequiredBy: formData.get("responseRequiredBy") || undefined,
    drawingReferences: formData.get("drawingReferences") || undefined,
    specificationReferences: formData.get("specificationReferences") || undefined,
    location: formData.get("location") || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات طلب الاستفسار غير مكتملة.", "RFI data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: doc, error: docError } = await supabase.rpc("register_controlled_document", {
    p_organization_id: ctx.organization.id,
    p_project_id: parsed.data.projectId,
    p_type_code: "RFI",
    p_discipline_code: parsed.data.disciplineCode,
    p_title: parsed.data.subject,
    p_description: parsed.data.question.slice(0, 500),
    p_responsible_engineer_id: ctx.userId,
    p_confidentiality: "internal",
  });
  if (docError || !doc) throw new DatabaseError(docError);

  const due = parsed.data.responseRequiredBy
    ? new Date(parsed.data.responseRequiredBy).toISOString()
    : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rfi, error } = await supabase
    .from("rfis")
    .insert({
      organization_id: ctx.organization.id,
      project_id: parsed.data.projectId,
      document_id: doc.id,
      discipline_id: doc.discipline_id,
      rfi_number: doc.document_number,
      subject: parsed.data.subject,
      question: parsed.data.question,
      drawing_references: parsed.data.drawingReferences ?? null,
      specification_references: parsed.data.specificationReferences ?? null,
      location: parsed.data.location ?? null,
      raised_by: ctx.userId,
      responsible_engineer_id: ctx.userId,
      priority: parsed.data.priority,
      response_required_by: due,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id, rfi_number")
    .single();
  if (error || !rfi) throw new DatabaseError(error);

  const events = new EventService(supabase);
  await events.publish({
    type: "rfi.created",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "rfi",
    entityId: rfi.id,
    payload: { rfi_number: rfi.rfi_number },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidatePath("/engineering");
  revalidatePath(`/projects/${parsed.data.projectId}`);
  });
}

export async function respondRfiAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "rfi.respond");
  const rfiId = String(formData.get("rfiId") ?? "");
  const response = String(formData.get("response") ?? "").trim();
  if (!rfiId || response.length < 2) {
    throw new ValidationError("الرد غير مكتمل.", "Response is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("rfis")
    .select("id, status, question, project_id, organization_id")
    .eq("id", rfiId)
    .maybeSingle();
  if (!existing) throw new ValidationError("طلب الاستفسار غير موجود.", "RFI not found.");
  if (existing.status === "closed" || existing.status === "cancelled") {
    throw new ConflictError("لا يمكن تعديل طلب مغلق.", "Closed RFI cannot be updated.");
  }

  const { error } = await supabase
    .from("rfis")
    .update({
      response,
      responded_by: ctx.userId,
      response_date: new Date().toISOString(),
      status: "answered",
    })
    .eq("id", rfiId);
  if (error) throw new DatabaseError(error);

  // Original question must remain (DB trigger also enforces when closed)
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "rfi.answered",
    entityType: "rfi",
    entityId: rfiId,
    newValues: { response },
  });

  revalidatePath("/engineering");
  revalidatePath(`/projects/${existing.project_id}`);
  });
}

export async function createNcrAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "ncr.create");
  const projectId = String(formData.get("projectId") ?? "");
  const disciplineCode = String(formData.get("disciplineCode") ?? "GENERAL");
  const description = String(formData.get("description") ?? "").trim();
  const severity = String(formData.get("severity") ?? "medium") as
    | "low"
    | "medium"
    | "high"
    | "critical";
  const location = String(formData.get("location") ?? "") || null;

  if (!projectId || description.length < 5) {
    throw new ValidationError("بيانات تقرير عدم المطابقة غير مكتملة.", "NCR data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: doc, error: docError } = await supabase.rpc("register_controlled_document", {
    p_organization_id: ctx.organization.id,
    p_project_id: projectId,
    p_type_code: "NCR",
    p_discipline_code: disciplineCode,
    p_title: `NCR — ${description.slice(0, 80)}`,
    p_description: description.slice(0, 500),
    p_responsible_engineer_id: ctx.userId,
    p_confidentiality: "internal",
  });
  if (docError || !doc) throw new DatabaseError(docError);

  const { data: ncr, error } = await supabase
    .from("ncrs")
    .insert({
      organization_id: ctx.organization.id,
      project_id: projectId,
      document_id: doc.id,
      discipline_id: doc.discipline_id,
      ncr_number: doc.document_number,
      location,
      reported_by: ctx.userId,
      assigned_to: ctx.userId,
      severity,
      description,
      status: "open",
      created_by: ctx.userId,
    })
    .select("id, ncr_number, severity")
    .single();
  if (error || !ncr) throw new DatabaseError(error);

  const events = new EventService(supabase);
  await events.publish({
    type: severity === "critical" ? "ncr.critical" : "ncr.created",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "ncr",
    entityId: ncr.id,
    payload: { severity, ncr_number: ncr.ncr_number },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  if (severity === "critical") {
    const notifications = createNotificationService(supabase);
    // Notify actor as minimum; managers receive via future fan-out from events
    await notifications.notify({
      organizationId: ctx.organization.id,
      recipientProfileId: ctx.userId,
      type: "ncr.critical",
      title: "تقرير عدم مطابقة حرج",
      message: `تم تسجيل NCR حرج: ${ncr.ncr_number}`,
      entityType: "ncr",
      entityId: ncr.id,
      priority: "urgent",
    });
  }

  revalidatePath("/engineering");
  revalidatePath(`/projects/${projectId}`);
  });
}

export async function applyDocumentDecisionAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "document.approve");
  const documentId = String(formData.get("documentId") ?? "");
  const officialCode = String(formData.get("officialCode") ?? "");
  const comments = String(formData.get("comments") ?? "") || null;
  if (!documentId || !["A", "B", "C", "D", "E"].includes(officialCode)) {
    throw new ValidationError("قرار الاعتماد غير صالح.", "Invalid approval decision.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("apply_document_approval_decision", {
    p_document_id: documentId,
    p_official_code: officialCode,
    p_comments: comments,
  });
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      throw new ValidationError("ليست لديك صلاحية الاعتماد.", "You cannot approve this document.");
    }
    if (error.message.includes("VALIDATION")) {
      throw new ValidationError("يجب إدخال سبب عند الرفض.", "Rejection requires a comment.");
    }
    throw new DatabaseError(error);
  }

  revalidatePath("/document-control");
  revalidatePath("/engineering");
  });
}

export async function reviseDocumentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "document_control.revise");
  const documentId = String(formData.get("documentId") ?? "");
  const changeDescription = String(formData.get("changeDescription") ?? "") || null;
  if (!documentId) {
    throw new ValidationError("المستند غير محدد.", "Document is required.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("create_document_revision", {
    p_document_id: documentId,
    p_change_description: changeDescription,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/document-control");
  revalidatePath("/engineering");
  });
}

async function registerDoc(params: {
  organizationId: string;
  projectId: string;
  typeCode: string;
  disciplineCode: string;
  title: string;
  description?: string;
  responsibleEngineerId: string;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: doc, error } = await supabase.rpc("register_controlled_document", {
    p_organization_id: params.organizationId,
    p_project_id: params.projectId,
    p_type_code: params.typeCode,
    p_discipline_code: params.disciplineCode,
    p_title: params.title,
    p_description: params.description ?? null,
    p_responsible_engineer_id: params.responsibleEngineerId,
    p_confidentiality: "internal",
  });
  if (error || !doc) throw new DatabaseError(error);
  return { supabase, doc };
}

export async function submitRfiAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "rfi.submit");
  const rfiId = String(formData.get("rfiId") ?? "");
  if (!rfiId) throw new ValidationError("طلب الاستفسار غير محدد.", "RFI is required.");

  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("rfis")
    .select("id, status, project_id, organization_id, rfi_number, document_id")
    .eq("id", rfiId)
    .maybeSingle();
  if (!existing) throw new ValidationError("طلب الاستفسار غير موجود.", "RFI not found.");
  if (!["draft", "internal_review"].includes(existing.status)) {
    throw new ConflictError("لا يمكن تقديم هذا الطلب من حالته الحالية.", "Invalid RFI status for submit.");
  }

  const due = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("rfis")
    .update({ status: "submitted", response_required_by: due })
    .eq("id", rfiId);
  if (error) throw new DatabaseError(error);

  await supabase
    .from("documents")
    .update({
      submission_status: "submitted",
      submitted_at: new Date().toISOString(),
      response_due_at: due,
      status: "submitted",
    })
    .eq("id", existing.document_id);

  await new EventService(supabase).publish({
    type: "rfi.submitted",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "rfi",
    entityId: rfiId,
    payload: { rfi_number: existing.rfi_number },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidatePath("/engineering");
  revalidatePath(`/projects/${existing.project_id}`);
  });
}

export async function closeRfiAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "rfi.close");
  const rfiId = String(formData.get("rfiId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("rfis")
    .select("id, status, project_id, response")
    .eq("id", rfiId)
    .maybeSingle();
  if (!existing) throw new ValidationError("طلب الاستفسار غير موجود.", "RFI not found.");
  if (!existing.response) {
    throw new ValidationError("لا يمكن إغلاق طلب بدون رد.", "Cannot close RFI without a response.");
  }
  const { error } = await supabase.from("rfis").update({ status: "closed" }).eq("id", rfiId);
  if (error) throw new DatabaseError(error);
  revalidatePath("/engineering");
  revalidatePath(`/projects/${existing.project_id}`);
  });
}

export async function createMaterialSubmittalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "submittal.create");
  const projectId = String(formData.get("projectId") ?? "");
  const disciplineCode = String(formData.get("disciplineCode") ?? "GENERAL");
  const materialCategory = String(formData.get("materialCategory") ?? "").trim();
  const technicalDescription = String(formData.get("technicalDescription") ?? "").trim() || null;
  const manufacturer = String(formData.get("manufacturer") ?? "") || null;
  if (!projectId || materialCategory.length < 2) {
    throw new ValidationError("بيانات اعتماد المواد غير مكتملة.", "Material submittal data incomplete.");
  }

  const { supabase, doc } = await registerDoc({
    organizationId: ctx.organization.id,
    projectId,
    typeCode: "MAT",
    disciplineCode,
    title: materialCategory,
    description: technicalDescription ?? undefined,
    responsibleEngineerId: ctx.userId,
  });

  const { error } = await supabase.from("material_submittals").insert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    document_id: doc.id,
    discipline_id: doc.discipline_id,
    mat_number: doc.document_number,
    material_category: materialCategory,
    manufacturer,
    technical_description: technicalDescription,
    submitted_by: ctx.userId,
    responsible_engineer_id: ctx.userId,
    status: "draft",
    created_by: ctx.userId,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/engineering");
  revalidatePath("/document-control");
  revalidatePath(`/projects/${projectId}`);
  });
}

export async function createShopDrawingAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "shop_drawing.create");
  const projectId = String(formData.get("projectId") ?? "");
  const disciplineCode = String(formData.get("disciplineCode") ?? "GENERAL");
  const drawingTitle = String(formData.get("drawingTitle") ?? "").trim();
  const drawingNumber = String(formData.get("drawingNumber") ?? "") || null;
  const floorZone = String(formData.get("floorZone") ?? "") || null;
  if (!projectId || drawingTitle.length < 2) {
    throw new ValidationError("بيانات المخطط التنفيذي غير مكتملة.", "Shop drawing data incomplete.");
  }

  const { supabase, doc } = await registerDoc({
    organizationId: ctx.organization.id,
    projectId,
    typeCode: "SHD",
    disciplineCode,
    title: drawingTitle,
    responsibleEngineerId: ctx.userId,
  });

  const { error } = await supabase.from("shop_drawings").insert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    document_id: doc.id,
    discipline_id: doc.discipline_id,
    shd_number: doc.document_number,
    drawing_title: drawingTitle,
    drawing_number: drawingNumber,
    floor_zone_location: floorZone,
    responsible_engineer_id: ctx.userId,
    prepared_by: ctx.userId,
    status: "draft",
    created_by: ctx.userId,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/engineering");
  revalidatePath("/document-control");
  revalidatePath(`/projects/${projectId}`);
  });
}

export async function createMethodStatementAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "method_statement.create");
  const projectId = String(formData.get("projectId") ?? "");
  const disciplineCode = String(formData.get("disciplineCode") ?? "GENERAL");
  const activity = String(formData.get("activity") ?? "").trim();
  const scope = String(formData.get("scope") ?? "") || null;
  const methodProcedure = String(formData.get("methodProcedure") ?? "") || null;
  if (!projectId || activity.length < 2) {
    throw new ValidationError("بيانات طريقة التنفيذ غير مكتملة.", "Method statement data incomplete.");
  }

  const { supabase, doc } = await registerDoc({
    organizationId: ctx.organization.id,
    projectId,
    typeCode: "MS",
    disciplineCode,
    title: activity,
    description: scope ?? undefined,
    responsibleEngineerId: ctx.userId,
  });

  const { error } = await supabase.from("method_statements").insert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    document_id: doc.id,
    discipline_id: doc.discipline_id,
    ms_number: doc.document_number,
    activity,
    scope,
    method_procedure: methodProcedure,
    responsible_engineer_id: ctx.userId,
    status: "draft",
    created_by: ctx.userId,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/engineering");
  revalidatePath(`/projects/${projectId}`);
  });
}

export async function createInspectionRequestAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "inspection.create");
  const projectId = String(formData.get("projectId") ?? "");
  const disciplineCode = String(formData.get("disciplineCode") ?? "GENERAL");
  const relatedActivity = String(formData.get("relatedActivity") ?? "").trim();
  const location = String(formData.get("location") ?? "") || null;
  const inspectionDate = String(formData.get("inspectionDate") ?? "") || null;
  if (!projectId || relatedActivity.length < 2) {
    throw new ValidationError("بيانات طلب الفحص غير مكتملة.", "Inspection request data incomplete.");
  }

  const { supabase, doc } = await registerDoc({
    organizationId: ctx.organization.id,
    projectId,
    typeCode: "IR",
    disciplineCode,
    title: relatedActivity,
    description: location ?? undefined,
    responsibleEngineerId: ctx.userId,
  });

  const { error } = await supabase.from("inspection_requests").insert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    document_id: doc.id,
    discipline_id: doc.discipline_id,
    ir_number: doc.document_number,
    related_activity: relatedActivity,
    location,
    inspection_date_requested: inspectionDate,
    requested_by: ctx.userId,
    site_engineer_id: ctx.userId,
    status: "draft",
    created_by: ctx.userId,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/engineering");
  revalidatePath(`/projects/${projectId}`);
  });
}

export async function recordInspectionResultAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "inspection.perform");
  const inspectionId = String(formData.get("inspectionId") ?? "");
  const result = String(formData.get("result") ?? "") as
    | "passed"
    | "passed_with_comments"
    | "failed";
  const comments = String(formData.get("comments") ?? "") || null;
  if (!inspectionId || !["passed", "passed_with_comments", "failed"].includes(result)) {
    throw new ValidationError("نتيجة الفحص غير صالحة.", "Invalid inspection result.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("inspection_requests")
    .select("id, project_id, organization_id, ir_number, status")
    .eq("id", inspectionId)
    .maybeSingle();
  if (!existing) throw new ValidationError("طلب الفحص غير موجود.", "Inspection not found.");

  const status =
    result === "failed"
      ? "failed"
      : result === "passed_with_comments"
        ? "passed_with_comments"
        : "passed";

  const { error } = await supabase
    .from("inspection_requests")
    .update({
      inspection_result: result,
      comments,
      status,
      quality_engineer_id: ctx.userId,
    })
    .eq("id", inspectionId);
  if (error) throw new DatabaseError(error);

  const events = new EventService(supabase);
  await events.publish({
    type: result === "failed" ? "inspection.failed" : "inspection.passed",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "inspection_request",
    entityId: inspectionId,
    payload: { ir_number: existing.ir_number, result },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  if (result === "failed") {
    await createNotificationService(supabase).notify({
      organizationId: ctx.organization.id,
      recipientProfileId: ctx.userId,
      type: "inspection.failed",
      title: "فشل فحص",
      message: `فشل الفحص: ${existing.ir_number}`,
      entityType: "inspection_request",
      entityId: inspectionId,
      priority: "high",
    });
  }

  revalidatePath("/engineering");
  revalidatePath(`/projects/${existing.project_id}`);
  });
}

export async function createReinspectionAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "inspection.create");
  const parentId = String(formData.get("parentInspectionId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { data: parent } = await supabase
    .from("inspection_requests")
    .select("*")
    .eq("id", parentId)
    .maybeSingle();
  if (!parent || parent.status !== "failed") {
    throw new ValidationError("إعادة الفحص تتطلب فحصاً فاشلاً.", "Reinspection requires a failed IR.");
  }

  const { data: discipline } = await supabase
    .from("engineering_disciplines")
    .select("code")
    .eq("id", parent.discipline_id)
    .maybeSingle();

  const { doc } = await registerDoc({
    organizationId: ctx.organization.id,
    projectId: parent.project_id,
    typeCode: "IR",
    disciplineCode: discipline?.code ?? "GENERAL",
    title: `إعادة فحص — ${parent.related_activity ?? parent.ir_number}`,
    responsibleEngineerId: ctx.userId,
  });

  const { error } = await supabase.from("inspection_requests").insert({
    organization_id: ctx.organization.id,
    project_id: parent.project_id,
    document_id: doc.id,
    discipline_id: parent.discipline_id,
    ir_number: doc.document_number,
    related_activity: parent.related_activity,
    location: parent.location,
    related_drawing_id: parent.related_drawing_id,
    related_method_statement_id: parent.related_method_statement_id,
    related_material_submittal_id: parent.related_material_submittal_id,
    requested_by: ctx.userId,
    site_engineer_id: parent.site_engineer_id,
    parent_inspection_id: parent.id,
    status: "ready",
    created_by: ctx.userId,
  });
  if (error) throw new DatabaseError(error);

  await supabase
    .from("inspection_requests")
    .update({ status: "reinspection_required" })
    .eq("id", parentId);

  revalidatePath("/engineering");
  revalidatePath(`/projects/${parent.project_id}`);
  });
}

export async function closeNcrAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "ncr.close");
  const ncrId = String(formData.get("ncrId") ?? "");
  const verification = String(formData.get("verification") ?? "").trim();
  if (!ncrId || verification.length < 3) {
    throw new ValidationError("التحقق مطلوب لإغلاق NCR.", "Verification required to close NCR.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("ncrs")
    .select("id, project_id, ncr_number, status")
    .eq("id", ncrId)
    .maybeSingle();
  if (!existing) throw new ValidationError("التقرير غير موجود.", "NCR not found.");

  const { error } = await supabase
    .from("ncrs")
    .update({
      status: "closed",
      verification,
      verified_by: ctx.userId,
      verified_at: new Date().toISOString(),
      actual_closure_date: new Date().toISOString().slice(0, 10),
    })
    .eq("id", ncrId);
  if (error) throw new DatabaseError(error);

  await new EventService(supabase).publish({
    type: "ncr.closed",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "ncr",
    entityId: ncrId,
    payload: { ncr_number: existing.ncr_number },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidatePath("/engineering");
  revalidatePath(`/projects/${existing.project_id}`);
  });
}

export async function reopenNcrAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "ncr.manage");
  const ncrId = String(formData.get("ncrId") ?? "");
  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("ncrs")
    .select("id, project_id, ncr_number, status")
    .eq("id", ncrId)
    .maybeSingle();
  if (!existing || existing.status !== "closed") {
    throw new ValidationError("يمكن إعادة فتح تقرير مغلق فقط.", "Only closed NCRs can be reopened.");
  }

  const { error } = await supabase
    .from("ncrs")
    .update({
      status: "reopened",
      verified_by: null,
      verified_at: null,
      actual_closure_date: null,
    })
    .eq("id", ncrId);
  if (error) throw new DatabaseError(error);

  await new EventService(supabase).publish({
    type: "ncr.reopened",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "ncr",
    entityId: ncrId,
    payload: { ncr_number: existing.ncr_number },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidatePath("/engineering");
  revalidatePath(`/projects/${existing.project_id}`);
  });
}

export async function createProjectReportAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "report.create");
  const projectId = String(formData.get("projectId") ?? "");
  const reportType = String(formData.get("reportType") ?? "daily") as "daily" | "weekly" | "monthly";
  const periodStart = String(formData.get("periodStart") ?? "");
  const periodEnd = String(formData.get("periodEnd") ?? "");
  const managementSummary = String(formData.get("managementSummary") ?? "") || null;
  const activitiesCompleted = String(formData.get("activitiesCompleted") ?? "") || null;
  if (!projectId || !periodStart || !periodEnd) {
    throw new ValidationError("بيانات التقرير غير مكتملة.", "Report data incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("project_reports").insert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    report_type: reportType,
    period_start: periodStart,
    period_end: periodEnd,
    prepared_by: ctx.userId,
    activities_completed: activitiesCompleted,
    management_summary: managementSummary,
    status: "draft",
  });
  if (error) throw new DatabaseError(error);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/engineering");
  });
}

export async function createCorrespondenceAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "correspondence.create");
  const projectId = String(formData.get("projectId") ?? "");
  const direction = String(formData.get("direction") ?? "outgoing") as
    | "incoming"
    | "outgoing"
    | "internal";
  const subject = String(formData.get("subject") ?? "").trim();
  const sender = String(formData.get("sender") ?? "").trim();
  const recipient = String(formData.get("recipient") ?? "").trim();
  const bodySummary = String(formData.get("bodySummary") ?? "") || null;
  const responseRequired = formData.get("responseRequired") === "on";
  const responseDue = String(formData.get("responseDueDate") ?? "") || null;

  if (!projectId || !subject || !sender || !recipient) {
    throw new ValidationError("بيانات المراسلة غير مكتملة.", "Correspondence data incomplete.");
  }

  const { supabase, doc } = await registerDoc({
    organizationId: ctx.organization.id,
    projectId,
    typeCode: "COR",
    disciplineCode: "GENERAL",
    title: subject,
    description: bodySummary ?? undefined,
    responsibleEngineerId: ctx.userId,
  });

  const { error } = await supabase.from("correspondence").insert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    document_id: doc.id,
    reference_number: doc.document_number,
    direction,
    sender,
    recipient,
    subject,
    body_summary: bodySummary,
    response_required: responseRequired,
    response_due_date: responseDue,
    status: responseRequired ? "awaiting_response" : "open",
    created_by: ctx.userId,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/document-control");
  });
}

export async function createTransmittalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "transmittal.create");
  const projectId = String(formData.get("projectId") ?? "");
  const recipient = String(formData.get("recipient") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "") || null;
  const documentIds = String(formData.get("documentIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const purpose = String(formData.get("purpose") ?? "for_review") as
    | "for_approval"
    | "for_review"
    | "for_information"
    | "for_construction"
    | "for_record";

  if (!projectId || !recipient || !subject || documentIds.length === 0) {
    throw new ValidationError("بيانات الإرسالية غير مكتملة.", "Transmittal data incomplete.");
  }

  const { supabase, doc: headerDoc } = await registerDoc({
    organizationId: ctx.organization.id,
    projectId,
    typeCode: "TRN",
    disciplineCode: "GENERAL",
    title: subject,
    description: description ?? undefined,
    responsibleEngineerId: ctx.userId,
  });

  const { data: transmittal, error } = await supabase
    .from("transmittals")
    .insert({
      organization_id: ctx.organization.id,
      project_id: projectId,
      transmittal_number: headerDoc.document_number,
      direction: "outgoing",
      recipient,
      subject,
      description,
      status: "draft",
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !transmittal) throw new DatabaseError(error);

  for (const documentId of documentIds) {
    const { data: version } = await supabase
      .from("document_versions")
      .select("id")
      .eq("document_id", documentId)
      .eq("is_current", true)
      .maybeSingle();
    if (!version) {
      // Fallback: use document current revision row if versions table empty for legacy docs
      const { data: anyVersion } = await supabase
        .from("document_versions")
        .select("id")
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!anyVersion) {
        throw new ValidationError(
          "لا توجد مراجعة للمستند المحدد.",
          "Selected document has no revision to attach.",
        );
      }
      const { error: itemErr } = await supabase.from("transmittal_items").insert({
        organization_id: ctx.organization.id,
        transmittal_id: transmittal.id,
        document_id: documentId,
        document_version_id: anyVersion.id,
        purpose,
      });
      if (itemErr) throw new DatabaseError(itemErr);
      continue;
    }
    const { error: itemErr } = await supabase.from("transmittal_items").insert({
      organization_id: ctx.organization.id,
      transmittal_id: transmittal.id,
      document_id: documentId,
      document_version_id: version.id,
      purpose,
    });
    if (itemErr) throw new DatabaseError(itemErr);
  }

  revalidatePath("/document-control");
  revalidatePath(`/projects/${projectId}`);
  });
}

export async function issueTransmittalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية الهندسية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "transmittal.issue");
  const transmittalId = String(formData.get("transmittalId") ?? "");
  if (!transmittalId) {
    throw new ValidationError("الإرسالية غير محددة.", "Transmittal is required.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("issue_transmittal", {
    p_transmittal_id: transmittalId,
  });
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      throw new ValidationError("ليست لديك صلاحية الإصدار.", "Cannot issue transmittal.");
    }
    if (error.message.includes("CONFLICT")) {
      throw new ConflictError("الإرسالية صادرة مسبقاً أو فارغة.", "Transmittal already issued or empty.");
    }
    throw new DatabaseError(error);
  }

  revalidatePath("/document-control");
  });
}
