"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { DatabaseError, ValidationError } from "@/lib/errors";
import { createNotificationService } from "@/server/services/notification.service";
import {
  addPayrollManualDeductionSchema,
  addPayrollManualEarningSchema,
  cancelPayrollPeriodSchema,
  createPayrollPeriodSchema,
  payrollPeriodIdSchema,
  recordPayrollPaymentSchema,
  updatePayrollSettingsSchema,
} from "@/modules/payroll/schemas";
import type { PayrollEntry, PayrollPeriod } from "@/types/models";

async function listRoleRecipientIds(
  organizationId: string,
  roleCodes: string[],
  excludeProfileId?: string | null,
): Promise<string[]> {
  try {
    const admin = createAdminSupabaseClient();
    const { data: roles } = await admin
      .from("roles")
      .select("id")
      .in("code", roleCodes)
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
    if (ids.size === 0) return [];
    // Only active members — leftover fixture role rows must not fan out forever.
    const { data: active } = await admin
      .from("organization_members")
      .select("profile_id")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("profile_id", [...ids]);
    return (active ?? []).map((row) => row.profile_id as string).filter(Boolean);
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
  try {
    const notify = createNotificationService(supabase);
    // Cap fan-out so server actions cannot stall when an org has many role holders.
    const capped = profileIds.slice(0, 25);
    await Promise.allSettled(
      capped.map((recipientProfileId) =>
        notify.notify({
          organizationId,
          recipientProfileId,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          entityType: "payroll_period",
          entityId: payload.entityId,
          priority: payload.priority ?? "normal",
        }),
      ),
    );
  } catch {
    // Notifications are best-effort; payroll state changes must not depend on them.
  }
}

function revalidatePayroll(periodId?: string) {
  revalidatePath("/payroll");
  revalidatePath("/payroll/settings");
  revalidatePath("/my/payslips");
  if (periodId) {
    revalidatePath(`/payroll/${periodId}`);
    revalidatePath(`/payroll/${periodId}/employees`);
    revalidatePath(`/payroll/${periodId}/review`);
  }
}

export async function createPayrollPeriodAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "payroll.prepare");
  // Do not Zod-validate organizationId: seed org UUID is not RFC-variant compliant
  // (e.g. 11111111-1111-1111-1111-111111111111) and is already trusted from auth context.
  const parsed = createPayrollPeriodSchema.safeParse({
    year: formData.get("year"),
    month: formData.get("month"),
  });
  if (!parsed.success) {
    throw new ValidationError("بيانات فترة الرواتب غير مكتملة.", "Payroll period data is incomplete.");
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_payroll_period", {
    p_organization_id: ctx.organization.id,
    p_year: parsed.data.year,
    p_month: parsed.data.month,
  });
  if (error) throw new DatabaseError(error);
  revalidatePayroll((data as PayrollPeriod).id);
}

export async function calculatePayrollPeriodAction(formData: FormData) {
  authorize(await getAuthContext(), "payroll.calculate");
  const parsed = payrollPeriodIdSchema.safeParse({ periodId: formData.get("periodId") });
  if (!parsed.success) throw new ValidationError("معرف الفترة غير صالح.", "Invalid period id.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("calculate_payroll_period", {
    p_period_id: parsed.data.periodId,
  });
  if (error) throw new DatabaseError(error);
  revalidatePayroll(parsed.data.periodId);

}

export async function submitPayrollForReviewAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "payroll.prepare");
  const parsed = payrollPeriodIdSchema.safeParse({ periodId: formData.get("periodId") });
  if (!parsed.success) throw new ValidationError("معرف الفترة غير صالح.", "Invalid period id.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("submit_payroll_for_review", {
    p_period_id: parsed.data.periodId,
  });
  if (error) throw new DatabaseError(error);

  const financeIds = await listRoleRecipientIds(
    ctx.organization.id,
    ["finance_manager", "finance_officer"],
    ctx.profile.id,
  );
  await notifyProfiles(supabase, ctx.organization.id, financeIds, {
    type: "payroll.submitted",
    title: "مسير رواتب بانتظار المراجعة",
    message: "تم إرسال مسير رواتب للمراجعة المالية.",
    entityId: parsed.data.periodId,
    priority: "high",
  });

  revalidatePayroll(parsed.data.periodId);

}

