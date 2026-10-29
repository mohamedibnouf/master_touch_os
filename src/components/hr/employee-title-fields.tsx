"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Field, Select } from "@/components/ui/primitives";
import { filterSelectableJobTitles, type JobTitleRecord } from "@/lib/hr/job-titles";
import { pickLocalized } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

type DeptRow = { id: string; name_ar: string; name_en?: string | null };

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
  const { t, locale } = useI18n();
  const tf = t.hrPeople.titleFields;
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
      <Field label={tf.department}>
        <Select
          name="department_id"
          value={departmentId}
          onChange={(event) => onDepartmentChange(event.target.value)}
          data-testid={departmentTestId}
        >
          <option value="">{tf.none}</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {pickLocalized(locale, department.name_ar, department.name_en)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={tf.jobTitle} hint={tf.jobTitleHint}>
        <Select
          name="job_title_id"
          value={titleId}
          onChange={(event) => setTitleId(event.target.value)}
          data-testid={titleTestId}
        >
          <option value="">{legacyHint ? tf.keepLegacy : tf.none}</option>
          {keepCurrent ? <option value={defaultTitleId}>{tf.currentHistorical}</option> : null}
          {selectable.map((title) => (
            <option key={title.id} value={title.id}>
              {pickLocalized(locale, title.name_ar, title.name_en)}
              {title.department_id ? "" : tf.orgWideSuffix}
            </option>
          ))}
        </Select>
        {historicalHint ? <span className="mt-1 block text-xs text-warning">{historicalHint}</span> : null}
        {legacyHint ? <span className="mt-1 block text-xs text-muted">{legacyHint}</span> : null}
        {selectable.length === 0 ? (
          <p className="mt-1 text-xs text-muted" data-testid="job-title-empty">
            {tf.empty}
            {canManageTitles ? (
              <>
                {" "}
                <Link href="/departments/job-titles" className="font-medium text-primary underline">
                  {tf.manageTitles}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </Field>
    </>
  );
}
