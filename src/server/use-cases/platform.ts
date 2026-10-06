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
  OPERATIONAL_ORPHAN_CLEANUP,
  OPERATIONAL_REVISION_RPC,
  nextOperationalRevision,
  throwOperationalRevisionRpcError,
} from "@/modules/documents/operational-revision";
import {
  completeWorkflowStepSchema,
  createApprovalSchema,
  decideApprovalSchema,
  updateWorkflowStepDeadlineSchema,
} from "@/modules/approvals/schemas";
import {
  formatRiyadhDateTimeAr,
  riyadhLocalDateTimeToUtcIso,
  uniqueProfileIds,
  validateDeadlineChange,
} from "@/modules/projects/deadline";
import { ConflictError, DatabaseError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { mapWorkflowRpcError } from "@/modules/projects/approval-workflow-gate";
import {
  mapStartWorkflowRpcError,
  parseStartWorkflowForm,
  startWorkflowValidationMessage,
} from "@/modules/projects/start-workflow-input";
import {
  WORKFLOW_ASSIGN_PERMISSION,
  assignWorkflowStepResponsibleSchema,
  eligibleResponsibleRejectMessage,
  workflowStepNotificationRecipients,
} from "@/modules/projects/workflow-responsibility";
import { logger } from "@/lib/logger";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { generateCorrelationId } from "@/lib/utils";
import { assignmentRejectReason, canUnassignUserRole } from "@/lib/rbac/custom-roles";
import { unassignRoleSchema } from "@/modules/roles/schemas";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission, requireUser } from "@/server/policies/authorize";
import { AuditService } from "@/server/services/audit.service";
import { EventService } from "@/server/services/event.service";
import { createNotificationService } from "@/server/services/notification.service";
import { notifyWorkflowReadyAssignees as dispatchWorkflowReadyAssignees } from "@/server/services/notification-delivery-worker";
import { StorageService } from "@/server/services/storage.service";
import { parseGoogleDriveUrl } from "@/modules/documents/google-drive-url";
import { isStorageFileRequired } from "@/modules/documents/schemas";
import { assertProjectBelongsToOrganization } from "@/modules/documents/project-scope";
import type { Project } from "@/types/models";

function revalidateProjectWorkflow(projectId: string | null) {
  revalidatePath("/approvals");
  revalidatePath("/");
  if (projectId) {
    revalidatePath(`/projects/${projectId}`, "page");
    revalidatePath("/projects");
  }
}

async function activeRoleHolderIds(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: string,
  roleId: string | null,
): Promise<string[]> {
  if (!roleId) return [];
  const { data: grants } = await supabase
    .from("user_roles")
    .select("profile_id")
    .eq("organization_id", organizationId)
    .eq("role_id", roleId);
  const ids = uniqueProfileIds((grants ?? []).map((row) => row.profile_id as string));
  if (ids.length === 0) return [];
  const { data: members } = await supabase
    .from("organization_members")
    .select("profile_id, status")
    .eq("organization_id", organizationId)
    .in("profile_id", ids)
    .eq("status", "active");
  return uniqueProfileIds((members ?? []).map((row) => row.profile_id as string));
}

async function notifyWorkflowReadyAssignees(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  organizationId: string;
  instanceId: string;
  projectId: string | null;
}) {
  await dispatchWorkflowReadyAssignees({
    supabase: input.supabase,
    organizationId: input.organizationId,
    instanceId: input.instanceId,
    projectId: input.projectId,
    roleHolderIds: (roleId) => activeRoleHolderIds(input.supabase, input.organizationId, roleId),
  });
}

async function notifyWorkflowCompleted(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  organizationId: string;
  instanceId: string;
  projectId: string | null;
}) {
  const { data: instance } = await input.supabase
    .from("workflow_instances")
    .select("status, entity_type, entity_id, started_by")
    .eq("id", input.instanceId)
    .maybeSingle<{ status: string; entity_type: string; entity_id: string; started_by: string }>();
  if (instance?.status !== "completed") return;
  const projectId = input.projectId ?? (instance.entity_type === "project" ? instance.entity_id : null);
  let managerId: string | null = null;
  if (projectId) {
    const { data: project } = await input.supabase
      .from("projects")
      .select("project_manager_id")
      .eq("id", projectId)
      .maybeSingle<{ project_manager_id: string | null }>();
    managerId = project?.project_manager_id ?? null;
  }
  const recipient = managerId ?? instance.started_by;
  if (!recipient) return;
  const notifications = createNotificationService(input.supabase);
  await notifications.notify({
    organizationId: input.organizationId,
    recipientProfileId: recipient,
    type: "workflow.completed",
    title: "اكتمل مسار عمل المشروع",
    message: "اكتملت جميع مراحل مسار العمل.",
    entityType: projectId ? "project" : "workflow_instance",
    entityId: projectId ?? input.instanceId,
    href: projectId ? `/projects/${projectId}?tab=stages` : null,
    priority: "high",
    dedupKey: `workflow.completed:${input.instanceId}`,
  });
}

