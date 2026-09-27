"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/server/context";
import { authorize, hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DatabaseError, ValidationError } from "@/lib/errors";
import { runFormAction, type FormActionState } from "@/server/forms/form-state";
import { AuditService } from "@/server/services/audit.service";
import { createNotificationService } from "@/server/services/notification.service";
import {
  adjustLeaveBalanceSchema,
  cancelLeaveRequestSchema,
  decideLeaveRequestSchema,
  submitLeaveRequestSchema,
  upsertLeaveTypeSchema,
} from "@/modules/leave/schemas";
import type { LeaveRequest } from "@/types/models";

function formBool(value: FormDataEntryValue | null, fallback = false): boolean {
  if (value == null || value === "") return fallback;
  return value === "true" || value === "on" || value === "1";
}

async function listHrLeaveRecipientIds(
  organizationId: string,
  excludeProfileId?: string | null,
): Promise<string[]> {
  try {
    const admin = createAdminSupabaseClient();
    const { data: roles } = await admin
      .from("roles")
      .select("id")
      .in("code", ["hr_manager", "hr_officer"])
      .is("organization_id", null);
    const roleIds = (roles ?? []).map((r) => r.id as string);
    if (roleIds.length === 0) return [];

    const { data: urs } = await admin
      .from("user_roles")
      .select("profile_id")
      .eq("organization_id", organizationId)
      .in("role_id", roleIds);

    const ids = new Set<string>();
    for (const row of urs ?? []) {
      const id = row.profile_id as string;
      if (id && id !== excludeProfileId) ids.add(id);
    }
    return [...ids];
  } catch {
    return [];
  }
}

async function notifyProfiles(
  supabase: SupabaseClient,
  organizationId: string,
  profileIds: string[],
  payload: {
    type: string;
    title: string;
    message: string;
    entityId: string;
    priority?: "low" | "normal" | "high";
  },
) {
  if (profileIds.length === 0) return;
  const notify = createNotificationService(supabase);
  for (const recipientProfileId of profileIds) {
    await notify.notify({
      organizationId,
      recipientProfileId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      entityType: "leave_request",
      entityId: payload.entityId,
      priority: payload.priority ?? "normal",
    });
  }
}

