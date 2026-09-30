"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createProjectSchema } from "@/modules/projects/schemas";
import {
  assignDepartmentSchema,
  assignRoleSchema,
  createUserSchema,
  setUserActiveSchema,
} from "@/modules/users/schemas";
import { uploadDocumentSchema } from "@/modules/documents/schemas";
import {
  completeWorkflowStepSchema,
  createApprovalSchema,
  decideApprovalSchema,
  startWorkflowSchema,
} from "@/modules/approvals/schemas";
import { ConflictError, DatabaseError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { generateCorrelationId } from "@/lib/utils";
import { isPrivilegedRoleCode } from "@/lib/hr/roles";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { AuditService } from "@/server/services/audit.service";
import { EventService } from "@/server/services/event.service";
import { createNotificationService } from "@/server/services/notification.service";
import { StorageService } from "@/server/services/storage.service";
import { parseGoogleDriveUrl } from "@/modules/documents/google-drive-url";
import { isStorageFileRequired } from "@/modules/documents/schemas";
import { assertProjectBelongsToOrganization } from "@/modules/documents/project-scope";
import type { Project } from "@/types/models";

function nextRevision(current: string): string {
  const match = current.match(/^([A-Z]+)(\d*)$/i);
  if (!match) {
    return "B";
  }
  const letters = match[1] ?? "A";
  return String.fromCharCode(letters.charCodeAt(0) + 1);
}

export async function createProjectAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إنشاء المشروع. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "project.create");
  const parsed = createProjectSchema.safeParse({
    name_ar: formData.get("name_ar"),
    name_en: formData.get("name_en"),
    description: formData.get("description") || undefined,
    project_manager_id: formData.get("project_manager_id") || undefined,
    priority: formData.get("priority") || "medium",
    start_date: formData.get("start_date") || undefined,
    planned_end_date: formData.get("planned_end_date") || undefined,
    location: formData.get("location") || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات المشروع غير مكتملة.", "Project data is incomplete.", {
      issues: parsed.error.flatten(),
    });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_project", {
    p_organization_id: ctx.organization.id,
    p_name_ar: parsed.data.name_ar,
    p_name_en: parsed.data.name_en,
    p_description: parsed.data.description ?? null,
    p_client_id: null,
    p_project_manager_id: parsed.data.project_manager_id || null,
    p_priority: parsed.data.priority,
    p_start_date: parsed.data.start_date || null,
    p_planned_end_date: parsed.data.planned_end_date || null,
    p_location: parsed.data.location ?? null,
    p_template_id: null,
  });

  if (error) {
    throw new DatabaseError(error);
  }

  const project = data as Project;
  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
  });
}

export async function assignProjectMemberAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "project.manage_team");
  const projectId = String(formData.get("projectId") ?? "");
  const profileId = String(formData.get("profileId") ?? "");
  const roleLabel = String(formData.get("roleLabel") ?? "member");
  if (!projectId || !profileId) {
    throw new ValidationError("بيانات التعيين غير مكتملة.", "Assignment data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", profileId)
    .maybeSingle<{ id: string }>();

  const { error } = await supabase.from("project_members").upsert({
    organization_id: ctx.organization.id,
    project_id: projectId,
    profile_id: profileId,
    employee_id: employee?.id ?? null,
    role_label: roleLabel,
    is_active: true,
    unassigned_at: null,
  });
  if (error) throw new DatabaseError(error);

  if (employee) {
    await supabase.from("employee_project_assignments").upsert({
      organization_id: ctx.organization.id,
      employee_id: employee.id,
      project_id: projectId,
      role_title: roleLabel,
      is_active: true,
      unassigned_at: null,
    });
  }

  const events = new EventService(supabase);
  await events.publish({
    type: "employee.assigned",
    organizationId: ctx.organization.id,
    actorId: ctx.userId,
    entityType: "project",
    entityId: projectId,
    payload: { profileId },
    correlationId: generateCorrelationId(),
    occurredAt: new Date().toISOString(),
  });

  revalidatePath(`/projects/${projectId}`);
  });
}