export async function markPayrollReviewedAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "payroll.review");
  const parsed = payrollPeriodIdSchema.safeParse({ periodId: formData.get("periodId") });
  if (!parsed.success) throw new ValidationError("معرف الفترة غير صالح.", "Invalid period id.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("mark_payroll_reviewed", {
    p_period_id: parsed.data.periodId,
  });
  if (error) throw new DatabaseError(error);

  const approverIds = await listRoleRecipientIds(
    ctx.organization.id,
    ["finance_manager", "general_manager"],
    ctx.profile.id,
  );
  await notifyProfiles(supabase, ctx.organization.id, approverIds, {
    type: "payroll.reviewed",
    title: "مسير رواتب بانتظار الاعتماد",
    message: "اكتملت مراجعة المسير وهو بانتظار الاعتماد.",
    entityId: parsed.data.periodId,
    priority: "high",
  });

  revalidatePayroll(parsed.data.periodId);

}

export async function approvePayrollPeriodAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "payroll.approve");
  const parsed = payrollPeriodIdSchema.safeParse({ periodId: formData.get("periodId") });
  if (!parsed.success) throw new ValidationError("معرف الفترة غير صالح.", "Invalid period id.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("approve_payroll_period", {
    p_period_id: parsed.data.periodId,
  });
  if (error) throw new DatabaseError(error);

  const financeIds = await listRoleRecipientIds(
    ctx.organization.id,
    ["finance_manager", "finance_officer"],
    ctx.profile.id,
  );
  await notifyProfiles(supabase, ctx.organization.id, financeIds, {
    type: "payroll.approved",
    title: "تم اعتماد مسير الرواتب",
    message: "تم اعتماد المسير ويمكن قفله وتسجيل الصرف.",
    entityId: parsed.data.periodId,
    priority: "high",
  });

  revalidatePayroll(parsed.data.periodId);

}

export async function lockPayrollPeriodAction(formData: FormData) {
  authorize(await getAuthContext(), "payroll.lock");
  const parsed = payrollPeriodIdSchema.safeParse({ periodId: formData.get("periodId") });
  if (!parsed.success) throw new ValidationError("معرف الفترة غير صالح.", "Invalid period id.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("lock_payroll_period", {
    p_period_id: parsed.data.periodId,
  });
  if (error) throw new DatabaseError(error);

  // Notify employees with entries (capped, non-blocking fan-out).
  try {
    const admin = createAdminSupabaseClient();
    const { data: entries } = await admin
      .from("payroll_entries")
      .select("employee_id, employees(profile_id)")
      .eq("payroll_period_id", parsed.data.periodId);
    const notify = createNotificationService(supabase);
    const period = data as PayrollPeriod;
    const recipientIds: string[] = [];
    for (const row of entries ?? []) {
      const emp = row.employees as { profile_id?: string } | { profile_id?: string }[] | null;
      const profileId = Array.isArray(emp) ? emp[0]?.profile_id : emp?.profile_id;
      if (profileId) recipientIds.push(profileId);
    }
    await Promise.allSettled(
      recipientIds.slice(0, 25).map((profileId) =>
        notify.notify({
          organizationId: period.organization_id,
          recipientProfileId: profileId,
          type: "payroll.locked",
          title: "قسيمة راتب متاحة",
          message: `أصبحت قسيمة راتب ${period.year}/${period.month} متاحة للعرض.`,
          entityType: "payroll_period",
          entityId: period.id,
          priority: "normal",
        }),
      ),
    );
  } catch {
    // non-fatal
  }

  revalidatePayroll(parsed.data.periodId);

}

