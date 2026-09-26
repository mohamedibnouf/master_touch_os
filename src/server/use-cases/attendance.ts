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
  assignEmployeeWorkplaceSchema,
  upsertWorkplaceLocationSchema,
} from "@/modules/attendance/schemas";
import type { AttendanceRecord } from "@/types/models";
import { canAddWorkplaceAssignment, geofenceUserMessage, parseAttendancePunchRpc } from "@/modules/attendance/geofence";

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
  revalidatePath("/hr/attendance/locations");
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

function interpretLocationPunch(data: unknown, error: { message?: string } | null): void {
  if (error) mapAttendanceRpcError(error);
  const parsed = parseAttendancePunchRpc(data);
  if (!parsed) {
    throw new ValidationError("تعذر تسجيل الحضور. حاول مرة أخرى.", "Attendance could not be recorded.");
  }
  if (!parsed.accepted) {
    const mapped = geofenceUserMessage(parsed.reason_code);
    throw new ValidationError(mapped.ar, mapped.en);
  }
}

function mapAttendanceRpcError(error: { message?: string } | null): never {
  const msg = error?.message ?? "";
  if (/does not exist|schema cache|attendance_check_in/i.test(msg) && /p_latitude|function/i.test(msg)) {
    throw new ValidationError("ترحيل 063 غير مطبّق بعد.", "Migration 063 is not applied.");
  }
  if (/GEOFENCE_|NO_WORKPLACE|OUTSIDE|POOR_ACCURACY|INACTIVE_WORKPLACE|INVALID_LOCATION|LOCATION_REQUIRED/i.test(msg)) {
    const mapped = geofenceUserMessage(msg);
    throw new ValidationError(mapped.ar, mapped.en);
  }
  throw new DatabaseError(error);
}

