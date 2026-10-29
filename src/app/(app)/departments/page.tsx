import type { ReactNode } from "react";
import Link from "next/link";
import { Briefcase, Building2, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { FormSection } from "@/components/ui/form-section";
import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { upsertDepartmentAction } from "@/server/use-cases/hr";
import { JobTitleRepository } from "@/server/repositories/job-title.repository";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function DepartmentsPage() {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "department.read")) redirect("/");

  const { t, locale } = await getI18n();
  const td = t.hrPeople.departments;
  const tc = t.hrPeople.common;

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const departments = await repo.listDepartments(ctx.organization.id);
  const titleCounts = await new JobTitleRepository(supabase).countUsageByDepartment(ctx.organization.id);
  const employees =
    hasPermission(ctx, "employee.read") || hasPermission(ctx, "department.update")
      ? await repo.listEmployeeNameOptions(ctx.organization.id)
      : [];

  const canCreate = hasPermission(ctx, "department.create");
  const canUpdate = hasPermission(ctx, "department.update");
  const byId = new Map(departments.map((d) => [d.id, d]));
  const deptName = (d: { name_ar: string; name_en?: string | null }) => pickLocalized(locale, d.name_ar, d.name_en);
  // The secondary line shows the other language, so both names stay visible.
  const otherName = (d: { name_ar: string; name_en?: string | null }) => (locale === "ar" ? d.name_en : d.name_ar);

  const roots = departments.filter((d) => !d.parent_department_id);
  const childrenOf = (parentId: string) => departments.filter((d) => d.parent_department_id === parentId);

  const createLink = (
    <a
      href="#department-create-card"
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-medium text-white shadow-[var(--shadow-1)] duration-150 hover:bg-primary-hover md:min-h-10"
    >
      <Plus className="size-4" aria-hidden />
      {td.create}
    </a>
  );

  function renderTree(nodes: typeof departments, depth = 0): ReactNode {
    return nodes.map((department) => {
      const parent = department.parent_department_id ? byId.get(department.parent_department_id) : undefined;
      return (
        <div key={department.id} style={{ marginInlineStart: depth * 16 }} className="mb-3">
          <div
            className={`mt-surface p-4 md:p-5${depth > 0 ? " border-s-2 border-s-primary/30" : ""}`}
            data-testid={`department-card-${department.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"
                  aria-hidden
                >
                  <Building2 className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted" dir="ltr">
                    {department.code}
                  </p>
                  <h2 className="mt-1 text-base font-semibold text-ink" dir="auto">
                    {deptName(department)}
                  </h2>
                  <p className="truncate text-sm text-muted" dir="auto" title={otherName(department) ?? undefined}>
                    {otherName(department)}
                  </p>
                  {department.parent_department_id ? (
                    <p className="mt-1 text-xs text-muted">
                      {format(td.parentOf, { name: parent ? deptName(parent) : "—" })}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">
                    {format(td.titlesCount, { count: titleCounts.get(department.id) ?? 0 })}
                  </p>
                </div>
              </div>
              <Badge tone={department.is_active ? "success" : "neutral"}>
                {department.is_active ? tc.active : tc.inactive}
              </Badge>
            </div>
            {canUpdate ? (
              <ServerActionForm action={upsertDepartmentAction} className="mt-4 grid gap-2 border-t border-line pt-3 md:grid-cols-2">
                <input type="hidden" name="departmentId" value={department.id} />
                <Field label={td.code}>
                  <Input name="code" required dir="ltr" defaultValue={department.code} />
                </Field>
                <Field label={td.isActive}>
                  <Select name="is_active" defaultValue={department.is_active ? "true" : "false"}>
                    <option value="true">{tc.active}</option>
                    <option value="false">{tc.inactive}</option>
                  </Select>
                </Field>
                <Field label={td.nameAr}>
                  <Input name="name_ar" required dir="rtl" defaultValue={department.name_ar} />
                </Field>
                <Field label={td.nameEn}>
                  <Input name="name_en" required dir="ltr" defaultValue={department.name_en} />
                </Field>
                <Field label={td.parent}>
                  <Select name="parent_department_id" defaultValue={department.parent_department_id ?? ""}>
                    <option value="">{tc.none}</option>
                    {departments
                      .filter((d) => d.id !== department.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {deptName(d)}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={td.manager}>
                  <Select name="manager_user_id" defaultValue={department.manager_user_id ?? ""}>
                    <option value="">{tc.none}</option>
                    {employees.map((e) => (
                      <option key={e.profile_id} value={e.profile_id}>
                        {pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.profile_id}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="md:col-span-2">
                  <Field label={td.descriptionField}>
                    <Input name="description" defaultValue={department.description ?? ""} />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" variant="secondary" data-testid={`department-update-${department.id}`}>
                    {tc.saveChanges}
                  </Button>
                </div>
              </ServerActionForm>
            ) : null}
          </div>
          {renderTree(childrenOf(department.id), depth + 1)}
        </div>
      );
    });
  }

  return (
    <PageContainer data-testid="departments-page" className="space-y-5">
      <PageHeader
        title={td.title}
        description={td.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/departments/job-titles"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-medium text-ink duration-150 hover:bg-surface-muted md:min-h-10"
              data-testid="departments-job-titles-link"
            >
              <Briefcase className="size-4 text-muted" aria-hidden />
              {td.jobTitlesLink}
            </Link>
            {canCreate ? createLink : null}
          </div>
        }
      />

      {canCreate ? (
        <div className="mx-auto w-full max-w-3xl" id="department-create-card" data-testid="department-create-card">
          <div className="mt-surface p-4 md:p-6">
            <FormSection icon={Building2} title={td.create} description={td.createDescription}>
              <ServerActionForm action={upsertDepartmentAction} className="grid gap-3 md:grid-cols-2">
                <Field label={td.code} required>
                  <Input name="code" required dir="ltr" data-testid="department-create-code" />
                </Field>
                <Field label={td.isActive}>
                  <Select name="is_active" defaultValue="true">
                    <option value="true">{tc.active}</option>
                    <option value="false">{tc.inactive}</option>
                  </Select>
                </Field>
                <Field label={td.nameAr} required>
                  <Input name="name_ar" required dir="rtl" data-testid="department-create-name-ar" />
                </Field>
                <Field label={td.nameEn} required>
                  <Input name="name_en" required dir="ltr" data-testid="department-create-name-en" />
                </Field>
                <Field label={td.parent}>
                  <Select name="parent_department_id" defaultValue="" data-testid="department-create-parent">
                    <option value="">{td.parentNoneRoot}</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} — {deptName(d)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={td.manager}>
                  <Select name="manager_user_id" defaultValue="">
                    <option value="">{tc.none}</option>
                    {employees.map((e) => (
                      <option key={e.profile_id} value={e.profile_id}>
                        {pickLocalized(locale, e.profiles?.full_name_ar, e.profiles?.full_name_en) || e.profile_id}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="md:col-span-2">
                  <Button type="submit" data-testid="department-create-submit">
                    {td.submitCreate}
                  </Button>
                </div>
              </ServerActionForm>
            </FormSection>
          </div>
        </div>
      ) : null}

      {departments.length === 0 ? (
        <EmptyState
          title={td.emptyTitle}
          description={td.emptyDescription}
          action={canCreate ? createLink : null}
        />
      ) : (
        <div data-testid="departments-tree">
          <h2 className="mt-section-title mb-2">{td.structureHeading}</h2>
          {renderTree(roots.length > 0 ? roots : departments)}
        </div>
      )}
    </PageContainer>
  );
}
