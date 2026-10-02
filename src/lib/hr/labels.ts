import type {
  AttendanceStatus,
  CompensationVersionStatus,
  EmployeeContractStatus,
  EmployeeDocumentCategory,
  EmployeeGender,
  EmploymentStatus,
  EmploymentType,
  HrDocumentVisibility,
  LeaveRequestStatus,
} from "@/types/enums";

export const EMPLOYMENT_TYPE_LABELS: Record<
  EmploymentType,
  { ar: string; en: string }
> = {
  permanent: { ar: "دائم", en: "Permanent" },
  fixed_term: { ar: "محدد المدة", en: "Fixed term" },
  part_time: { ar: "دوام جزئي", en: "Part time" },
  temporary: { ar: "مؤقت", en: "Temporary" },
  consultant: { ar: "استشاري", en: "Consultant" },
};

export const CONTRACT_STATUS_LABELS: Record<
  EmployeeContractStatus,
  { ar: string; en: string }
> = {
  draft: { ar: "مسودة", en: "Draft" },
  active: { ar: "نشط / سارٍ", en: "Active" },
  expired: { ar: "منتهٍ", en: "Expired" },
  renewed: { ar: "مجدد", en: "Renewed" },
  terminated: { ar: "مفسوخ", en: "Terminated" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
};

export const DOCUMENT_CATEGORY_LABELS: Record<
  EmployeeDocumentCategory,
  { ar: string; en: string }
> = {
  contract: { ar: "عقد عمل", en: "Employment Contract" },
  id: { ar: "هوية وطنية", en: "National ID" },
  iqama: { ar: "إقامة", en: "Iqama" },
  passport: { ar: "جواز سفر", en: "Passport" },
  insurance: { ar: "تأمين طبي", en: "Medical Insurance" },
  certificate: { ar: "شهادة / مؤهل", en: "Certificate" },
  bank: { ar: "مستند بنكي / آيبان", en: "Bank / IBAN Proof" },
  hr_form: { ar: "نموذج إداري", en: "HR Form" },
  other: { ar: "أخرى", en: "Other" },
};

export const VISIBILITY_SCOPE_LABELS: Record<
  HrDocumentVisibility,
  { ar: string; en: string }
> = {
  employee_visible: { ar: "مرئي للموظف و HR", en: "Employee & HR" },
  hr_only: { ar: "خاص بإدارة HR فقط", en: "HR Only" },
  finance_visible: { ar: "مرئي للمالية و HR", en: "Finance & HR" },
  restricted: { ar: "سري ومقيد للغاية", en: "Restricted" },
};

export const COMPENSATION_STATUS_LABELS: Record<
  CompensationVersionStatus,
  { ar: string; en: string }
> = {
  active: { ar: "سارٍ", en: "Active" },
  superseded: { ar: "سابق / مغلق", en: "Superseded" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
};

export const EMPLOYMENT_STATUS_LABELS: Record<
  EmploymentStatus,
  { ar: string; en: string }
> = {
  active: { ar: "نشط", en: "Active" },
  on_leave: { ar: "إجازة", en: "On leave" },
  probation: { ar: "تجربة", en: "Probation" },
  terminated: { ar: "منتهٍ", en: "Terminated" },
  resigned: { ar: "مستقيل", en: "Resigned" },
};

export const EMPLOYEE_GENDER_LABELS: Record<
  EmployeeGender,
  { ar: string; en: string }
> = {
  male: { ar: "ذكر", en: "Male" },
  female: { ar: "أنثى", en: "Female" },
  other: { ar: "آخر", en: "Other" },
  unspecified: { ar: "غير محدد", en: "Unspecified" },
};

export const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[];
export const EMPLOYEE_GENDERS = Object.keys(EMPLOYEE_GENDER_LABELS) as EmployeeGender[];
export const CONTRACT_STATUSES = Object.keys(CONTRACT_STATUS_LABELS) as EmployeeContractStatus[];
export const DOCUMENT_CATEGORIES = Object.keys(DOCUMENT_CATEGORY_LABELS) as EmployeeDocumentCategory[];
export const VISIBILITY_SCOPES = Object.keys(VISIBILITY_SCOPE_LABELS) as HrDocumentVisibility[];

export function employmentTypeLabel(value: EmploymentType | string | null | undefined, locale: "ar" | "en" = "ar") {
  if (!value || !(value in EMPLOYMENT_TYPE_LABELS)) return "—";
  return EMPLOYMENT_TYPE_LABELS[value as EmploymentType][locale];
}

export function contractStatusLabel(value: EmployeeContractStatus | string | null | undefined, locale: "ar" | "en" = "ar") {
  if (!value || !(value in CONTRACT_STATUS_LABELS)) return "—";
  return CONTRACT_STATUS_LABELS[value as EmployeeContractStatus][locale];
}

export function documentCategoryLabel(value: EmployeeDocumentCategory | string | null | undefined, locale: "ar" | "en" = "ar") {
  if (!value || !(value in DOCUMENT_CATEGORY_LABELS)) return "—";
  return DOCUMENT_CATEGORY_LABELS[value as EmployeeDocumentCategory][locale];
}

export function visibilityScopeLabel(value: HrDocumentVisibility | string | null | undefined, locale: "ar" | "en" = "ar") {
  if (!value || !(value in VISIBILITY_SCOPE_LABELS)) return "—";
  return VISIBILITY_SCOPE_LABELS[value as HrDocumentVisibility][locale];
}

export function genderLabel(value: EmployeeGender | string | null | undefined, locale: "ar" | "en" = "ar") {
  if (!value || !(value in EMPLOYEE_GENDER_LABELS)) return "—";
  return EMPLOYEE_GENDER_LABELS[value as EmployeeGender][locale];
}

export function maskIban(iban: string | null | undefined): string {
  if (!iban) return "—";
  const clean = iban.trim().replace(/\s+/g, "");
  if (clean.length < 8) return "****";
  const prefix = clean.substring(0, 4);
  const suffix = clean.substring(clean.length - 4);
  return `${prefix} **** **** **** ${suffix}`;
}

export const LEAVE_STATUS_LABELS: Record<LeaveRequestStatus, { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" },
  submitted: { ar: "مقدّم", en: "Submitted" },
  approved: { ar: "معتمد", en: "Approved" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
};

export function leaveStatusLabel(value: LeaveRequestStatus | string | null | undefined, locale: "ar" | "en" = "ar") {
  if (!value || !(value in LEAVE_STATUS_LABELS)) return "—";
  return LEAVE_STATUS_LABELS[value as LeaveRequestStatus][locale];
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, { ar: string; en: string }> = {
  present: { ar: "حاضر", en: "Present" },
  late: { ar: "متأخر", en: "Late" },
  absent: { ar: "غائب", en: "Absent" },
  partial: { ar: "دوام جزئي", en: "Partial" },
  on_leave: { ar: "في إجازة", en: "On leave" },
  holiday: { ar: "عطلة رسمية", en: "Holiday" },
  off_day: { ar: "يوم راحة", en: "Off day" },
  missing_checkout: { ar: "بدون انصراف", en: "Missing checkout" },
};

export function attendanceStatusLabel(
  value: AttendanceStatus | string | null | undefined,
  locale: "ar" | "en" = "ar",
) {
  if (!value || !(value in ATTENDANCE_STATUS_LABELS)) return "—";
  return ATTENDANCE_STATUS_LABELS[value as AttendanceStatus][locale];
}

export const PAYROLL_PERIOD_STATUS_LABELS: Record<
  import("@/types/enums").PayrollPeriodStatus,
  { ar: string; en: string }
> = {
  draft: { ar: "مسودة", en: "Draft" },
  calculated: { ar: "محسوب", en: "Calculated" },
  under_review: { ar: "قيد المراجعة", en: "Under review" },
  approved: { ar: "معتمد", en: "Approved" },
  locked: { ar: "مقفل", en: "Locked" },
  paid: { ar: "مدفوع", en: "Paid" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
};

export function payrollPeriodStatusLabel(
  value: import("@/types/enums").PayrollPeriodStatus | string | null | undefined,
  locale: "ar" | "en" = "ar",
) {
  if (!value || !(value in PAYROLL_PERIOD_STATUS_LABELS)) return "—";
  return PAYROLL_PERIOD_STATUS_LABELS[value as import("@/types/enums").PayrollPeriodStatus][locale];
}

/** Explicit directory columns — never include compensation/banking/ID docs. */
/** Explicit directory columns — never include compensation/banking/ID docs. */
export const EMPLOYEE_DIRECTORY_COLUMNS =
  "id, organization_id, profile_id, employee_number, job_title_id, job_title_ar, job_title_en, employment_status, employment_type, joining_date, contract_start, contract_end, probation_end, direct_manager_employee_id, work_location, nationality, is_active, terminated_at, created_at, updated_at" as const;

/** Detail projection adds optional HR/self fields (still never compensation). */
export const EMPLOYEE_DETAIL_COLUMNS =
  `${EMPLOYEE_DIRECTORY_COLUMNS}, date_of_birth, gender` as const;