export async function checkInAction() {
  const ctx = authorize(await getAuthContext(), "attendance.check_in");
  if (!ctx.employee) {
    throw new ValidationError("لا يوجد سجل موظف مرتبط بحسابك.", "No employee record linked to your account.");
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("attendance_check_in");
  if (error) mapAttendanceRpcError(error);
  revalidateAttendancePaths();
}

export async function checkOutAction() {
  const ctx = authorize(await getAuthContext(), "attendance.check_out");
  if (!ctx.employee) {
    throw new ValidationError("لا يوجد سجل موظف مرتبط بحسابك.", "No employee record linked to your account.");
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("attendance_check_out");
  if (error) mapAttendanceRpcError(error);
  revalidateAttendancePaths();
}

export type AttendancePunchState = { ok: boolean; message?: string };

export async function checkInWithLocationAction(
  _prev: AttendancePunchState | null,
  formData: FormData,
): Promise<AttendancePunchState> {
  try {
    const ctx = authorize(await getAuthContext(), "attendance.check_in");
    if (!ctx.employee) {
      return { ok: false, message: "لا يوجد سجل موظف مرتبط بحسابك." };
    }
    const parsed = checkInSchema.safeParse({
      latitude: formData.get("latitude"),
      longitude: formData.get("longitude"),
      accuracyMeters: formData.get("accuracyMeters"),
    });
    if (!parsed.success) {
      return { ok: false, message: "تعذر التحقق من إحداثيات الموقع." };
    }
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("attendance_check_in", {
      p_latitude: parsed.data.latitude,
      p_longitude: parsed.data.longitude,
      p_accuracy_meters: parsed.data.accuracyMeters,
    });
    interpretLocationPunch(data, error);
    revalidateAttendancePaths();
    return { ok: true };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, message: err.userMessageAr };
    if (err instanceof DatabaseError) return { ok: false, message: err.userMessageAr };
    return { ok: false, message: "تعذر تسجيل الحضور. حاول مرة أخرى." };
  }
}

export async function checkOutWithLocationAction(
  _prev: AttendancePunchState | null,
  formData: FormData,
): Promise<AttendancePunchState> {
  try {
    const ctx = authorize(await getAuthContext(), "attendance.check_out");
    if (!ctx.employee) {
      return { ok: false, message: "لا يوجد سجل موظف مرتبط بحسابك." };
    }
    const parsed = checkOutSchema.safeParse({
      latitude: formData.get("latitude"),
      longitude: formData.get("longitude"),
      accuracyMeters: formData.get("accuracyMeters"),
    });
    if (!parsed.success) {
      return { ok: false, message: "تعذر التحقق من إحداثيات الموقع." };
    }
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("attendance_check_out", {
      p_latitude: parsed.data.latitude,
      p_longitude: parsed.data.longitude,
      p_accuracy_meters: parsed.data.accuracyMeters,
    });
    interpretLocationPunch(data, error);
    revalidateAttendancePaths();
    return { ok: true };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, message: err.userMessageAr };
    if (err instanceof DatabaseError) return { ok: false, message: err.userMessageAr };
    return { ok: false, message: "تعذر تسجيل الانصراف. حاول مرة أخرى." };
  }
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

export async function upsertWorkplaceLocationAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.manage_locations");
  const accRaw = String(formData.get("max_accuracy_meters") ?? "").trim();
  const parsed = upsertWorkplaceLocationSchema.safeParse({
    id: String(formData.get("id") ?? "").trim() || undefined,
    name: formData.get("name"),
    code: String(formData.get("code") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    allowed_radius_meters: formData.get("allowed_radius_meters") || 150,
    max_accuracy_meters: accRaw ? accRaw : null,
    is_active: formBool(formData.get("is_active"), false),
    is_primary: formBool(formData.get("is_primary"), false),
    timezone: String(formData.get("timezone") ?? "").trim() || "Asia/Riyadh",
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات موقع العمل غير مكتملة.", "Workplace data is incomplete.");
  }
  const supabase = await createServerSupabaseClient();
  const row = {
    organization_id: ctx.organization.id,
    name: parsed.data.name,
    code: parsed.data.code || null,
    address: parsed.data.address,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    allowed_radius_meters: parsed.data.allowed_radius_meters,
    max_accuracy_meters: parsed.data.max_accuracy_meters ?? 100,
    timezone: parsed.data.timezone || "Asia/Riyadh",
    is_active: parsed.data.is_active,
    is_primary: parsed.data.is_primary,
    created_by: ctx.userId,
  };
  const audit = new AuditService(supabase);
  const auditFields = {
    name: row.name,
    code: row.code,
    address: row.address,
    allowed_radius_meters: row.allowed_radius_meters,
    max_accuracy_meters: row.max_accuracy_meters,
    timezone: row.timezone,
    is_active: row.is_active,
    is_primary: row.is_primary,
  };
  if (parsed.data.id) {
    const { data: previous } = await supabase
      .from("workplace_locations")
      .select("is_active")
      .eq("id", parsed.data.id)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    const { error } = await supabase
      .from("workplace_locations")
      .update(row)
      .eq("id", parsed.data.id)
      .eq("organization_id", ctx.organization.id);
    if (error) {
      if (error.code === "23505") {
        throw new ValidationError(
          "تعذر حفظ الموقع الأساسي: يجب أن يبقى موقع أساسي واحد فقط لكل منشأة.",
          "Could not save primary workplace: only one primary is allowed per organization.",
        );
      }
      throw new DatabaseError(error);
    }
    await audit.log({
      organizationId: ctx.organization.id,
      action: "workplace.updated",
      entityType: "workplace_location",
      entityId: parsed.data.id,
      newValues: auditFields,
    });
    if (previous && previous.is_active !== row.is_active) {
      await audit.log({
        organizationId: ctx.organization.id,
        action: row.is_active ? "workplace.activated" : "workplace.deactivated",
        entityType: "workplace_location",
        entityId: parsed.data.id,
        newValues: { is_active: row.is_active, name: row.name },
      });
    }
  } else {
    const { data, error } = await supabase.from("workplace_locations").insert(row).select("id").single();
    if (error) {
      if (error.code === "23505") {
        throw new ValidationError(
          "تعذر حفظ الموقع الأساسي: يجب أن يبقى موقع أساسي واحد فقط لكل منشأة.",
          "Could not save primary workplace: only one primary is allowed per organization.",
        );
      }
      throw new DatabaseError(error);
    }
    await audit.log({
      organizationId: ctx.organization.id,
      action: "workplace.created",
      entityType: "workplace_location",
      entityId: data.id,
      newValues: auditFields,
    });
  }
  revalidatePath("/hr/attendance/locations");
  revalidatePath("/attendance");
}

export async function assignEmployeeWorkplaceAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.manage_locations");
  const toRaw = String(formData.get("effectiveTo") ?? "").trim();
  const parsed = assignEmployeeWorkplaceSchema.safeParse({
    employeeId: formData.get("employeeId"),
    workplaceId: formData.get("workplaceId"),
    effectiveFrom: formData.get("effectiveFrom"),
    effectiveTo: toRaw || null,
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات تعيين الموقع غير مكتملة.", "Workplace assignment data is incomplete.");
  }
  const supabase = await createServerSupabaseClient();
  const { data: existingRows } = await supabase
    .from("employee_workplace_assignments")
    .select("workplace_location_id, effective_from, effective_to")
    .eq("organization_id", ctx.organization.id)
    .eq("employee_id", parsed.data.employeeId);
  const overlap = canAddWorkplaceAssignment(
    (existingRows ?? []).map((r) => ({
      workplaceId: r.workplace_location_id as string,
      effectiveFrom: r.effective_from as string,
      effectiveTo: (r.effective_to as string | null) ?? null,
    })),
    {
      workplaceId: parsed.data.workplaceId,
      effectiveFrom: parsed.data.effectiveFrom,
      effectiveTo: parsed.data.effectiveTo ?? null,
    },
  );
  if (!overlap.ok) {
    throw new ValidationError(
      "هذا الموظف معيَّن بالفعل لهذا الموقع في فترة متداخلة.",
      "This employee already has an overlapping assignment for the same workplace.",
    );
  }
  const { error } = await supabase.from("employee_workplace_assignments").insert({
    organization_id: ctx.organization.id,
    employee_id: parsed.data.employeeId,
    workplace_location_id: parsed.data.workplaceId,
    effective_from: parsed.data.effectiveFrom,
    effective_to: parsed.data.effectiveTo,
    created_by: ctx.userId,
  });
  if (error) {
    if (error.code === "23P01" || /no_overlap|exclusion/i.test(error.message ?? "")) {
      throw new ValidationError(
        "هذا الموظف معيَّن بالفعل لهذا الموقع في فترة متداخلة.",
        "This employee already has an overlapping assignment for the same workplace.",
      );
    }
    if (/WORKPLACE_ORG_MISMATCH/i.test(error.message ?? "")) {
      throw new ValidationError("لا يمكن ربط موظف بموقع عمل خارج المنشأة.", "Workplace and employee must belong to the same organization.");
    }
    throw new DatabaseError(error);
  }
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "workplace.assigned",
    entityType: "employee_workplace_assignment",
    entityId: parsed.data.employeeId,
    newValues: { workplace_id: parsed.data.workplaceId, effective_from: parsed.data.effectiveFrom, effective_to: parsed.data.effectiveTo },
  });
  revalidatePath("/hr/attendance/locations");
  revalidatePath("/attendance");
}

export async function endEmployeeWorkplaceAssignmentAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.manage_locations");
  const id = String(formData.get("assignmentId") ?? "").trim();
  const endedOn = String(formData.get("effectiveTo") ?? "").trim() || new Date().toISOString().slice(0, 10);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ValidationError("تعيين غير صالح.", "Invalid assignment.");
  }
  const supabase = await createServerSupabaseClient();
  const { data: row, error: fetchErr } = await supabase
    .from("employee_workplace_assignments")
    .select("id, employee_id, workplace_location_id, effective_from")
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (fetchErr) throw new DatabaseError(fetchErr);
  if (!row) throw new ValidationError("التعيين غير موجود.", "Assignment not found.");
  if (endedOn < String(row.effective_from)) {
    throw new ValidationError("تاريخ الانتهاء لا يمكن أن يسبق تاريخ البداية.", "End date cannot precede start date.");
  }
  const { error } = await supabase
    .from("employee_workplace_assignments")
    .update({ effective_to: endedOn })
    .eq("id", id)
    .eq("organization_id", ctx.organization.id);
  if (error) throw new DatabaseError(error);
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "workplace.assignment_ended",
    entityType: "employee_workplace_assignment",
    entityId: id,
    newValues: { employee_id: row.employee_id, workplace_id: row.workplace_location_id, effective_to: endedOn },
  });
  revalidatePath("/hr/attendance/locations");
  revalidatePath("/attendance");
}

export async function removeEmployeeWorkplaceAssignmentAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "attendance.manage_locations");
  const id = String(formData.get("assignmentId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ValidationError("تعيين غير صالح.", "Invalid assignment.");
  }
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createServerSupabaseClient();
  const { data: row, error: fetchErr } = await supabase
    .from("employee_workplace_assignments")
    .select("id, employee_id, workplace_location_id, effective_from, effective_to")
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (fetchErr) throw new DatabaseError(fetchErr);
  if (!row) throw new ValidationError("التعيين غير موجود.", "Assignment not found.");
  const started = String(row.effective_from) <= today;
  const stillOpen = row.effective_to == null || String(row.effective_to) >= today;
  if (started && stillOpen) {
    throw new ValidationError(
      "لا يمكن حذف تعيين سارٍ. أنهِ الفترة أولاً للحفاظ على السجل.",
      "Cannot delete an active assignment. End the period first.",
    );
  }
  const { error } = await supabase
    .from("employee_workplace_assignments")
    .delete()
    .eq("id", id)
    .eq("organization_id", ctx.organization.id);
  if (error) throw new DatabaseError(error);
  await new AuditService(supabase).log({
    organizationId: ctx.organization.id,
    action: "workplace.assignment_removed",
    entityType: "employee_workplace_assignment",
    entityId: id,
    newValues: { employee_id: row.employee_id, workplace_id: row.workplace_location_id },
  });
  revalidatePath("/hr/attendance/locations");
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