export async function updateProjectStageAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "project.update");
  const stageId = String(formData.get("stageId") ?? "");
  const status = String(formData.get("status") ?? "");
  const supabase = await createServerSupabaseClient();

  const patch: Record<string, unknown> = { status };
  if (status === "in_progress") {
    patch.actual_start = new Date().toISOString().slice(0, 10);
  }
  if (status === "completed") {
    patch.actual_end = new Date().toISOString().slice(0, 10);
    patch.progress_percentage = 100;
  }

  const { error } = await supabase
    .from("project_stages")
    .update(patch)
    .eq("id", stageId)
    .eq("organization_id", ctx.organization.id);
  if (error) throw new DatabaseError(error);
  revalidatePath("/projects");
  });
}

export async function startWorkflowAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "workflow.start");
  const parsed = startWorkflowSchema.safeParse({
    definitionId: formData.get("definitionId"),
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
  });
  if (!parsed.success) {
    throw new ValidationError("تعذر بدء مسار العمل.", "Could not start the workflow.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("start_workflow", {
    p_organization_id: ctx.organization.id,
    p_definition_id: parsed.data.definitionId,
    p_entity_type: parsed.data.entityType,
    p_entity_id: parsed.data.entityId,
  });
  if (error) {
    if (error.message.includes("CONFLICT")) {
      throw new ConflictError("يوجد مسار عمل نشط بالفعل.", "An active workflow already exists.");
    }
    throw new DatabaseError(error);
  }
  revalidatePath("/approvals");
  });
}

export async function completeWorkflowStepAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  authorize(await getAuthContext(), "workflow.advance");
  const parsed = completeWorkflowStepSchema.safeParse({
    instanceStepId: formData.get("instanceStepId"),
    outcome: formData.get("outcome"),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات خطوة مسار العمل غير صحيحة.", "Invalid workflow step data.");
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("complete_workflow_step", {
    p_instance_step_id: parsed.data.instanceStepId,
    p_outcome: parsed.data.outcome,
  });
  if (error) {
    if (error.message.includes("CONFLICT")) {
      throw new ConflictError("تم إكمال هذه الخطوة مسبقاً.", "This step was already completed.");
    }
    throw new DatabaseError(error);
  }
  revalidatePath("/");
  });
}

export async function createApprovalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "approval.create");
  const parsed = createApprovalSchema.safeParse({
    title: formData.get("title"),
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
    approverProfileId: formData.get("approverProfileId"),
    dueAt: formData.get("dueAt") || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات الموافقة غير مكتملة.", "Approval data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const dueAt = parsed.data.dueAt
    ? new Date(parsed.data.dueAt).toISOString()
    : new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data: request, error } = await supabase
    .from("approval_requests")
    .insert({
      organization_id: ctx.organization.id,
      entity_type: parsed.data.entityType,
      entity_id: parsed.data.entityId,
      title: parsed.data.title,
      status: "in_progress",
      mode: "sequential",
      requested_by: ctx.userId,
      due_at: dueAt,
      warning_at: new Date(Date.parse(dueAt) - 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !request) throw new DatabaseError(error);

  const { error: stepError } = await supabase.from("approval_steps").insert({
    organization_id: ctx.organization.id,
    request_id: request.id,
    sequence: 1,
    approver_type: "user",
    user_id: parsed.data.approverProfileId,
    status: "in_progress",
    due_at: dueAt,
  });
  if (stepError) throw new DatabaseError(stepError);

  const notifications = createNotificationService(supabase);
  await notifications.notify({
    organizationId: ctx.organization.id,
    recipientProfileId: parsed.data.approverProfileId,
    type: "approval.created",
    title: "طلب موافقة جديد",
    message: parsed.data.title,
    entityType: "approval_request",
    entityId: request.id,
    priority: "high",
  });

  revalidatePath("/approvals");
  });
}

