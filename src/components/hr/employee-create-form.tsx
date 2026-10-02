import Link from "next/link";
import { Briefcase, Building2, IdCard, KeyRound } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { FormSection } from "@/components/ui/form-section";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { createEmployeeAction } from "@/server/use-cases/hr";
import { isOperationalAssignableRole } from "@/lib/hr/roles";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES } from "@/lib/hr/labels";
import { EmployeeTitleFields } from "@/components/hr/employee-title-fields";
import type { JobTitleRecord } from "@/lib/hr/job-titles";

type RoleRow = { id: string; name_ar: string; code?: string; is_external?: boolean; is_system?: boolean; is_active?: boolean };
type DeptRow = { id: string; name_ar: string };

export function EmployeeCreateForm({
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
  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="employee-create-card">
      <div className="mt-surface-priority p-4 md:p-6">
        <FormSection
          icon={IdCard}
          title="توظيف موظف جديد"
          description="يتطلب صلاحية إنشاء موظف. الدخول يتم بالرقم الوظيفي وكلمة المرور — ليس بالبريد. تعيين الأدوار يتطلب صلاحية منفصلة."
        >
          <ServerActionForm action={createEmployeeAction} className="space-y-6" testId="employee-create-form">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="الرقم الوظيفي" required>
                <Input name="employee_number" required data-testid="employee-create-number" />
              </Field>
              <Field label="الجنسية">
                <Input name="nationality" />
              </Field>
              <Field label="الاسم بالعربية" required>
                <Input name="full_name_ar" required minLength={2} data-testid="employee-create-name-ar" />
              </Field>
              <Field label="الاسم بالإنجليزية" required>
                <Input name="full_name_en" required minLength={2} data-testid="employee-create-name-en" />
              </Field>
            </div>

            <FormSection icon={Building2} title="التنظيم" description="الإدارة ثم المسمى الوظيفي ثم الدور والصلاحيات. المسمى مهنة وليست صلاحية.">
              <div className="grid gap-3 md:grid-cols-2">
                <EmployeeTitleFields
                  departments={departments}
                  titles={titles}
                  canManageTitles={canManageTitles}
                />
                {canAssignRole ? (
                  <Field
                    label="الدور والصلاحيات"
                    hint="تحدد ما يستطيع الموظف الوصول إليه داخل النظام، ولا تمثل مسماه الوظيفي."
                  >
                    <Select name="role_id" defaultValue="" data-testid="employee-create-role">
                      <option value="">بدون — تُعيَّن صلاحية موظف تلقائياً عند تفعيل الدخول</option>
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
                            {role.name_ar}
                          </option>
                        ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            </FormSection>

            <FormSection icon={Briefcase} title="التوظيف" description="نوع التعاقد وتاريخ الالتحاق وموقع العمل.">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="نوع التوظيف">
                  <Select name="employment_type" defaultValue="" data-testid="employee-create-type">
                    <option value="">غير محدد</option>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {EMPLOYMENT_TYPE_LABELS[t].ar}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="تاريخ الالتحاق">
                  <Input name="joining_date" type="date" />
                </Field>
                <Field label="موقع العمل">
                  <Input name="work_location" />
                </Field>
              </div>
            </FormSection>

            <FormSection
              icon={KeyRound}
              title="حساب الدخول (اختياري)"
              description="إن وُضعت كلمة مرور يُفعَّل الدخول بالرقم الوظيفي. البريد الداخلي اختياري ولا يُستخدم لدخول الموظف."
            >
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="كلمة مرور الدخول (اختياري)"
                  hint="إن وُجدت يجب ألا تقل عن 8 أحرف. لا تُعرض بعد الحفظ."
                >
                  <Input
                    name="initial_password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    data-testid="employee-create-password"
                  />
                </Field>
                <Field label="بريد داخلي اختياري — لا يُطلب من الموظف عند الدخول">
                  <Input name="email" type="email" data-testid="employee-create-email" />
                </Field>
              </div>
            </FormSection>

            <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
              <Button type="submit" className="w-full sm:w-auto" data-testid="employee-create-submit">
                إنشاء الموظف
              </Button>
              <Link
                href="#employees-list"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] px-4 text-sm font-medium text-muted duration-150 hover:bg-paper hover:text-ink md:min-h-10"
              >
                إلى الدليل
              </Link>
            </div>
          </ServerActionForm>
        </FormSection>
      </div>
    </div>
  );
}
