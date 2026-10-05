import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import { directoryProfileName } from "@/lib/hr/directory-page";
import { EMPLOYMENT_STATUS_LABELS, employmentTypeLabel } from "@/lib/hr/labels";
import { displayInitials } from "@/lib/ui/initials";
import type { EmploymentStatus } from "@/types/enums";

type DirectoryRow = {
  id: string;
  employee_number: string | null;
  job_title_ar: string | null;
  employment_status: string;
  employment_type: string | null;
  is_active: boolean;
  profiles: unknown;
};

export function EmployeeDirectory({ employees }: { employees: DirectoryRow[] }) {
  return (
    <div className="mt-surface overflow-hidden" data-testid="employees-list">
      <div className="hidden border-b border-line bg-paper/70 px-4 py-2 text-[11px] font-semibold text-muted md:grid md:grid-cols-12 md:gap-3">
        <span className="md:col-span-4">الموظف</span>
        <span className="md:col-span-2">الرقم الوظيفي</span>
        <span className="md:col-span-3">المسمى / النوع</span>
        <span className="md:col-span-2">الحالة</span>
        <span className="md:col-span-1 text-end">إجراء</span>
      </div>
      <ul>
        {employees.map((employee) => {
          const status = employee.employment_status as EmploymentStatus;
          const typeLabel = employmentTypeLabel(employee.employment_type);
          const arName = directoryProfileName(employee.profiles);
          const number = employee.employee_number ?? "—";
          return (
            <li
              key={employee.id}
              data-testid={`employee-row-${employee.id}`}
              className="border-b border-line/80 px-4 py-3 last:border-b-0 md:grid md:grid-cols-12 md:items-center md:gap-3"
            >
              <div className="flex min-w-0 items-center gap-3 md:col-span-4">
                <span
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-primary/10 text-sm font-semibold text-navy"
                  aria-hidden
                >
                  {displayInitials(arName === "بدون اسم" ? "" : arName)}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/employees/${employee.id}`}
                    className="block truncate text-sm font-semibold text-navy duration-150 hover:underline"
                    dir="auto"
                    title={arName}
                    data-testid={`employee-link-${employee.id}`}
                  >
                    {arName}
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
                <p className="truncate text-sm text-navy" title={employee.job_title_ar ?? undefined}>
                  {employee.job_title_ar || "بدون مسمى"}
                </p>
                {typeLabel !== "—" ? <p className="text-[11px] text-muted">{typeLabel}</p> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 md:col-span-2 md:mt-0">
                <Badge tone={employee.is_active ? "success" : "danger"}>
                  {employee.is_active ? "نشط" : "موقوف"}
                </Badge>
                <Badge tone="neutral">{EMPLOYMENT_STATUS_LABELS[status]?.ar ?? status}</Badge>
              </div>
              <div className="mt-3 md:col-span-1 md:mt-0 md:text-end">
                <Link
                  href={`/employees/${employee.id}`}
                  className="inline-flex min-h-10 items-center text-sm font-medium text-navy duration-150 hover:underline"
                >
                  عرض
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
