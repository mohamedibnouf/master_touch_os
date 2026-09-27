export function appErrorBoundaryCopy(error: { message?: string }): { title: string; body: string } {
  const message = error.message ?? "";
  if (message === "Validation failed") {
    return {
      title: "تعذر إتمام العملية",
      body: "البيانات غير مكتملة أو تتعارض مع سجل موجود. راجع الحقول وحاول مرة أخرى.",
    };
  }
  if (message === "Insufficient permissions") {
    return {
      title: "ليست لديك صلاحية",
      body: "هذا الإجراء غير متاح لحسابك. اطلب الصلاحية من الإدارة أو انتقل لشاشة أخرى.",
    };
  }
  if (message === "Authentication required") {
    return {
      title: "يلزم تسجيل الدخول",
      body: "انتهت الجلسة أو لم يتم تسجيل الدخول. سجّل الدخول ثم أعد المحاولة.",
    };
  }
  if (message === "Database operation failed") {
    return {
      title: "تعذر حفظ أو تحميل البيانات",
      body: "حدث خطأ أثناء قراءة أو حفظ البيانات. أعد المحاولة بعد قليل.",
    };
  }
  return {
    title: "تعذّر تحميل هذه الشاشة",
    body: "البيانات لم تُعرض. أعد المحاولة أو انتقل لشاشة أخرى.",
  };
}
