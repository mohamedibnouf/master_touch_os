import Link from "next/link";
import { Briefcase, Building2, IdCard, KeyRound } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { FormSection } from "@/components/ui/form-section";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { createEmployeeAction } from "@/server/use-cases/hr";
import { isOperationalAssignableRole } from "@/lib/hr/roles";
import { EMPLOYMENT_TYPES, employmentTypeLabel } from "@/lib/hr/labels";
import { EmployeeTitleFields } from "@/components/hr/employee-title-fields";
import type { JobTitleRecord } from "@/lib/hr/job-titles";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

type RoleRow = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  code?: string;
  is_external?: boolean;
  is_system?: boolean;
  is_active?: boolean;
};
type DeptRow = { id: string; name_ar: string; name_en?: string | null };

export async function EmployeeCreateForm({
  departments,
  titles,
  roles,
  canAssignRole,
  allowPrivilegedRoles,
  canManageTitles,
}: {
  departments: DeptRow[];
  titles: JobTitleRecord[];
  roles: RoleRow[];
  canAssignRole: boolean;
  allowPrivilegedRoles: boolean;
  canManageTitles: boolean;
}) {
  const { t, locale } = await getI18n();
  const tc = t.hrPeople.createForm;

  return (
    <div className="mx-auto w-full max-w-3xl" id="employee-create-card" data-testid="employee-create-card">
      <div className="mt-surface-priority p-4 md:p-6">
        <FormSection icon={IdCard} title={tc.title} description={tc.description}>
          <ServerActionForm action={createEmployeeAction} className="space-y-6" testId="employee-create-form">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={tc.employeeNumber} required>
                <Input name="employee_number" required dir="ltr" data-testid="employee-create-number" />
              </Field>
              <Field label={tc.nationality}>
                <Input name="nationality" />
              </Field>
              <Field label={tc.nameAr} required>
                <Input name="full_name_ar" required minLength={2} dir="rtl" data-testid="employee-create-name-ar" />
              </Field>
              <Field label={tc.nameEn} required>
                <Input name="full_name_en" required minLength={2} dir="ltr" data-testid="employee-create-name-en" />
              </Field>
            </div>

            <FormSection icon={Building2} title={tc.orgTitle} description={tc.orgDescription}>
              <div className="grid gap-3 md:grid-cols-2">
                <EmployeeTitleFields
                  departments={departments}
                  titles={titles}
                  canManageTitles={canManageTitles}
                />
                {canAssignRole ? (
                  <Field label={tc.roleLabel} hint={tc.roleHint}>
                    <Select name="role_id" defaultValue="" data-testid="employee-create-role">
                      <option value="">{tc.roleNone}</option>
                      {roles
                        .filter((role) =>
                          isOperationalAssignableRole({
                            code: role.code,
                            is_external: role.is_external,
                            is_system: role.is_system,
                            is_active: role.is_active,
                            allowPrivileged: allowPrivilegedRoles,
                          }),
                        )
                        .map((role) => (
                          <option key={role.id} value={role.id}>
                            {pickLocalized(locale, role.name_ar, role.name_en)}
                          </option>
                        ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            </FormSection>

            <FormSection icon={Briefcase} title={tc.employmentTitle} description={tc.employmentDescription}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={tc.employmentType}>
                  <Select name="employment_type" defaultValue="" data-testid="employee-create-type">
                    <option value="">{tc.employmentTypeUnset}</option>
                    {EMPLOYMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {employmentTypeLabel(type, locale)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={tc.joiningDate}>
                  <Input name="joining_date" type="date" />
                </Field>
                <Field label={tc.workLocation}>
                  <Input name="work_location" />
                </Field>
              </div>
            </FormSection>

            <FormSection icon={KeyRound} title={tc.loginTitle} description={tc.loginDescription}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={tc.passwordLabel} hint={tc.passwordHint}>
                  <Input
                    name="initial_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    data-testid="employee-create-password"
                  />
                </Field>
                <Field label={tc.emailLabel}>
                  <Input name="email" type="email" dir="ltr" data-testid="employee-create-email" />
                </Field>
              </div>
            </FormSection>

            <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
              <Button type="submit" className="w-full sm:w-auto" data-testid="employee-create-submit">
                {tc.submit}
              </Button>
              <Link
                href="#employees-list"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] px-4 text-sm font-medium text-muted duration-150 hover:bg-surface-muted hover:text-ink md:min-h-10"
              >
                {tc.toDirectory}
              </Link>
            </div>
          </ServerActionForm>
        </FormSection>
      </div>
    </div>
  );
}