export async function decideApprovalAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const parsed = decideApprovalSchema.safeParse({
    stepId: formData.get("stepId"),
    officialCode: formData.get("officialCode"),
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("قرار الموافقة غير صالح.", "Invalid approval decision.");
  }

  const permission = parsed.data.officialCode === "D" ? "approval.reject" : "approval.approve";
  authorize(await getAuthContext(), permission);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("submit_approval_decision", {
    p_step_id: parsed.data.stepId,
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
    throw new DatabaseError(error);
  }
  revalidatePath("/approvals");
  revalidatePath("/");
  });
}

export async function uploadDocumentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "document.upload");
  const fileSourceRaw = String(formData.get("fileSource") || "storage");
  const parsed = uploadDocumentSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    projectId: formData.get("projectId") || undefined,
    documentId: formData.get("documentId") || undefined,
    confidentiality: formData.get("confidentiality") || "internal",
    fileSource: fileSourceRaw,
    driveUrl: formData.get("driveUrl") || undefined,
  });
  const file = formData.get("file");
  const wantsStorage = isStorageFileRequired(parsed.success ? parsed.data.fileSource : fileSourceRaw);
  if (!parsed.success || (wantsStorage && (!(file instanceof File) || file.size === 0))) {
    throw new ValidationError("تعذر رفع المستند.", "The document could not be uploaded.");
  }

  const supabase = await createServerSupabaseClient();
  const projectId = parsed.data.projectId || null;
  if (projectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("id, organization_id")
      .eq("id", projectId)
      .maybeSingle<{ id: string; organization_id: string }>();
    assertProjectBelongsToOrganization(project, ctx.organization.id);
  }

  let driveRef: ReturnType<typeof parseGoogleDriveUrl> = null;
  if (parsed.data.fileSource === "google_drive") {
    driveRef = parseGoogleDriveUrl(parsed.data.driveUrl ?? "");
    if (!driveRef) {
      throw new ValidationError("رابط Google Drive غير صالح.", "The Google Drive link is not valid.");
    }
  }

  const storage = new StorageService(supabase);
  let documentId = parsed.data.documentId || "";
  let revision = "A";

  if (documentId) {
    const { data: existing } = await supabase
      .from("documents")
      .select("id, current_revision, organization_id")
      .eq("id", documentId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle<{ id: string; current_revision: string; organization_id: string }>();
    if (!existing) {
      throw new NotFoundError("المستند", "Document");
    }
    revision = nextRevision(existing.current_revision);
  } else {
    const { data: created, error } = await supabase
      .from("documents")
      .insert({
        organization_id: ctx.organization.id,
        project_id: projectId,
        category: parsed.data.category,
        title: parsed.data.title,
        current_revision: "A",
        status: "submitted",
        confidentiality: parsed.data.confidentiality,
        uploaded_by: ctx.userId,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !created) throw new DatabaseError(error);
    documentId = created.id;
  }

  await supabase
    .from("document_versions")
    .update({ is_current: false, is_superseded: true, superseded_at: new Date().toISOString() })
    .eq("document_id", documentId)
    .eq("is_current", true);

  if (parsed.data.fileSource === "google_drive" && driveRef) {
    const { error: versionError } = await supabase.from("document_versions").insert({
      organization_id: ctx.organization.id,
      document_id: documentId,
      revision,
      file_source: "google_drive",
      file_path: null,
      file_name: parsed.data.title,
      mime_type: null,
      size_bytes: null,
      checksum: null,
      uploaded_by: ctx.userId,
      is_current: true,
      is_superseded: false,
      external_provider: "google_drive",
      external_file_id: driveRef.fileId,
      external_url: driveRef.canonicalUrl,
    });
    if (versionError) throw new DatabaseError(versionError);
  } else {
    const uploaded = await storage.upload({
      organizationId: ctx.organization.id,
      projectId,
      documentId,
      revision,
      file: file as File,
    });

    const { error: versionError } = await supabase.from("document_versions").insert({
      organization_id: ctx.organization.id,
      document_id: documentId,
      revision,
      file_source: "storage",
      file_path: uploaded.path,
      file_name: (file as File).name,
      mime_type: (file as File).type,
      size_bytes: (file as File).size,
      checksum: uploaded.checksum,
      uploaded_by: ctx.userId,
      is_current: true,
      is_superseded: false,
    });
    if (versionError) throw new DatabaseError(versionError);
  }

  if (revision !== "A") {
    await supabase
      .from("documents")
      .update({ current_revision: revision, status: "submitted" })
      .eq("id", documentId);
  }

  const audit = new AuditService(supabase);
  await audit.log({
    organizationId: ctx.organization.id,
    action: revision === "A" ? "document.uploaded" : "document.revised",
    entityType: "document",
    entityId: documentId,
    newValues: {
      revision,
      title: parsed.data.title,
      source: parsed.data.fileSource === "google_drive" ? "google_drive" : "storage",
    },
  });

  revalidatePath("/documents");
  revalidatePath(`/documents/${documentId}`);
  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
  }
  });
}

