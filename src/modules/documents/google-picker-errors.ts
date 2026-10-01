export type GooglePickerUiError =
  | "not_configured"
  | "script_failed"
  | "popup_blocked"
  | "sign_in_cancelled"
  | "token_error"
  | "token_expired"
  | "picker_cancelled"
  | "invalid_selection"
  | "denied"
  | "network";

export const GOOGLE_PICKER_ERROR_AR: Record<GooglePickerUiError, string> = {
  not_configured: "اختيار Drive غير مُعد في هذه البيئة.",
  script_failed: "تعذر تحميل أدوات Google.",
  popup_blocked: "تم حظر نافذة Google. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.",
  sign_in_cancelled: "تم إلغاء تسجيل الدخول إلى Google.",
  token_error: "تعذر الحصول على تفويض Google.",
  token_expired: "انتهت صلاحية الجلسة مع Google. أعد الاختيار.",
  picker_cancelled: "لم يتم اختيار ملف.",
  invalid_selection: "الملف المختار غير صالح.",
  denied: "رفض Google الوصول.",
  network: "تعذر الاتصال بـ Google.",
};

export function googlePickerErrorMessage(code: GooglePickerUiError): string {
  return GOOGLE_PICKER_ERROR_AR[code];
}

export function mapGisTokenClientError(error: { type?: string; message?: string } | undefined): GooglePickerUiError {
  const type = (error?.type ?? "").toLowerCase();
  if (type.includes("popup_closed") || type.includes("popup_closed_by_user")) return "sign_in_cancelled";
  if (type.includes("popup_failed") || type.includes("popup_blocked")) return "popup_blocked";
  if (type.includes("network")) return "network";
  return "token_error";
}

export function mapGisTokenResponseError(error: string | undefined): GooglePickerUiError {
  const value = (error ?? "").toLowerCase();
  if (!value) return "token_error";
  if (value.includes("access_denied") || value.includes("denied")) return "denied";
  if (value.includes("popup_closed")) return "sign_in_cancelled";
  if (value.includes("expired") || value === "invalid_grant") return "token_expired";
  if (value.includes("network")) return "network";
  return "token_error";
}