function throwMappedWorkflowRpc(error: { message?: string }): never {
  const mapped = mapWorkflowRpcError(error.message ?? "");
  if (mapped.kind === "CONFLICT") {
    throw new ConflictError(mapped.ar, mapped.en);
  }
  if (mapped.kind === "FORBIDDEN") {
    throw new ForbiddenError();
  }
  if (mapped.kind === "NOT_FOUND") {
    throw new NotFoundError("العنصر", "Item");
  }
  if (mapped.kind === "VALIDATION") {
    throw new ValidationError(mapped.ar, mapped.en);
  }
  throw new DatabaseError(error);
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

export async function completeProjectStageAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إكمال المرحلة. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "project.update");
    const stageId = String(formData.get("stageId") ?? "");
    const projectId = String(formData.get("projectId") ?? "");
    if (!stageId) {
      throw new ValidationError("المرحلة غير محددة.", "Stage id is required.");
    }

    const supabase = await createServerSupabaseClient();
    const { data: stage } = await supabase
      .from("project_stages")
      .select("id, project_id, organization_id")
      .eq("id", stageId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle<{ id: string; project_id: string; organization_id: string }>();
    if (!stage) {
      throw new NotFoundError("المرحلة", "Stage");
    }

    const { error } = await supabase.rpc("complete_project_stage", { p_stage_id: stageId });
    if (error) throwMappedWorkflowRpc(error);

    const events = new EventService(supabase);
    await events.publish({
      type: "project.stage.completed",
      organizationId: ctx.organization.id,
      actorId: ctx.userId,
      entityType: "project_stage",
      entityId: stageId,
      payload: { projectId: stage.project_id },
      correlationId: generateCorrelationId(),
      occurredAt: new Date().toISOString(),
    });

    revalidateProjectWorkflow(projectId || stage.project_id);
  });
}

export async function startWorkflowAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "workflow.start");
  const parsed = parseStartWorkflowForm({
    definitionId: formData.get("definitionId"),
    entityType: formData.get("entityType"),
    entityId: formData.get("entityId"),
  });
  if (!parsed.ok) {
    logger.warn("start_workflow form validation failed", { operation: "start_workflow", field: parsed.field });
    const copy = startWorkflowValidationMessage(parsed.field);
    throw new ValidationError(copy.ar, copy.en);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("start_workflow", {
    p_organization_id: ctx.organization.id,
    p_definition_id: parsed.data.definitionId,
    p_entity_type: parsed.data.entityType,
    p_entity_id: parsed.data.entityId,
  });
  if (error) {
    logger.warn("start_workflow rpc failed", {
      operation: "start_workflow",
      code: "code" in error ? error.code : undefined,
      errorMessage: error.message,
    });
    const mapped = mapStartWorkflowRpcError(error.message);
    if (mapped.kind === "CONFLICT") {
      throw new ConflictError(mapped.ar, mapped.en);
    }
    if (mapped.kind === "DATABASE") {
      throw new DatabaseError(error);
    }
    throw new ValidationError(mapped.ar, mapped.en);
  }

  const { data: instance } = await supabase
    .from("workflow_instances")
    .select("id")
    .eq("organization_id", ctx.organization.id)
    .eq("entity_type", parsed.data.entityType)
    .eq("entity_id", parsed.data.entityId)
    .in("status", ["pending", "in_progress"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (instance) {
    await notifyWorkflowReadyAssignees({
      supabase,
      organizationId: ctx.organization.id,
      instanceId: instance.id,
      projectId: parsed.data.entityType === "project" ? parsed.data.entityId : null,
    });
  }

  revalidateProjectWorkflow(parsed.data.entityType === "project" ? parsed.data.entityId : null);
  });
}

export async function updateWorkflowStepDeadlineAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تحديث موعد المرحلة.", async () => {
    const ctx = authorize(await getAuthContext(), "workflow.manage");
    const parsed = updateWorkflowStepDeadlineSchema.safeParse({
      instanceStepId: formData.get("instanceStepId"),
      dueAtLocal: formData.get("dueAtLocal"),
    });
    if (!parsed.success) {
      throw new ValidationError("موعد المرحلة غير صالح.", "The stage deadline is invalid.");
    }
    const dueAt = riyadhLocalDateTimeToUtcIso(parsed.data.dueAtLocal);
    if (!dueAt) {
      throw new ValidationError("موعد المرحلة غير صالح.", "The stage deadline is invalid.");
    }
    const supabase = await createServerSupabaseClient();
    const { data: current } = await supabase
      .from("workflow_instance_steps")
      .select("id, organization_id, instance_id, status, started_at, due_at, assigned_user_id, assigned_role_id, responsible_user_id, workflow_steps(name_ar)")
      .eq("id", parsed.data.instanceStepId)
      .maybeSingle<{
        id: string;
        organization_id: string;
        instance_id: string;
        status: string;
        started_at: string | null;
        due_at: string | null;
        assigned_user_id: string | null;
        assigned_role_id: string | null;
        responsible_user_id: string | null;
        workflow_steps: { name_ar: string } | { name_ar: string }[] | null;
      }>();
    if (!current || current.organization_id !== ctx.organization.id) {
      throw new NotFoundError("المرحلة", "Stage");
    }
    const validity = validateDeadlineChange({
      startedAt: current.started_at,
      currentDueAt: current.due_at,
      nextDueAt: dueAt,
      nowIso: new Date().toISOString(),
    });
    if (validity !== "ok") {
      throw new ValidationError(
        validity === "before_activation"
          ? "لا يمكن تعيين موعد قبل بدء المرحلة."
          : "لا يمكن تعيين موعد في الماضي لهذه المرحلة.",
        "The deadline is not valid for this stage.",
      );
    }
    const { error } = await supabase.rpc("update_workflow_step_deadline", {
      p_instance_step_id: parsed.data.instanceStepId,
      p_due_at: dueAt,
    });
    if (error) throwMappedWorkflowRpc(error);

    const projectIdRaw = String(formData.get("projectId") ?? "");
    const projectId = projectIdRaw.length > 0 ? projectIdRaw : null;
    const nameRel = current.workflow_steps;
    const name = Array.isArray(nameRel) ? nameRel[0]?.name_ar : nameRel?.name_ar;
    const recipients = workflowStepNotificationRecipients({
      responsibleUserId: current.responsible_user_id,
      assignedUserId: current.assigned_user_id,
      roleHolderIds: await activeRoleHolderIds(supabase, current.organization_id, current.assigned_role_id),
    }).filter((id) => id !== ctx.userId);
    const notifications = createNotificationService(supabase);
    const dueLabel = formatRiyadhDateTimeAr(dueAt);
    for (const userId of recipients) {
      await notifications.notify({
        organizationId: current.organization_id,
        recipientProfileId: userId,
        type: "workflow.step.deadline_changed",
        title: name ? `تم تحديث موعد مرحلة «${name}»` : "تم تحديث موعد المرحلة",
        message: `الموعد الجديد: ${dueLabel}`,
        entityType: projectId ? "project" : "workflow_instance_step",
        entityId: projectId ?? current.id,
        href: projectId ? `/projects/${projectId}?tab=stages` : null,
        priority: "normal",
        dedupKey: `workflow.step.deadline_changed:${current.id}:${dueAt}:${userId}`,
      });
    }
    revalidateProjectWorkflow(projectId);
  });
}

export async function assignWorkflowStepResponsibleAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تعيين مسؤول المرحلة.", async () => {
    const ctx = authorize(await getAuthContext(), WORKFLOW_ASSIGN_PERMISSION);
    const parsed = assignWorkflowStepResponsibleSchema.safeParse({
      projectId: formData.get("projectId"),
      workflowStepId: formData.get("workflowStepId"),
      responsibleUserId: formData.get("responsibleUserId"),
    });
    if (!parsed.success) {
      throw new ValidationError("بيانات التعيين غير صالحة.", "Assignment data is invalid.");
    }

    const supabase = await createServerSupabaseClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id, organization_id, project_manager_id")
      .eq("id", parsed.data.projectId)
      .maybeSingle<{ id: string; organization_id: string; project_manager_id: string | null }>();
    if (!project || project.organization_id !== ctx.organization.id) {
      throw new NotFoundError("المشروع", "Project");
    }

    const { error } = await supabase.rpc("assign_workflow_step_responsible", {
      p_project_id: parsed.data.projectId,
      p_workflow_step_id: parsed.data.workflowStepId,
      p_responsible_user_id: parsed.data.responsibleUserId,
    });
    if (error) {
      const mapped = mapStartWorkflowRpcError(error.message);
      if (mapped.kind === "FORBIDDEN") {
        throw new ForbiddenError();
      }
      if (mapped.kind === "CONFLICT") {
        throw new ConflictError("لا يمكن تغيير مسؤول مرحلة مكتملة.", "A completed stage cannot be reassigned.");
      }
      if (mapped.kind === "NOT_FOUND") {
        throw new NotFoundError("المرحلة", "Stage");
      }
      if (mapped.kind === "VALIDATION") {
        throw new ValidationError(
          eligibleResponsibleRejectMessage("not_on_project").ar,
          eligibleResponsibleRejectMessage("not_on_project").en,
        );
      }
      throw new DatabaseError(error);
    }

    const { data: liveInstance } = await supabase
      .from("workflow_instances")
      .select("id")
      .eq("organization_id", ctx.organization.id)
      .eq("entity_type", "project")
      .eq("entity_id", parsed.data.projectId)
      .in("status", ["pending", "in_progress"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    const { data: liveStep } = liveInstance
      ? await supabase
          .from("workflow_instance_steps")
          .select("id, status, assigned_user_id, assigned_role_id, responsible_user_id, workflow_steps(name_ar)")
          .eq("instance_id", liveInstance.id)
          .eq("step_id", parsed.data.workflowStepId)
          .in("status", ["ready", "in_progress"])
          .maybeSingle<{
            id: string;
            status: string;
            assigned_user_id: string | null;
            assigned_role_id: string | null;
            responsible_user_id: string | null;
            workflow_steps: { name_ar: string } | { name_ar: string }[] | null;
          }>()
      : { data: null };

    if (liveStep) {
      const stepRel = liveStep.workflow_steps;
      const name = Array.isArray(stepRel) ? stepRel[0]?.name_ar : stepRel?.name_ar;
      const notifications = createNotificationService(supabase);
      await notifications.notify({
        organizationId: ctx.organization.id,
        recipientProfileId: parsed.data.responsibleUserId,
        type: "workflow.step.activated",
        title: "تم إسناد مرحلة إليك",
        message: name ? `المرحلة: ${name}` : "تم تعيينك مسؤولاً عن مرحلة جاهزة.",
        entityType: "project",
        entityId: parsed.data.projectId,
        href: `/projects/${parsed.data.projectId}?tab=stages`,
        priority: "normal",
        dedupKey: `workflow.step.activated:${liveStep.id}:${parsed.data.responsibleUserId}`,
      });
    }

    revalidateProjectWorkflow(parsed.data.projectId);
  });
}