export async function openStorageDocumentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر فتح الملف. حاول مرة أخرى.", async () => {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();
    if (!hasPermission(ctx, "document.read")) {
      throw new ForbiddenError({ permission: "document.read" });
    }
    const documentId = String(formData.get("documentId") ?? "");
    if (!documentId) {
      throw new ValidationError("المستند غير صالح.", "The document is not valid.");
    }
    const supabase = await createServerSupabaseClient();
    const { data: version, error } = await supabase
      .from("document_versions")
      .select("file_source, file_path")
      .eq("document_id", documentId)
      .eq("organization_id", ctx.organization.id)
      .eq("is_current", true)
      .maybeSingle<{ file_source: string; file_path: string | null }>();
    if (error || !version || version.file_source !== "storage" || !version.file_path) {
      throw new ValidationError("ملف التخزين غير متاح.", "The stored file is not available.");
    }
    const storage = new StorageService(supabase);
    const signed = await storage.signedUrl(version.file_path, 120);
    redirect(signed);
  });
}

export async function markNotificationReadAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "notification.read");
  const id = String(formData.get("id") ?? "");
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("recipient_profile_id", ctx.userId);
  if (error) throw new DatabaseError(error);
  revalidatePath("/notifications");
  revalidatePath("/");
  });
}

export async function createUserAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "user.create");
  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    full_name_ar: formData.get("full_name_ar"),
    full_name_en: formData.get("full_name_en"),
    job_title_ar: formData.get("job_title_ar") || undefined,
    job_title_en: formData.get("job_title_en") || undefined,
    department_id: formData.get("department_id") || undefined,
    role_id: formData.get("role_id") || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات المستخدم غير مكتملة.", "User data is incomplete.");
  }

  const admin = createAdminSupabaseClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    email_confirm: true,
    password: crypto.randomUUID() + "A1!",
    user_metadata: {
      full_name_ar: parsed.data.full_name_ar,
      full_name_en: parsed.data.full_name_en,
      locale: "ar",
    },
  });
  if (error || !created.user) {
    throw new DatabaseError(error);
  }

  await admin.from("organization_members").upsert({
    organization_id: ctx.organization.id,
    profile_id: created.user.id,
    status: "active",
  });

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .insert({
      organization_id: ctx.organization.id,
      profile_id: created.user.id,
      job_title_ar: parsed.data.job_title_ar ?? null,
      job_title_en: parsed.data.job_title_en ?? null,
      employment_status: "active",
      is_active: true,
    })
    .select("id")
    .single<{ id: string }>();
  if (employeeError) throw new DatabaseError(employeeError);

  if (parsed.data.department_id && employee) {
    await admin.from("employee_departments").insert({
      organization_id: ctx.organization.id,
      employee_id: employee.id,
      department_id: parsed.data.department_id,
      is_primary: true,
    });
  }

  if (parsed.data.role_id) {
    await admin.from("user_roles").insert({
      organization_id: ctx.organization.id,
      profile_id: created.user.id,
      role_id: parsed.data.role_id,
      scope_type: "organization",
      granted_by: ctx.userId,
    });
  }

  const supabase = await createServerSupabaseClient();
  const audit = new AuditService(supabase);
  await audit.log({
    organizationId: ctx.organization.id,
    action: "employee.created",
    entityType: "employee",
    entityId: employee?.id ?? created.user.id,
    newValues: { email: parsed.data.email },
  });

  revalidatePath("/employees");
  revalidatePath("/settings");
  });
}

