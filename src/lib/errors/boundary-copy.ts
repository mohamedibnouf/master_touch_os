type BoundaryCopy = { title: string; body: string };
type BoundaryLocale = "ar" | "en";

const COPY: Record<string, Record<BoundaryLocale, BoundaryCopy>> = {
  "Validation failed": {
    ar: {
      title: "تعذر إتمام العملية",
      body: "البيانات غير مكتملة أو تتعارض مع سجل موجود. راجع الحقول وحاول مرة أخرى.",
    },
    en: {
      title: "The operation could not be completed",
      body: "The data is incomplete or conflicts with an existing record. Check the fields and try again.",
    },
  },
  "Insufficient permissions": {
    ar: {
      title: "ليست لديك صلاحية",
      body: "هذا الإجراء غير متاح لحسابك. اطلب الصلاحية من الإدارة أو انتقل لشاشة أخرى.",
    },
    en: {
      title: "You do not have permission",
      body: "This action is not available to your account. Ask management for access or go to another screen.",
    },
  },
  "Authentication required": {
    ar: {
      title: "يلزم تسجيل الدخول",
      body: "انتهت الجلسة أو لم يتم تسجيل الدخول. سجّل الدخول ثم أعد المحاولة.",
    },
    en: {
      title: "Sign-in required",
      body: "Your session has ended or you are not signed in. Sign in and try again.",
    },
  },
  "Database operation failed": {
    ar: {
      title: "تعذر حفظ أو تحميل البيانات",
      body: "حدث خطأ أثناء قراءة أو حفظ البيانات. أعد المحاولة بعد قليل.",
    },
    en: {
      title: "Data could not be saved or loaded",
      body: "An error occurred while reading or saving data. Try again shortly.",
    },
  },
};

const FALLBACK: Record<BoundaryLocale, BoundaryCopy> = {
  ar: {
    title: "تعذّر تحميل هذه الشاشة",
    body: "البيانات لم تُعرض. أعد المحاولة أو انتقل لشاشة أخرى.",
  },
  en: {
    title: "This screen could not be loaded",
    body: "The data was not displayed. Try again or go to another screen.",
  },
};

export function appErrorBoundaryCopy(error: { message?: string }, locale: BoundaryLocale = "ar"): BoundaryCopy {
  const message = error.message ?? "";
  const entry = Object.prototype.hasOwnProperty.call(COPY, message) ? COPY[message] : FALLBACK;
  return entry[locale];
}