export async function submitLeaveRequestAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تقديم طلب الإجازة. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "leave.request");
  if (!ctx.employee) {
    throw new ValidationError("لا يوجد سجل موظف مرتبط بحسابك.", "No employee record linked to your account.");
  }

  const parsed = submitLeaveRequestSchema.safeParse({
    leaveTypeId: formData.get("leaveTypeId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: String(formData.get("reason") ?? "").trim() || undefined,
    attachmentDocumentId: String(formData.get("attachmentDocumentId") ?? "").trim() || undefined,
    requestId: String(formData.get("requestId") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات طلب الإجازة غير مكتملة.", "Leave request data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("submit_leave_request", {
    p_leave_type_id: parsed.data.leaveTypeId,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_reason: parsed.data.reason ?? null,
    p_attachment_document_id: parsed.data.attachmentDocumentId ?? null,
    p_request_id: parsed.data.requestId ?? null,
  });
  if (error) throw new DatabaseError(error);

  const req = data as LeaveRequest;
  const notify = createNotificationService(supabase);

  if (req.manager_profile_id && req.approval_stage === "manager") {
    await notify.notify({
      organizationId: ctx.organization.id,
      recipientProfileId: req.manager_profile_id,
      type: "leave_request.submitted",
      title: "طلب إجازة بانتظار اعتمادك",
      message: "تم تقديم طلب إجازة جديد من أحد أعضاء فريقك.",
      entityType: "leave_request",
      entityId: req.id,
      priority: "high",
    });
  } else if (req.approval_stage === "hr") {
    const hrIds = await listHrLeaveRecipientIds(ctx.organization.id, ctx.profile.id);
    await notifyProfiles(supabase, ctx.organization.id, hrIds, {
      type: "leave_request.submitted",
      title: "طلب إجازة بانتظار اعتماد الموارد البشرية",
      message: "تم تقديم طلب إجازة يتطلب اعتماد الموارد البشرية.",
      entityId: req.id,
      priority: "high",
    });
  }

  revalidatePath("/leave");
  revalidatePath("/leave/team");
  revalidatePath("/hr/leave");
  redirect(`/leave/${req.id}`);
  });
}

export async function decideLeaveRequestAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر اعتماد طلب الإجازة. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ValidationError("يجب تسجيل الدخول.", "You must sign in.");

  const parsed = decideLeaveRequestSchema.safeParse({
    requestId: formData.get("requestId"),
    decision: formData.get("decision"),
    comment: String(formData.get("comment") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("قرار غير صالح.", "Invalid decision.");
  }

  const canManager = hasPermission(ctx, "leave.approve_manager");
  const canHr = hasPermission(ctx, "leave.manage");
  if (!canManager && !canHr) {
    throw new ValidationError("ليست لديك صلاحية الاعتماد.", "You cannot approve leave.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("decide_leave_request", {
    p_request_id: parsed.data.requestId,
    p_decision: parsed.data.decision,
    p_comment: parsed.data.comment ?? null,
  });
  if (error) throw new DatabaseError(error);

  const req = data as LeaveRequest;
  // Resolve employee recipient via service role — managers may lack employees SELECT RLS
  // for direct reports, which would silently skip all post-decision notifications.
  const admin = createAdminSupabaseClient();
  const { data: emp } = await admin
    .from("employees")
    .select("profile_id")
    .eq("id", req.employee_id)
    .maybeSingle();

  if (emp?.profile_id) {
    const notify = createNotificationService(supabase);
    const approvedFinal = req.status === "approved";
    const rejected = req.status === "rejected";
    if (approvedFinal || rejected) {
      await notify.notify({
        organizationId: ctx.organization.id,
        recipientProfileId: emp.profile_id,
        type: rejected ? "leave_request.rejected" : "leave_request.approved",
        title: rejected ? "تم رفض طلب الإجازة" : "تم اعتماد طلب الإجازة",
        message: rejected ? "تم رفض طلب الإجازة الخاص بك." : "تم اعتماد طلب الإجازة الخاص بك.",
        entityType: "leave_request",
        entityId: req.id,
      });
    } else if (req.approval_stage === "hr" && parsed.data.decision === "approved") {
      await notify.notify({
        organizationId: ctx.organization.id,
        recipientProfileId: emp.profile_id,
        type: "leave_request.manager_approved",
        title: "اعتمد المدير طلب إجازتك",
        message: "تم اعتماد المدير المباشر؛ الطلب بانتظار الموارد البشرية.",
        entityType: "leave_request",
        entityId: req.id,
      });
      const hrIds = await listHrLeaveRecipientIds(ctx.organization.id, ctx.profile.id);
      await notifyProfiles(supabase, ctx.organization.id, hrIds, {
        type: "leave_request.manager_approved",
        title: "طلب إجازة بانتظار اعتماد الموارد البشرية",
        message: "اعتمد المدير المباشر طلباً؛ يلزم اعتماد الموارد البشرية.",
        entityId: req.id,
        priority: "high",
      });
    }
  }

  revalidatePath("/leave");
  revalidatePath(`/leave/${req.id}`);
  revalidatePath("/leave/team");
  revalidatePath("/hr/leave");
  });
}

export async function cancelLeaveRequestAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر إلغاء طلب الإجازة. حاول مرة أخرى.", async () => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ValidationError("يجب تسجيل الدخول.", "You must sign in.");

  const parsed = cancelLeaveRequestSchema.safeParse({
    requestId: formData.get("requestId"),
  });
  if (!parsed.success) {
    throw new ValidationError("طلب غير صالح.", "Invalid request.");
  }

  if (!hasPermission(ctx, "leave.cancel_self") && !hasPermission(ctx, "leave.manage")) {
    throw new ValidationError("ليست لديك صلاحية الإلغاء.", "You cannot cancel leave.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_leave_request", {
    p_request_id: parsed.data.requestId,
  });
  if (error) throw new DatabaseError(error);

  const req = data as LeaveRequest;
  const admin = createAdminSupabaseClient();
  const { data: emp } = await admin
    .from("employees")
    .select("profile_id")
    .eq("id", req.employee_id)
    .maybeSingle();

  const notify = createNotificationService(supabase);
  if (emp?.profile_id && emp.profile_id !== ctx.profile.id) {
    await notify.notify({
      organizationId: ctx.organization.id,
      recipientProfileId: emp.profile_id,
      type: "leave_request.cancelled",
      title: "تم إلغاء طلب الإجازة",
      message: "تم إلغاء طلب الإجازة الخاص بك.",
      entityType: "leave_request",
      entityId: req.id,
    });
  }
  if (req.manager_profile_id && req.manager_profile_id !== ctx.profile.id) {
    await notify.notify({
      organizationId: ctx.organization.id,
      recipientProfileId: req.manager_profile_id,
      type: "leave_request.cancelled",
      title: "إلغاء طلب إجازة",
      message: "تم إلغاء طلب إجازة كان بانتظارك أو ضمن فريقك.",
      entityType: "leave_request",
      entityId: req.id,
    });
  }

  revalidatePath("/leave");
  revalidatePath(`/leave/${req.id}`);
  revalidatePath("/hr/leave");
  });
}

