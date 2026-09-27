export function workplaceUniqueViolationMessage(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}): { ar: string; en: string } | null {
  if (error.code !== "23505") return null;
  const blob = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (/org_code|locations_org_code|_code_uidx|\(organization_id,\s*code\)/i.test(blob)) {
    return {
      ar: "رمز الموقع مستخدم مسبقاً. اختر رمزاً آخر أو اتركه فارغاً.",
      en: "That workplace code is already in use. Choose another code or leave it empty.",
    };
  }
  if (/one_primary|_primary_uidx|is_primary/i.test(blob)) {
    return {
      ar: "تعذر حفظ الموقع الأساسي: يجب أن يبقى موقع أساسي واحد فقط لكل منشأة.",
      en: "Could not save primary workplace: only one primary is allowed per organization.",
    };
  }
  return {
    ar: "تعذر حفظ الموقع لأن البيانات تتعارض مع سجل موجود.",
    en: "Could not save the workplace because it conflicts with an existing record.",
  };
}
