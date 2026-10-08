"use server";

import { getAuthContext } from "@/server/context";
import { canViewManagement } from "@/modules/management/access";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isMissingGuardianSchema } from "@/modules/ai/guardian/persist";
import { reviewNoteRequired } from "@/modules/ai/guardian/transitions";
import type { GuardianFindingStatus } from "@/modules/ai/guardian/types";

function mapRpcError(message: string | undefined): string {
  const text = message ?? "";
  if (isMissingGuardianSchema(text)) return "سجل الحارس غير مُفعّل بعد.";
  if (/dismiss requires a reason/i.test(text)) return "الاستبعاد يتطلب سبباً.";
  if (/verification note/i.test(text)) return "الإغلاق يتطلب ملاحظة تحقق.";
  if (/invalid finding transition/i.test(text)) return "انتقال الحالة غير مسموح.";
  if (/not authorized|not authenticated/i.test(text)) return "غير مصرّح.";
  if (/baseline scan required/i.test(text)) return "يلزم إكمال المسح الأساسي قبل تفعيل التنبيهات.";
  return "تعذر تنفيذ الإجراء.";
}

export async function updateGuardianFindingStatusAction(input: {
  findingId: string;
  status: GuardianFindingStatus;
  reviewNote?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await getAuthContext();
    if (!ctx || !ctx.profile.is_active || ctx.membershipStatus !== "active") {
      return { ok: false, error: "غير مصرّح." };
    }
    if (!canViewManagement(ctx)) return { ok: false, error: "غير مصرّح." };
    if (!["acknowledged", "in_review", "resolved", "dismissed", "open"].includes(input.status)) {
      return { ok: false, error: "حالة غير صالحة." };
    }
    if (reviewNoteRequired(input.status) && (input.reviewNote ?? "").trim().length < 3) {
      return { ok: false, error: input.status === "dismissed" ? "الاستبعاد يتطلب سبباً." : "الإغلاق يتطلب ملاحظة تحقق." };
    }
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc("review_ai_finding", {
      p_finding_id: input.findingId,
      p_status: input.status,
      p_review_note: input.reviewNote ?? null,
    });
    if (error) return { ok: false, error: mapRpcError(error.message) };
    return { ok: true };
  } catch {
    return { ok: false, error: "غير مصرّح." };
  }
}

export async function assignGuardianFindingAction(input: {
  findingId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateGuardianFindingStatusAction({ findingId: input.findingId, status: "in_review" });
}

export async function enableGuardianAlertsAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await getAuthContext();
    if (!ctx || !ctx.profile.is_active || ctx.membershipStatus !== "active") {
      return { ok: false, error: "غير مصرّح." };
    }
    if (!canViewManagement(ctx)) return { ok: false, error: "غير مصرّح." };
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc("enable_guardian_alerts", {
      p_organization_id: ctx.organization.id,
    });
    if (error) return { ok: false, error: mapRpcError(error.message) };
    return { ok: true };
  } catch {
    return { ok: false, error: "غير مصرّح." };
  }
}