export async function completeWorkflowStepAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إتمام العملية. حاول مرة أخرى.", async () => {
  requireUser(await getAuthContext());
  const parsed = completeWorkflowStepSchema.safeParse({
    instanceStepId: formData.get("instanceStepId"),
    outcome: formData.get("outcome"),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات خطوة مسار العمل غير صحيحة.", "Invalid workflow step data.");
  }
  const projectIdRaw = String(formData.get("projectId") ?? "");
  const projectId = projectIdRaw.length > 0 ? projectIdRaw : null;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("complete_workflow_step", {
    p_instance_step_id: parsed.data.instanceStepId,
    p_outcome: parsed.data.outcome,
  });
  if (error) throwMappedWorkflowRpc(error);

  const { data: step } = await supabase
    .from("workflow_instance_steps")
    .select("instance_id, organization_id")
    .eq("id", parsed.data.instanceStepId)
    .maybeSingle<{ instance_id: string; organization_id: string }>();
  if (step) {
    let resolvedProjectId = projectId;
    if (!resolvedProjectId) {
      const { data: instance } = await supabase
        .from("workflow_instances")
        .select("entity_type, entity_id")
        .eq("id", step.instance_id)
        .maybeSingle<{ entity_type: string; entity_id: string }>();
      if (instance?.entity_type === "project") resolvedProjectId = instance.entity_id;
    }
    await notifyWorkflowReadyAssignees({
      supabase,
      organizationId: step.organization_id,
      instanceId: step.instance_id,
      projectId: resolvedProjectId,
    });
    await notifyWorkflowCompleted({
      supabase,
      organizationId: step.organization_id,
      instanceId: step.instance_id,
      projectId: resolvedProjectId,
    });
    revalidateProjectWorkflow(resolvedProjectId);
  } else {
    revalidateProjectWorkflow(projectId);
  }
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

  const projectIdRaw = String(formData.get("projectId") ?? "");
  const projectId = projectIdRaw.length > 0 ? projectIdRaw : null;
  const supabase = await createServerSupabaseClient();

  const { data: existingOpen } = await supabase
    .from("approval_requests")
    .select("id")
    .eq("organization_id", ctx.organization.id)
    .eq("entity_type", parsed.data.entityType)
    .eq("entity_id", parsed.data.entityId)
    .in("status", ["pending", "in_progress"])
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (existingOpen) {
    throw new ConflictError("يوجد طلب اعتماد مفتوح لهذه المرحلة.", "An open approval already exists.");
  }

  if (parsed.data.entityType === "workflow_instance_step") {
    const { data: wfStep } = await supabase
      .from("workflow_instance_steps")
      .select("id, organization_id, status, instance_id")
      .eq("id", parsed.data.entityId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle<{ id: string; organization_id: string; status: string; instance_id: string }>();
    if (!wfStep) {
      throw new ValidationError("ارتباط الاعتماد بمسار العمل غير صالح.", "The approval is not validly linked to this workflow step.");
    }
    const { data: instance } = await supabase
      .from("workflow_instances")
      .select("id, organization_id, status, entity_type, entity_id")
      .eq("id", wfStep.instance_id)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle<{
        id: string;
        organization_id: string;
        status: string;
        entity_type: string;
        entity_id: string;
      }>();
    if (!instance || instance.status === "completed" || instance.status === "cancelled") {
      throw new ValidationError("ارتباط الاعتماد بمسار العمل غير صالح.", "The approval is not validly linked to this workflow step.");
    }
    if (projectId && (instance.entity_type !== "project" || instance.entity_id !== projectId)) {
      throw new ValidationError("ارتباط الاعتماد بمسار العمل غير صالح.", "The approval is not validly linked to this workflow step.");
    }
    if (!["ready", "in_progress"].includes(wfStep.status)) {
      throw new ValidationError("ارتباط الاعتماد بمسار العمل غير صالح.", "The approval is not validly linked to this workflow step.");
    }
  }

  const { data: member } = await supabase
    .from("organization_members")
    .select("profile_id, status")
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", parsed.data.approverProfileId)
    .maybeSingle<{ profile_id: string; status: string }>();
  if (!member || member.status !== "active") {
    throw new ValidationError("المعتمد المختار غير صالح.", "The selected approver is not eligible.");
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_active")
    .eq("id", parsed.data.approverProfileId)
    .maybeSingle<{ id: string; is_active: boolean }>();
  if (!profile?.is_active) {
    throw new ValidationError("المعتمد المختار غير صالح.", "The selected approver is not eligible.");
  }
  const { data: employees } = await supabase
    .from("employees")
    .select("is_active")
    .eq("organization_id", ctx.organization.id)
    .eq("profile_id", parsed.data.approverProfileId);
  if ((employees ?? []).length > 0 && !(employees ?? []).some((row) => row.is_active === true)) {
    throw new ValidationError("المعتمد المختار غير صالح.", "The selected approver is not eligible.");
  }

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
    href: projectId ? `/projects/${projectId}?tab=stages` : "/approvals",
    dedupKey: `approval.created:${request.id}:${parsed.data.approverProfileId}`,
  });

  revalidateProjectWorkflow(projectId);
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
  const ctx = authorize(await getAuthContext(), permission);

  const projectIdRaw = String(formData.get("projectId") ?? "");
  const projectIdFromForm = projectIdRaw.length > 0 ? projectIdRaw : null;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("submit_approval_decision", {
    p_step_id: parsed.data.stepId,
    p_official_code: parsed.data.officialCode,
    p_comment: parsed.data.comment ?? null,
  });
  if (error) throwMappedWorkflowRpc(error);

  const { data: approvalStep } = await supabase
    .from("approval_steps")
    .select("request_id")
    .eq("id", parsed.data.stepId)
    .maybeSingle<{ request_id: string }>();
  const { data: request } = approvalStep
    ? await supabase
        .from("approval_requests")
        .select("entity_type, entity_id, requested_by")
        .eq("id", approvalStep.request_id)
        .maybeSingle<{ entity_type: string; entity_id: string; requested_by: string | null }>()
    : { data: null };

  let projectId = projectIdFromForm;
  if (!projectId && request?.entity_type === "project") {
    projectId = request.entity_id;
  }
  if (!projectId && request?.entity_type === "workflow_instance_step") {
    const { data: wfStep } = await supabase
      .from("workflow_instance_steps")
      .select("instance_id")
      .eq("id", request.entity_id)
      .maybeSingle<{ instance_id: string }>();
    if (wfStep) {
      const { data: instance } = await supabase
        .from("workflow_instances")
        .select("entity_type, entity_id")
        .eq("id", wfStep.instance_id)
        .maybeSingle<{ entity_type: string; entity_id: string }>();
      if (instance?.entity_type === "project") projectId = instance.entity_id;
    }
  }

  if (request?.entity_type === "workflow_instance_step") {
    const { data: wfStep } = await supabase
      .from("workflow_instance_steps")
      .select("instance_id, organization_id")
      .eq("id", request.entity_id)
      .maybeSingle<{ instance_id: string; organization_id: string }>();
    if (wfStep) {
      await notifyWorkflowReadyAssignees({
        supabase,
        organizationId: wfStep.organization_id,
        instanceId: wfStep.instance_id,
        projectId,
      });
      await notifyWorkflowCompleted({
        supabase,
        organizationId: wfStep.organization_id,
        instanceId: wfStep.instance_id,
        projectId,
      });
    }
  }

  if (request?.requested_by && request.requested_by !== ctx.userId) {
    const notifications = createNotificationService(supabase);
    const decidedTitle =
      parsed.data.officialCode === "C"
        ? "طُلب تعديل على الاعتماد"
        : parsed.data.officialCode === "D"
          ? "رُفض طلب الاعتماد"
          : "تم تسجيل قرار اعتماد";
    await notifications.notify({
      organizationId: ctx.organization.id,
      recipientProfileId: request.requested_by,
      type: "approval.decided",
      title: decidedTitle,
      message: parsed.data.comment || decidedTitle,
      entityType: "approval_request",
      entityId: approvalStep?.request_id ?? parsed.data.stepId,
      href: projectId ? `/projects/${projectId}?tab=stages` : "/approvals",
      priority: parsed.data.officialCode === "D" ? "high" : "normal",
      dedupKey: `approval.decided:${parsed.data.stepId}:${request.requested_by}`,
    });
  }

  revalidateProjectWorkflow(projectId);
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
  let driveMimeType: string | null = null;
  if (parsed.data.fileSource === "google_drive") {
    driveRef = parseGoogleDriveUrl(parsed.data.driveUrl ?? "");
    if (!driveRef) {
      throw new ValidationError("رابط Google Drive غير صالح.", "The Google Drive link is not valid.");
    }
    const rawMime = String(formData.get("driveMimeType") ?? "").trim();
    if (rawMime && rawMime.length <= 180 && /^[a-z0-9.+*-]+\/[a-z0-9.+*-]+$/i.test(rawMime)) {
      driveMimeType = rawMime;
    }
  }

  const storage = new StorageService(supabase);
  let documentId = parsed.data.documentId || "";
  let revision = "A";
  let storageProjectId = projectId;
  let expectedCurrentRevision: string | null = null;

  if (documentId) {
    const { data: existing } = await supabase
      .from("documents")
      .select(
        "id, current_revision, organization_id, project_id, is_register_controlled, archived_at",
      )
      .eq("id", documentId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle<{
        id: string;
        current_revision: string;
        organization_id: string;
        project_id: string | null;
        is_register_controlled: boolean;
        archived_at: string | null;
      }>();
    if (!existing) {
      throw new NotFoundError("المستند", "Document");
    }
    if (existing.is_register_controlled) {
      throw new ValidationError(
        "لا يمكن إضافة إصدار تشغيلي لمستند سجل رسمي.",
        "Register-controlled documents cannot use operational letter revisions.",
      );
    }
    if (existing.archived_at) {
      throw new ValidationError("لا يمكن إضافة إصدار لمستند مؤرشف.", "Archived documents cannot receive a new revision.");
    }
    const next = nextOperationalRevision(existing.current_revision);
    if (!next) {
      throw new ValidationError("تعذر حساب الإصدار التالي.", "The next revision could not be calculated.");
    }
    revision = next;
    expectedCurrentRevision = existing.current_revision;
    storageProjectId = existing.project_id;
    const formExpected = String(formData.get("expectedCurrentRevision") ?? "").trim();
    if (formExpected && formExpected !== existing.current_revision) {
      throw new ConflictError(
        "تم إنشاء إصدار أحدث. حدّث الصفحة ثم أعد المحاولة.",
        "A newer revision already exists. Refresh and try again.",
      );
    }
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

  if (expectedCurrentRevision) {
    let uploadedPath: string | null = null;
    try {
      if (parsed.data.fileSource === "google_drive" && driveRef) {
        const { error: rpcError } = await supabase.rpc(OPERATIONAL_REVISION_RPC, {
          p_document_id: documentId,
          p_expected_current_revision: expectedCurrentRevision,
          p_file_source: "google_drive",
          p_file_name: parsed.data.title,
          p_file_path: null,
          p_mime_type: driveMimeType,
          p_size_bytes: null,
          p_checksum: null,
          p_external_provider: "google_drive",
          p_external_file_id: driveRef.fileId,
          p_external_url: driveRef.canonicalUrl,
        });
        if (rpcError) throwOperationalRevisionRpcError(rpcError.message ?? "");
      } else {
        const uploaded = await storage.upload({
          organizationId: ctx.organization.id,
          projectId: storageProjectId,
          documentId,
          revision,
          file: file as File,
        });
        uploadedPath = uploaded.path;
        const { error: rpcError } = await supabase.rpc(OPERATIONAL_REVISION_RPC, {
          p_document_id: documentId,
          p_expected_current_revision: expectedCurrentRevision,
          p_file_source: "storage",
          p_file_name: (file as File).name,
          p_file_path: uploaded.path,
          p_mime_type: (file as File).type,
          p_size_bytes: (file as File).size,
          p_checksum: uploaded.checksum,
          p_external_provider: null,
          p_external_file_id: null,
          p_external_url: null,
        });
        if (rpcError) throwOperationalRevisionRpcError(rpcError.message ?? "");
      }
    } catch (err) {
      if (uploadedPath && OPERATIONAL_ORPHAN_CLEANUP === "log_only") {
        logger.warn("operational document version orphan storage object", {
          documentId,
          revision,
          cleanup: OPERATIONAL_ORPHAN_CLEANUP,
        });
      }
      throw err;
    }
  } else if (parsed.data.fileSource === "google_drive" && driveRef) {
    const { error: versionError } = await supabase.from("document_versions").insert({
      organization_id: ctx.organization.id,
      document_id: documentId,
      revision,
      file_source: "google_drive",
      file_path: null,
      file_name: parsed.data.title,
      mime_type: driveMimeType,
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

  if (!expectedCurrentRevision) {
    const audit = new AuditService(supabase);
    await audit.log({
      organizationId: ctx.organization.id,
      action: "document.uploaded",
      entityType: "document",
      entityId: documentId,
      newValues: {
        revision,
        title: parsed.data.title,
        source: parsed.data.fileSource === "google_drive" ? "google_drive" : "storage",
      },
    });
  }

  revalidatePath("/documents");
  revalidatePath(`/documents/${documentId}`);
  if (storageProjectId) {
    revalidatePath(`/projects/${storageProjectId}`);
  }
  if (projectId && projectId !== storageProjectId) {
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
    const versionId = String(formData.get("versionId") ?? "").trim();
    if (!documentId) {
      throw new ValidationError("المستند غير صالح.", "The document is not valid.");
    }
    const supabase = await createServerSupabaseClient();
    let query = supabase
      .from("document_versions")
      .select("file_source, file_path")
      .eq("document_id", documentId)
      .eq("organization_id", ctx.organization.id);
    if (versionId) {
      query = query.eq("id", versionId);
    } else {
      query = query.eq("is_current", true);
    }
    const { data: version, error } = await query.maybeSingle<{ file_source: string; file_path: string | null }>();
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
    .select("code, is_external, is_system, is_active, organization_id")
    .eq("id", parsed.data.roleId)
    .maybeSingle<{
      code: string;
      is_external: boolean;
      is_system: boolean;
      is_active: boolean;
      organization_id: string | null;
    }>();

  const reject = assignmentRejectReason({
    role,
    organizationId: ctx.organization.id,
    allowPrivileged: ctx.profile.is_platform_admin,
  });
  if (reject === "missing") {
    throw new ValidationError("الدور غير موجود.", "The role was not found.");
  }
  if (reject === "external") {
    throw new ValidationError(
      "لا يمكن منح الأدوار الخارجية صلاحية داخلية.",
      "External roles cannot be granted internal access.",
    );
  }
  if (reject === "privileged") {
    throw new ValidationError(
      "لا يمكن منح هذا الدور من مسار الموارد البشرية.",
      "That role cannot be assigned from the HR path.",
    );
  }
  if (reject === "inactive") {
    throw new ValidationError("لا يمكن تعيين دور موقوف.", "Inactive roles cannot be assigned.");
  }
  if (reject === "cross_org") {
    throw new ValidationError("لا يمكن تعيين دور من منشأة أخرى.", "Roles cannot be assigned across organizations.");
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
    action: "role.assigned",
    entityType: "profile",
    entityId: parsed.data.profileId,
    newValues: { roleId: parsed.data.roleId },
  });
  revalidatePath("/settings");
  revalidatePath("/settings/roles");
  revalidatePath("/employees");
  });
}

export async function unassignRoleAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إلغاء الدور. حاول مرة أخرى.", async () => {
    const ctx = authorize(await getAuthContext(), "role.assign");
    const parsed = unassignRoleSchema.safeParse({
      profileId: formData.get("profileId"),
      userRoleId: formData.get("userRoleId"),
    });
    if (!parsed.success) {
      throw new ValidationError("تعذر إلغاء الدور.", "The role could not be unassigned.");
    }

    const supabase = await createServerSupabaseClient();
    const { data: grant, error: grantError } = await supabase
      .from("user_roles")
      .select("id, profile_id, role_id, organization_id, roles(code, is_system)")
      .eq("id", parsed.data.userRoleId)
      .eq("organization_id", ctx.organization.id)
      .eq("profile_id", parsed.data.profileId)
      .maybeSingle<{
        id: string;
        profile_id: string;
        role_id: string;
        organization_id: string;
        roles: { code: string; is_system: boolean } | { code: string; is_system: boolean }[] | null;
      }>();
    if (grantError) throw new DatabaseError(grantError);
    if (!grant) {
      throw new ValidationError("التعيين غير موجود.", "The role assignment was not found.");
    }
    const role = Array.isArray(grant.roles) ? grant.roles[0] : grant.roles;
    const { count, error: countError } = await supabase
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.organization.id)
      .eq("profile_id", parsed.data.profileId);
    if (countError) throw new DatabaseError(countError);
    const allowed = canUnassignUserRole({
      actorIsPlatformAdmin: ctx.profile.is_platform_admin,
      targetRoleCode: role?.code,
      remainingRoleCount: count ?? 0,
    });
    if (!allowed.ok && allowed.reason === "last_role") {
      throw new ValidationError("لا يمكن إزالة آخر دور عن المستخدم.", "The last role cannot be removed.");
    }
    if (!allowed.ok && allowed.reason === "privileged") {
      throw new ValidationError(
        "لا يمكن إلغاء أدوار الإدارة المحمية من هذا المسار.",
        "Protected management roles cannot be unassigned here.",
      );
    }

    const { error } = await supabase.from("user_roles").delete().eq("id", grant.id).eq("organization_id", ctx.organization.id);
    if (error) throw new DatabaseError(error);

    await new AuditService(supabase).log({
      organizationId: ctx.organization.id,
      action: "role.unassigned",
      entityType: "profile",
      entityId: parsed.data.profileId,
      previousValues: { roleId: grant.role_id, code: role?.code },
    });
    revalidatePath("/settings");
    revalidatePath("/settings/roles");
    revalidatePath("/employees");
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
