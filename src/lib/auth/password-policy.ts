import type { Locale } from "@/lib/i18n/config";

export type PasswordFormState = { ok: boolean; message: string | null };

export const PASSWORD_MIN_LENGTH = 8;

/** Server-side messages for the password flows (UI labels live in the dictionaries). */
export const PASSWORD_COPY: Record<
  Locale,
  {
    invalid: string;
    tooShort: string;
    mismatch: string;
    currentRequired: string;
    currentWrong: string;
    samePassword: string;
    failed: string;
    rateLimited: string;
    resetSent: string;
    useHrForEmployeeNumber: string;
  }
> = {
  ar: {
    invalid: "تحقق من البيانات المدخلة.",
    tooShort: `كلمة المرور يجب ألا تقل عن ${PASSWORD_MIN_LENGTH} أحرف.`,
    mismatch: "كلمتا المرور غير متطابقتين.",
    currentRequired: "أدخل كلمة المرور الحالية.",
    currentWrong: "كلمة المرور الحالية غير صحيحة.",
    samePassword: "اختر كلمة مرور مختلفة عن السابقة.",
    failed: "تعذّر تغيير كلمة المرور. حاول مرة أخرى.",
    rateLimited: "محاولات كثيرة. حاول بعد قليل.",
    resetSent: "إذا كان البريد مسجّلاً لدينا فستصلك رسالة فيها رابط لتعيين كلمة مرور جديدة.",
    useHrForEmployeeNumber:
      "الحسابات التي تدخل بالرقم الوظيفي لا تملك بريداً. اطلب من الموارد البشرية إعادة تعيين كلمة المرور.",
  },
  en: {
    invalid: "Please check the data you entered.",
    tooShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    mismatch: "The passwords don't match.",
    currentRequired: "Enter your current password.",
    currentWrong: "Your current password is incorrect.",
    samePassword: "Choose a password different from the previous one.",
    failed: "Couldn't change the password. Please try again.",
    rateLimited: "Too many attempts. Please try again shortly.",
    resetSent: "If that e-mail is registered, you'll receive a link to set a new password.",
    useHrForEmployeeNumber:
      "Accounts that sign in with an employee number have no mailbox. Ask HR to reset your password.",
  },
};

export function passwordPolicyError(password: string, confirm: string, locale: Locale): string | null {
  const copy = PASSWORD_COPY[locale];
  if (password.length < PASSWORD_MIN_LENGTH) return copy.tooShort;
  if (password !== confirm) return copy.mismatch;
  return null;
}

/** Proxy rule: a temporary (HR-issued) password must be replaced before anything else. */
export const CHANGE_PASSWORD_PATH = "/auth/change-password";

export function mustChangePassword(userMetadata: unknown): boolean {
  return (userMetadata as Record<string, unknown> | null | undefined)?.must_change_password === true;
}
