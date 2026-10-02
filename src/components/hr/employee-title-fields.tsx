"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Field, Select } from "@/components/ui/primitives";
import { filterSelectableJobTitles, type JobTitleRecord } from "@/lib/hr/job-titles";

type DeptRow = { id: string; name_ar: string };

export function EmployeeTitleFields({
  departments,
  titles,
  canManageTitles,
  defaultDepartmentId = "",
  defaultTitleId = "",
  historicalHint,
  legacyHint,
  departmentTestId = "employee-create-department",
  titleTestId = "employee-create-title",
}: {
  departments: DeptRow[];
  titles: JobTitleRecord[];
  canManageTitles: boolean;
  defaultDepartmentId?: string;
  defaultTitleId?: string;
  historicalHint?: string | null;
  legacyHint?: string | null;
  departmentTestId?: string;
  titleTestId?: string;
}) {
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId);
  const selectable = useMemo(
    () => filterSelectableJobTitles(titles, departmentId || undefined),
    [titles, departmentId],
  );
  const currentStillListed = selectable.some((title) => title.id === defaultTitleId);
  const keepCurrent = Boolean(defaultTitleId && !currentStillListed);
  const [titleId, setTitleId] = useState(defaultTitleId);

  function onDepartmentChange(next: string) {
    setDepartmentId(next);
    const nextSelectable = filterSelectableJobTitles(titles, next || undefined);
    if (titleId && !nextSelectable.some((title) => title.id === titleId) && titleId !== defaultTitleId) {
      setTitleId("");
    }
  }

  return (
    <>
      <Field label="الإدارة">
        <Select
          name="department_id"
          value={departmentId}
          onChange={(event) => onDepartmentChange(event.target.value)}
          data-testid={departmentTestId}
        >
          <option value="">بدون</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name_ar}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="المسمى الوظيفي"
        hint="مهنة أو مسمى وظيفي فقط — ليس صلاحية النظام."
      >
        <Select
          name="job_title_id"
          value={titleId}
          onChange={(event) => setTitleId(event.target.value)}
          data-testid={titleTestId}
        >
          <option value="">{legacyHint ? "بدون تغيير — مسمى قديم" : "بدون"}</option>
          {keepCurrent ? (
            <option value={defaultTitleId}>
              المسمى الحالي (تاريخي)
            </option>
          ) : null}
          {selectable.map((title) => (
            <option key={title.id} value={title.id}>
              {title.name_ar}
              {title.department_id ? "" : " — عام"}
            </option>
          ))}
        </Select>
        {historicalHint ? <span className="mt-1 block text-xs text-warning">{historicalHint}</span> : null}
        {legacyHint ? <span className="mt-1 block text-xs text-muted">{legacyHint}</span> : null}
        {selectable.length === 0 ? (
          <p className="mt-1 text-xs text-muted" data-testid="job-title-empty">
            لا توجد مسميات وظيفية نشطة لهذه الإدارة.
            {canManageTitles ? (
              <>
                {" "}
                <Link href="/departments/job-titles" className="font-medium text-navy underline">
                  إدارة المسميات الوظيفية
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </Field>
    </>
  );
}
