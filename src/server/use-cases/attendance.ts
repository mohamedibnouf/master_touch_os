"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DatabaseError, ValidationError } from "@/lib/errors";
import { AuditService } from "@/server/services/audit.service";
import { createNotificationService } from "@/server/services/notification.service";
import {
  adjustAttendanceSchema,
  assignEmployeeShiftSchema,
  checkInSchema,
  checkOutSchema,
  reconcileAttendanceSchema,
  upsertAttendancePolicySchema,
  upsertAttendanceShiftSchema,
} from "@/modules/attendance/schemas";
import type { AttendanceRecord } from "@/types/models";

function formBool(value: FormDataEntryValue | null, fallback = false): boolean {
  if (value == null || value === "") return fallback;
  return value === "true" || value === "on" || value === "1";
}

function revalidateAttendancePaths() {
  revalidatePath("/attendance");
  revalidatePath("/attendance/history");
  revalidatePath("/attendance/team");
  revalidatePath("/hr/attendance");
  revalidatePath("/hr/attendance/policies");
  revalidatePath("/hr/attendance/shifts");
  revalidatePath("/hr/attendance/assignments");
  revalidatePath("/hr/attendance/adjustments");
}

async function notifyEmployeeProfile(
  supabase: SupabaseClient,
  organizationId: string,
  employeeId: string,
  payload: {
    type: string;
    title: string;
    message: string;
    entityId: string;
    priority?: "low" | "normal" | "high";
  },
) {
  const admin = createAdminSupabaseClient();
  const { data: emp } = await admin
    .from("employees")
    .select("profile_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (!emp?.profile_id) return;

  const notify = createNotificationService(supabase);
  await notify.notify({
    organizationId,
    recipientProfileId: emp.profile_id,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    entityType: "attendance_record",
    entityId: payload.entityId,
    priority: payload.priority ?? "normal",
  });
}

export async function checkInAction(_formData?: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.check_in");
  if (!ctx.employee) {
    throw new ValidationError("لا يوجد سجل موظف مرتبط بحسابك.", "No employee record linked to your account.");
  }
  const parsed = checkInSchema.safeParse({});
  if (!parsed.success) {
    throw new ValidationError("بيانات غير صالحة.", "Invalid data.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("attendance_check_in");
  if (error) throw new DatabaseError(error);

  const record = data as AttendanceRecord;
  revalidateAttendancePaths();
  void ctx;
  void record;
}

export async function checkOutAction(_formData?: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.check_out");
  if (!ctx.employee) {
    throw new ValidationError("لا يوجد سجل موظف مرتبط بحسابك.", "No employee record linked to your account.");
  }
  const parsed = checkOutSchema.safeParse({});
  if (!parsed.success) {
    throw new ValidationError("بيانات غير صالحة.", "Invalid data.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("attendance_check_out");
  if (error) throw new DatabaseError(error);

  const record = data as AttendanceRecord;
  revalidateAttendancePaths();
  void ctx;
  void record;
}

export async function adjustAttendanceRecordAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.adjust");
  const checkInRaw = String(formData.get("checkInAt") ?? "").trim();
  const checkOutRaw = String(formData.get("checkOutAt") ?? "").trim();
  const statusRaw = String(formData.get("attendanceStatus") ?? "").trim();

  const parsed = adjustAttendanceSchema.safeParse({
    recordId: formData.get("recordId"),
    checkInAt: checkInRaw ? new Date(checkInRaw).toISOString() : null,
    checkOutAt: checkOutRaw ? new Date(checkOutRaw).toISOString() : null,
    attendanceStatus: statusRaw || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات التعديل غير مكتملة.", "Adjustment data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("adjust_attendance_record", {
    p_record_id: parsed.data.recordId,
    p_check_in_at: parsed.data.checkInAt ?? null,
    p_check_out_at: parsed.data.checkOutAt ?? null,
    p_attendance_status: parsed.data.attendanceStatus ?? null,
    p_notes: parsed.data.notes ?? null,
    p_reason: parsed.data.reason,
  });
  if (error) throw new DatabaseError(error);

  const record = data as AttendanceRecord;
  await notifyEmployeeProfile(supabase, ctx.organization.id, record.employee_id, {
    type: "attendance.adjusted",
    title: "تم تعديل سجل الحضور",
    message: "عدّلت الموارد البشرية سجل حضورك. راجع التفاصيل من صفحة الحضور.",
    entityId: record.id,
    priority: "high",
  });

  revalidateAttendancePaths();
}

export async function assignEmployeeShiftAction(formData: FormData) {
  authorize(await getAuthContext(), "attendance.manage_shifts");
  const toRaw = String(formData.get("effectiveTo") ?? "").trim();
  const parsed = assignEmployeeShiftSchema.safeParse({
    employeeId: formData.get("employeeId"),
    shiftId: formData.get("shiftId"),
    effectiveFrom: formData.get("effectiveFrom"),
    effectiveTo: toRaw || null,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات تعيين الوردية غير مكتملة.", "Shift assignment data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("assign_employee_shift", {
    p_employee_id: parsed.data.employeeId,
    p_shift_id: parsed.data.shiftId,
    p_effective_from: parsed.data.effectiveFrom,
    p_effective_to: parsed.data.effectiveTo ?? null,
  });
  if (error) throw new DatabaseError(error);

  revalidatePath("/hr/attendance/assignments");
  revalidatePath("/attendance");
}

export async function reconcileAttendanceAction(formData: FormData) {
  authorize(await getAuthContext(), "attendance.manage");
  const empRaw = String(formData.get("employeeId") ?? "").trim();
  const parsed = reconcileAttendanceSchema.safeParse({
    attendanceDate: formData.get("attendanceDate"),
    employeeId: empRaw || undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("تاريخ التسوية غير صالح.", "Invalid reconcile date.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("reconcile_attendance_for_date", {
    p_attendance_date: parsed.data.attendanceDate,
    p_employee_id: parsed.data.employeeId ?? null,
  });
  if (error) throw new DatabaseError(error);

  revalidateAttendancePaths();
}

export async function upsertAttendancePolicyAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.manage_policies");
  const parsed = upsertAttendancePolicySchema.safeParse({
    id: String(formData.get("id") ?? "").trim() || undefined,
    code: formData.get("code"),
    name_ar: formData.get("name_ar"),
    name_en: formData.get("name_en"),
    description_ar: String(formData.get("description_ar") ?? "").trim() || undefined,
    description_en: String(formData.get("description_en") ?? "").trim() || undefined,
    late_grace_minutes: formData.get("late_grace_minutes") || 15,
    early_leave_grace_minutes: formData.get("early_leave_grace_minutes") || 15,
    minimum_work_minutes: formData.get("minimum_work_minutes") || 240,
    allow_manual_check_in: formBool(formData.get("allow_manual_check_in"), true),
    allow_manual_check_out: formBool(formData.get("allow_manual_check_out"), true),
    require_hr_approval_for_adjustment: formBool(formData.get("require_hr_approval_for_adjustment"), false),
    reconciliation_delay_hours: formData.get("reconciliation_delay_hours") || 8,
    is_active: formBool(formData.get("is_active"), true),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات السياسة غير مكتملة.", "Policy data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const row = {
    organization_id: ctx.organization.id,
    code: parsed.data.code.toUpperCase(),
    name_ar: parsed.data.name_ar,
    name_en: parsed.data.name_en,
    description_ar: parsed.data.description_ar ?? null,
    description_en: parsed.data.description_en ?? null,
    late_grace_minutes: parsed.data.late_grace_minutes,
    early_leave_grace_minutes: parsed.data.early_leave_grace_minutes,
    minimum_work_minutes: parsed.data.minimum_work_minutes,
    allow_manual_check_in: parsed.data.allow_manual_check_in,
    allow_manual_check_out: parsed.data.allow_manual_check_out,
    require_hr_approval_for_adjustment: parsed.data.require_hr_approval_for_adjustment,
    reconciliation_delay_hours: parsed.data.reconciliation_delay_hours,
    is_active: parsed.data.is_active,
  };

  const audit = new AuditService(supabase);
  if (parsed.data.id) {
    const { error } = await supabase
      .from("attendance_policies")
      .update(row)
      .eq("id", parsed.data.id)
      .eq("organization_id", ctx.organization.id);
    if (error) throw new DatabaseError(error);
    await audit.log({
      organizationId: ctx.organization.id,
      action: "attendance_policy.updated",
      entityType: "attendance_policy",
      entityId: parsed.data.id,
      newValues: { code: row.code, is_active: row.is_active },
    });
  } else {
    const { data, error } = await supabase.from("attendance_policies").insert(row).select("id").single();
    if (error) throw new DatabaseError(error);
    await audit.log({
      organizationId: ctx.organization.id,
      action: "attendance_policy.created",
      entityType: "attendance_policy",
      entityId: data.id,
      newValues: { code: row.code },
    });
  }

  revalidatePath("/hr/attendance/policies");
  revalidatePath("/hr/attendance/shifts");
}

export async function upsertAttendanceShiftAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.manage_shifts");
  const parsed = upsertAttendanceShiftSchema.safeParse({
    id: String(formData.get("id") ?? "").trim() || undefined,
    policy_id: formData.get("policy_id"),
    code: formData.get("code"),
    name_ar: formData.get("name_ar"),
    name_en: formData.get("name_en"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
    break_minutes: formData.get("break_minutes") || 60,
    crosses_midnight: formBool(formData.get("crosses_midnight"), false),
    working_days: String(formData.get("working_days") ?? "0,1,2,3,4"),
    is_active: formBool(formData.get("is_active"), true),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات الوردية غير مكتملة.", "Shift data is incomplete.");
  }

  const supabase = await createServerSupabaseClient();
  const row = {
    organization_id: ctx.organization.id,
    policy_id: parsed.data.policy_id,
    code: parsed.data.code.toUpperCase(),
    name_ar: parsed.data.name_ar,
    name_en: parsed.data.name_en,
    start_time: parsed.data.start_time.length === 5 ? `${parsed.data.start_time}:00` : parsed.data.start_time,
    end_time: parsed.data.end_time.length === 5 ? `${parsed.data.end_time}:00` : parsed.data.end_time,
    break_minutes: parsed.data.break_minutes,
    crosses_midnight: parsed.data.crosses_midnight,
    working_days: parsed.data.working_days,
    is_active: parsed.data.is_active,
  };

  const audit = new AuditService(supabase);
  if (parsed.data.id) {
    const { error } = await supabase
      .from("attendance_shifts")
      .update(row)
      .eq("id", parsed.data.id)
      .eq("organization_id", ctx.organization.id);
    if (error) throw new DatabaseError(error);
    await audit.log({
      organizationId: ctx.organization.id,
      action: "attendance_shift.updated",
      entityType: "attendance_shift",
      entityId: parsed.data.id,
      newValues: { code: row.code, is_active: row.is_active },
    });
  } else {
    const { data, error } = await supabase.from("attendance_shifts").insert(row).select("id").single();
    if (error) throw new DatabaseError(error);
    await audit.log({
      organizationId: ctx.organization.id,
      action: "attendance_shift.created",
      entityType: "attendance_shift",
      entityId: data.id,
      newValues: { code: row.code },
    });
  }

  revalidatePath("/hr/attendance/shifts");
  revalidatePath("/hr/attendance/assignments");
}