export async function assignRoleAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "role.assign");
  const parsed = assignRoleSchema.safeParse({
    profileId: formData.get("profileId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) {
    throw new ValidationError("تعذر تعيين الدور.", "The role could not be assigned.");
  }

  const supabase = await createServerSupabaseClient();
  const { data: role } = await supabase
    .from("roles")
    .select("code, is_external")
    .eq("id", parsed.data.roleId)
    .maybeSingle<{ code: string; is_external: boolean }>();

  if (role?.is_external) {
    throw new ValidationError(
      "لا يمكن منح الأدوار الخارجية صلاحية داخلية.",
      "External roles cannot be granted internal access.",
    );
  }
  if (isPrivilegedRoleCode(role?.code) && !ctx.profile.is_platform_admin) {
    throw new ValidationError(
      "لا يمكن منح هذا الدور من مسار الموارد البشرية.",
      "That role cannot be assigned from the HR path.",
    );
  }

  const { error } = await supabase.from("user_roles").insert({
    organization_id: ctx.organization.id,
    profile_id: parsed.data.profileId,
    role_id: parsed.data.roleId,
    scope_type: "organization",
    granted_by: ctx.userId,
  });
  if (error) throw new DatabaseError(error);

  const audit = new AuditService(supabase);
  await audit.log({
    organizationId: ctx.organization.id,
    action: "user.role.changed",
    entityType: "profile",
    entityId: parsed.data.profileId,
    newValues: { roleId: parsed.data.roleId },
  });
  revalidatePath("/settings");
  });
}

export async function assignDepartmentAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "employee.manage");
  const parsed = assignDepartmentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    departmentId: formData.get("departmentId"),
  });
  if (!parsed.success) {
    throw new ValidationError("تعذر تعيين الإدارة.", "The department could not be assigned.");
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("employee_departments").upsert({
    organization_id: ctx.organization.id,
    employee_id: parsed.data.employeeId,
    department_id: parsed.data.departmentId,
    is_primary: true,
  });
  if (error) throw new DatabaseError(error);
  revalidatePath("/employees");
  });
}

export async function setUserActiveAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "user.disable");
  const parsed = setUserActiveSchema.safeParse({
    profileId: formData.get("profileId"),
    isActive: formData.get("isActive") === "true",
  });
  if (!parsed.success) {
    throw new ValidationError("تعذر تحديث حالة المستخدم.", "The user status could not be updated.");
  }
  if (parsed.data.profileId === ctx.userId) {
    throw new ValidationError("لا يمكنك إيقاف حسابك الحالي.", "You cannot disable your own account.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.profileId);
  if (error) throw new DatabaseError(error);

  await supabase
    .from("organization_members")
    .update({ status: parsed.data.isActive ? "active" : "suspended" })
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", parsed.data.profileId);

  await supabase
    .from("employees")
    .update({
      is_active: parsed.data.isActive,
      employment_status: parsed.data.isActive ? "active" : "terminated",
      terminated_at: parsed.data.isActive ? null : new Date().toISOString(),
    })
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", parsed.data.profileId);

  const audit = new AuditService(supabase);
  await audit.log({
    organizationId: ctx.organization.id,
    action: parsed.data.isActive ? "user.activated" : "user.deactivated",
    entityType: "profile",
    entityId: parsed.data.profileId,
  });
  revalidatePath("/settings");
  revalidatePath("/employees");
  });
}

export async function bootstrapAdminIfNeeded(email: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.rpc("bootstrap_platform_admin", { p_email: email });
  if (error && !error.message.includes("CONFLICT")) {
    throw new DatabaseError(error);
  }
}
