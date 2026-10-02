export type JobTitleRecord = {
  id: string;
  organization_id: string;
  department_id: string | null;
  code: string | null;
  name_ar: string;
  name_en: string;
  is_active: boolean;
  sort_order: number;
};

export type JobTitleAssignmentOk = {
  ok: true;
  jobTitleId: string;
  jobTitleAr: string;
  jobTitleEn: string;
};

export type JobTitleAssignmentFail = {
  ok: false;
  reason: "missing" | "cross_org" | "inactive" | "wrong_department";
};

export type JobTitleAssignmentResult = JobTitleAssignmentOk | JobTitleAssignmentFail;

export function isJobTitleCompatibleWithDepartment(
  title: Pick<JobTitleRecord, "department_id">,
  departmentId: string | undefined,
): boolean {
  if (title.department_id == null) return true;
  return Boolean(departmentId && title.department_id === departmentId);
}

export function filterSelectableJobTitles(
  titles: readonly JobTitleRecord[],
  departmentId: string | undefined,
): JobTitleRecord[] {
  return titles.filter(
    (title) => title.is_active && isJobTitleCompatibleWithDepartment(title, departmentId),
  );
}

/** New assignment: must be same-org, active, and compatible with selected primary department. */
export function resolveNewJobTitleAssignment(input: {
  title: JobTitleRecord | null;
  organizationId: string;
  departmentId: string | undefined;
}): JobTitleAssignmentResult {
  if (!input.title) return { ok: false, reason: "missing" };
  if (input.title.organization_id !== input.organizationId) return { ok: false, reason: "cross_org" };
  if (!input.title.is_active) return { ok: false, reason: "inactive" };
  if (!isJobTitleCompatibleWithDepartment(input.title, input.departmentId)) {
    return { ok: false, reason: "wrong_department" };
  }
  return {
    ok: true,
    jobTitleId: input.title.id,
    jobTitleAr: input.title.name_ar,
    jobTitleEn: input.title.name_en,
  };
}

/**
 * Keeping an already-assigned title (including inactive / other-department) is allowed.
 * Switching to a different title uses new-assignment rules.
 */
export function resolveEmploymentJobTitlePatch(input: {
  submittedTitleId: string | undefined;
  currentTitleId: string | null;
  title: JobTitleRecord | null;
  organizationId: string;
  departmentId: string | undefined;
}): JobTitleAssignmentResult | { ok: true; keep: true } {
  if (!input.submittedTitleId) return { ok: true, keep: true };
  if (input.currentTitleId && input.submittedTitleId === input.currentTitleId) {
    return { ok: true, keep: true };
  }
  return resolveNewJobTitleAssignment({
    title: input.title,
    organizationId: input.organizationId,
    departmentId: input.departmentId,
  });
}

export function jobTitleAssignmentMessageAr(reason: JobTitleAssignmentFail["reason"]): string {
  if (reason === "cross_org") return "المسمى الوظيفي لا ينتمي لهذه المنشأة.";
  if (reason === "inactive") return "لا يمكن تعيين مسمى وظيفي غير نشط.";
  if (reason === "wrong_department") return "المسمى الوظيفي غير متاح للإدارة المحددة.";
  return "المسمى الوظيفي المحدد غير صالح.";
}

export function isLegacyJobTitle(input: {
  jobTitleId: string | null | undefined;
  jobTitleAr: string | null | undefined;
}): boolean {
  return !input.jobTitleId && Boolean(input.jobTitleAr);
}

export function isHistoricalCatalogTitle(input: {
  title: Pick<JobTitleRecord, "is_active" | "department_id"> | null;
  departmentId: string | undefined;
}): boolean {
  if (!input.title) return false;
  if (!input.title.is_active) return true;
  return !isJobTitleCompatibleWithDepartment(input.title, input.departmentId);
}