export async function cancelPayrollPeriodAction(formData: FormData) {
  authorize(await getAuthContext(), "payroll.prepare");
  const parsed = cancelPayrollPeriodSchema.safeParse({
    periodId: formData.get("periodId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) throw new ValidationError("بيانات الإلغاء غير مكتملة.", "Cancel data incomplete.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_payroll_period", {
    p_period_id: parsed.data.periodId,
    p_reason: parsed.data.reason,
  });
  if (error) throw new DatabaseError(error);
  revalidatePayroll(parsed.data.periodId);

}

export async function addPayrollManualEarningAction(formData: FormData) {
  authorize(await getAuthContext(), "payroll.adjust");
  const parsed = addPayrollManualEarningSchema.safeParse({
    entryId: formData.get("entryId"),
    code: formData.get("code"),
    descriptionAr: formData.get("descriptionAr"),
    descriptionEn: formData.get("descriptionEn"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) throw new ValidationError("بيانات الاستحقاق غير مكتملة.", "Earning data incomplete.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("add_payroll_manual_earning", {
    p_entry_id: parsed.data.entryId,
    p_code: parsed.data.code,
    p_description_ar: parsed.data.descriptionAr,
    p_description_en: parsed.data.descriptionEn,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  });
  if (error) throw new DatabaseError(error);
  const earning = data as { payroll_period_id?: string };
  revalidatePayroll(earning.payroll_period_id);
  revalidatePath(`/payroll/payslips/${parsed.data.entryId}`);

}

export async function addPayrollManualDeductionAction(formData: FormData) {
  authorize(await getAuthContext(), "payroll.adjust");
  const parsed = addPayrollManualDeductionSchema.safeParse({
    entryId: formData.get("entryId"),
    code: formData.get("code"),
    descriptionAr: formData.get("descriptionAr"),
    descriptionEn: formData.get("descriptionEn"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) throw new ValidationError("بيانات الخصم غير مكتملة.", "Deduction data incomplete.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("add_payroll_manual_deduction", {
    p_entry_id: parsed.data.entryId,
    p_code: parsed.data.code,
    p_description_ar: parsed.data.descriptionAr,
    p_description_en: parsed.data.descriptionEn,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  });
  if (error) throw new DatabaseError(error);
  const row = data as { payroll_period_id?: string };
  revalidatePayroll(row.payroll_period_id);

}

export async function recordPayrollPaymentAction(formData: FormData) {
  authorize(await getAuthContext(), "payroll.record_payment");
  const parsed = recordPayrollPaymentSchema.safeParse({
    entryId: formData.get("entryId"),
    paymentDate: formData.get("paymentDate"),
    paymentMethod: formData.get("paymentMethod") || "bank_transfer",
    paymentReference: String(formData.get("paymentReference") ?? "").trim() || undefined,
    amount: formData.get("amount"),
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
  if (!parsed.success) throw new ValidationError("بيانات الصرف غير مكتملة.", "Payment data incomplete.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("record_payroll_payment", {
    p_entry_id: parsed.data.entryId,
    p_payment_date: parsed.data.paymentDate,
    p_method: parsed.data.paymentMethod,
    p_reference: parsed.data.paymentReference ?? null,
    p_amount: parsed.data.amount,
    p_notes: parsed.data.notes ?? null,
  });
  if (error) throw new DatabaseError(error);
  const pay = data as { payroll_period_id?: string; payroll_entry_id?: string };
  revalidatePayroll(pay.payroll_period_id);
  if (pay.payroll_entry_id) revalidatePath(`/payroll/payslips/${pay.payroll_entry_id}`);
  revalidatePath("/my/payslips");

}

export async function updatePayrollSettingsAction(formData: FormData) {
  const ctx = authorize(await getAuthContext(), "payroll.manage_settings");
  const parsed = updatePayrollSettingsSchema.safeParse({
    currency: formData.get("currency") || "SAR",
    standardPayableDays: formData.get("standardPayableDays"),
    deductUnpaidLeave: formData.get("deductUnpaidLeave") === "on" || formData.get("deductUnpaidLeave") === "true",
    deductAbsence: formData.get("deductAbsence") === "on" || formData.get("deductAbsence") === "true",
    deductLateMinutes: formData.get("deductLateMinutes") === "on" || formData.get("deductLateMinutes") === "true",
    roundingPrecision: formData.get("roundingPrecision"),
    defaultPaymentMethod: formData.get("defaultPaymentMethod") || "bank_transfer",
  });
  if (!parsed.success) throw new ValidationError("إعدادات الرواتب غير مكتملة.", "Payroll settings incomplete.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("update_payroll_settings", {
    p_organization_id: ctx.organization.id,
    p_currency: parsed.data.currency,
    p_standard_payable_days: parsed.data.standardPayableDays,
    p_deduct_unpaid_leave: parsed.data.deductUnpaidLeave,
    p_deduct_absence: parsed.data.deductAbsence,
    p_deduct_late_minutes: parsed.data.deductLateMinutes,
    p_rounding_precision: parsed.data.roundingPrecision,
    p_default_payment_method: parsed.data.defaultPaymentMethod,
  });
  if (error) throw new DatabaseError(error);
  revalidatePath("/payroll/settings");
}

