import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { directoryProfileName } from "@/lib/hr/directory-page";
import { EMPLOYMENT_STATUS_LABELS, employmentTypeLabel } from "@/lib/hr/labels";
import { displayInitials } from "@/lib/ui/initials";
import { getI18n } from "@/lib/i18n/server";
import type { EmploymentStatus } from "@/types/enums";

type DirectoryRow = {
  id: string;
  employee_number: string | null;
  job_title_ar: string | null;
  job_title_en?: string | null;
  employment_status: string;
  employment_type: string | null;
  is_active: boolean;
  profiles: unknown;
};

export async function EmployeeDirectory({ employees }: { employees: DirectoryRow[] }) {
  const { t, locale } = await getI18n();
  const td = t.hrPeople.directory;
  const Chevron = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <div className="mt-surface overflow-hidden" data-testid="employees-list">
      <div className="hidden border-b border-line bg-surface-muted px-4 py-2.5 text-[11px] font-semibold text-muted md:grid md:grid-cols-12 md:gap-3">
        <span className="md:col-span-4">{td.colEmployee}</span>
        <span className="md:col-span-2">{td.colNumber}</span>
        <span className="md:col-span-3">{td.colTitleType}</span>
        <span className="md:col-span-2">{td.colStatus}</span>
        <span className="md:col-span-1 text-end">{td.colAction}</span>
      </div>
      <ul>
        {employees.map((employee) => {
          const status = employee.employment_status as EmploymentStatus;
          const typeLabel = employmentTypeLabel(employee.employment_type, locale);
          const rawName = directoryProfileName(employee.profiles, "", locale);
          const name = rawName || td.noName;
          const number = employee.employee_number ?? "—";
          const jobTitle =
            locale === "en" ? employee.job_title_en?.trim() || employee.job_title_ar : employee.job_title_ar;
          const statusLabel = EMPLOYMENT_STATUS_LABELS[status]?.[locale] ?? status;
          return (
            <li
              key={employee.id}
              data-testid={`employee-row-${employee.id}`}
              className="border-b border-line/80 px-4 py-3 duration-150 last:border-b-0 hover:bg-surface-muted/60 md:grid md:grid-cols-12 md:items-center md:gap-3"
            >
              <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                <span
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-primary-soft text-sm font-semibold text-primary"
                  aria-hidden
                >
                  {displayInitials(rawName)}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/employees/${employee.id}`}
                    className="block truncate text-sm font-semibold text-ink duration-150 hover:text-primary hover:underline"
                    dir="auto"
                    title={name}
                    data-testid={`employee-link-${employee.id}`}
                  >
                    {name}
                  </Link>
                  <p className="truncate text-[11px] text-muted md:hidden" dir="ltr">
                    {number}
                  </p>
                </div>
              </div>
              <p className="mt-2 hidden font-mono text-sm text-ink md:col-span-2 md:mt-0 md:block" dir="ltr" title={number}>
                {number}
              </p>
              <div className="mt-2 min-w-0 md:col-span-3 md:mt-0">
                <p className="truncate text-sm text-ink" dir="auto" title={jobTitle ?? undefined}>
                  {jobTitle || td.noTitle}
                </p>
                {typeLabel !== "—" ? <p className="text-[11px] text-muted">{typeLabel}</p> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 md:col-span-2 md:mt-0">
                <Badge tone={employee.is_active ? "success" : "danger"}>
                  {employee.is_active ? td.active : td.disabled}
                </Badge>
                <Badge tone="neutral">{statusLabel}</Badge>
              </div>
              <div className="mt-3 md:col-span-1 md:mt-0 md:text-end">
                <Link
                  href={`/employees/${employee.id}`}
                  className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary duration-150 hover:underline"
                >
                  {td.view}
                  <Chevron className="size-4" aria-hidden />
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