export async function adjustLeaveBalanceAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر تعديل رصيد الإجازة. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "leave.adjust_balance");
  const parsed = adjustLeaveBalanceSchema.safeParse({
    employeeId: formData.get("employeeId"),
    leaveTypeId: formData.get("leaveTypeId"),
    year: formData.get("year"),
    adjustmentDays: formData.get("adjustmentDays"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات التعديل غير مكتملة.", "Adjustment data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("adjust_leave_balance", {
    p_employee_id: parsed.data.employeeId,
    p_leave_type_id: parsed.data.leaveTypeId,
    p_year: parsed.data.year,
    p_adjustment_days: parsed.data.adjustmentDays,
    p_reason: parsed.data.reason,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/hr/leave/balances");
  revalidatePath("/leave");
  void ctx;
  });
}

export async function upsertLeaveTypeAction(
  _prev: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  return runFormAction("تعذر حفظ نوع الإجازة. حاول مرة أخرى.", async () => {
  const ctx = authorize(await getAuthContext(), "leave.manage");
  const maxConsecRaw = String(formData.get("maximum_consecutive_days") ?? "").trim();
  const maxCarryRaw = String(formData.get("maximum_carry_forward_days") ?? "").trim();

  const parsed = upsertLeaveTypeSchema.safeParse({
    id: String(formData.get("id") ?? "").trim() || undefined,
    code: formData.get("code"),
    name_ar: formData.get("name_ar"),
    name_en: formData.get("name_en"),
    description_ar: String(formData.get("description_ar") ?? "").trim() || undefined,
    description_en: String(formData.get("description_en") ?? "").trim() || undefined,
    is_paid: formBool(formData.get("is_paid"), true),
    annual_entitlement_days: formData.get("annual_entitlement_days") || 0,
    requires_attachment: formBool(formData.get("requires_attachment"), false),
    minimum_notice_days: formData.get("minimum_notice_days") || 0,
    maximum_consecutive_days: maxConsecRaw ? Number(maxConsecRaw) : null,
    allow_carry_forward: formBool(formData.get("allow_carry_forward"), false),
    maximum_carry_forward_days: maxCarryRaw ? Number(maxCarryRaw) : null,
    allow_negative_balance: formBool(formData.get("allow_negative_balance"), false),
    is_active: formBool(formData.get("is_active"), true),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات نوع الإجازة غير مكتملة.", "Leave type data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const row = {
    organization_id: ctx.organization.id,
    code: parsed.data.code.toUpperCase(),
    name_ar: parsed.data.name_ar,
    name_en: parsed.data.name_en,
    description_ar: parsed.data.description_ar ?? null,
    description_en: parsed.data.description_en ?? null,
    is_paid: parsed.data.is_paid,
    annual_entitlement_days: parsed.data.annual_entitlement_days,
    requires_attachment: parsed.data.requires_attachment,
    minimum_notice_days: parsed.data.minimum_notice_days,
    maximum_consecutive_days: parsed.data.maximum_consecutive_days ?? null,
    allow_carry_forward: parsed.data.allow_carry_forward,
    maximum_carry_forward_days: parsed.data.maximum_carry_forward_days ?? null,
    allow_negative_balance: parsed.data.allow_negative_balance,
    is_active: parsed.data.is_active,
  };

  const audit = new AuditService(supabase);
  if (parsed.data.id) {
    const { error } = await supabase.from("leave_types").update(row).eq("id", parsed.data.id).eq("organization_id", ctx.organization.id);
    if (error) throw new DatabaseError(error);
    await audit.log({
      organizationId: ctx.organization.id,
      action: "leave_type.updated",
      entityType: "leave_type",
      entityId: parsed.data.id,
      newValues: { code: row.code, is_active: row.is_active },
    });
  } else {
    const { data, error } = await supabase.from("leave_types").insert(row).select("id").single();
    if (error) throw new DatabaseError(error);
    await audit.log({
      organizationId: ctx.organization.id,
      action: "leave_type.created",
      entityType: "leave_type",
      entityId: data.id,
      newValues: { code: row.code },
    });
  }

  revalidatePath("/hr/leave/types");
  revalidatePath("/leave/new");
  });
}
