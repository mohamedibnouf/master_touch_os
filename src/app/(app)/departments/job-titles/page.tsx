import Link from "next/link";
import { Briefcase, Building2, Filter } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { FormSection } from "@/components/ui/form-section";
import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { JobTitleRepository } from "@/server/repositories/job-title.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setJobTitleActiveAction, upsertJobTitleAction } from "@/server/use-cases/hr";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function JobTitlesPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string; status?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const canRead = hasPermission(ctx, "job_title.read") || hasPermission(ctx, "job_title.manage");
  if (!canRead) redirect("/");

  const { t, locale } = await getI18n();
  const tj = t.hrPeople.jobTitles;
  const tc = t.hrPeople.common;
  const numberFormat = new Intl.NumberFormat(intlLocale(locale));

  const params = await searchParams;
  const departmentFilter = params.department ?? "all";
  const statusFilter = params.status ?? "all";
  const canManage = hasPermission(ctx, "job_title.manage");

  const supabase = await createServerSupabaseClient();
  const core = new CoreRepository(supabase);
  const titlesRepo = new JobTitleRepository(supabase);
  const [departments, titles, usage] = await Promise.all([
    core.listDepartments(ctx.organization.id),
    titlesRepo.listByOrganization(ctx.organization.id),
    titlesRepo.countUsageByTitle(ctx.organization.id),
  ]);
  const localName = (row: { name_ar: string; name_en?: string | null }) => pickLocalized(locale, row.name_ar, row.name_en);
  const otherName = (row: { name_ar: string; name_en?: string | null }) => (locale === "ar" ? row.name_en : row.name_ar);
  const deptName = new Map(departments.map((d) => [d.id, localName(d)]));

  const filtered = titles.filter((title) => {
    if (departmentFilter === "org" && title.department_id) return false;
    if (departmentFilter !== "all" && departmentFilter !== "org" && title.department_id !== departmentFilter) {
      return false;
    }
    if (statusFilter === "active" && !title.is_active) return false;
    if (statusFilter === "inactive" && title.is_active) return false;
    return true;
  });

  return (
    <PageContainer data-testid="job-titles-page" className="space-y-5">
      <PageHeader
        title={tj.title}
        description={tj.description}
        actions={
          <Link
            href="/departments"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-medium text-ink duration-150 hover:bg-surface-muted md:min-h-10"
          >
            <Building2 className="size-4 text-muted" aria-hidden />
            {tj.departmentsLink}
          </Link>
        }
      />

      <Card className="p-3 md:p-3">
        <form method="get" className="grid gap-2 md:grid-cols-3" data-testid="job-title-filters">
          <Field label={tj.filterDepartment}>
            <Select name="department" defaultValue={departmentFilter}>
              <option value="all">{tj.allDepartments}</option>
              <option value="org">{tj.orgWideTitles}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {localName(d)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tj.filterStatus}>
            <Select name="status" defaultValue={statusFilter}>
              <option value="all">{tj.statusAll}</option>
              <option value="active">{tj.statusActive}</option>
              <option value="inactive">{tj.statusInactive}</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" className="w-full md:w-auto">
              <Filter className="size-4" aria-hidden />
              {tj.filter}
            </Button>
          </div>
        </form>
      </Card>

      {canManage ? (
        <div className="mx-auto w-full max-w-3xl" data-testid="job-title-create-card">
          <div className="mt-surface p-4 md:p-6">
            <FormSection icon={Briefcase} title={tj.createTitle} description={tj.createDescription}>
              <ServerActionForm action={upsertJobTitleAction} className="grid gap-3 md:grid-cols-2">
                <Field label={tj.nameAr} required>
                  <Input name="name_ar" required dir="rtl" data-testid="job-title-name-ar" />
                </Field>
                <Field label={tj.nameEn} required>
                  <Input name="name_en" required dir="ltr" data-testid="job-title-name-en" />
                </Field>
                <Field label={tj.code} hint={tj.codeHint}>
                  <Input name="code" dir="ltr" data-testid="job-title-code" />
                </Field>
                <Field label={tj.department} hint={tj.departmentHint}>
                  <Select name="department_id" defaultValue="" data-testid="job-title-department">
                    <option value="">{tj.orgWide}</option>
                    {departments
                      .filter((d) => d.is_active)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {localName(d)}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={tj.sortOrder}>
                  <Input name="sort_order" type="number" min={0} defaultValue={0} />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" data-testid="job-title-create-submit">
                    {tj.submitCreate}
                  </Button>
                </div>
              </ServerActionForm>
            </FormSection>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title={tj.emptyTitle} description={tj.emptyDescription} />
      ) : (
        <div className="space-y-3" data-testid="job-title-list">
          {filtered.map((title) => (
            <div key={title.id} className="mt-surface p-4 md:p-5" data-testid={`job-title-card-${title.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"
                    aria-hidden
                  >
                    <Briefcase className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-ink" dir="auto">
                      {localName(title)}
                    </h2>
                    <p className="truncate text-sm text-muted" dir="auto">
                      {otherName(title)}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {title.department_id ? deptName.get(title.department_id) ?? tj.departmentFallback : tj.orgWide}
                      {title.code ? ` · ${title.code}` : ""}
                      {` · ${format(tj.usedBy, { count: numberFormat.format(usage.get(title.id) ?? 0) })}`}
                    </p>
                  </div>
                </div>
                <Badge tone={title.is_active ? "success" : "neutral"}>
                  {title.is_active ? tj.badgeActive : tj.badgeInactive}
                </Badge>
              </div>
              {canManage ? (
                <div className="mt-4 space-y-3 border-t border-line pt-3">
                  <ServerActionForm action={upsertJobTitleAction} className="grid gap-2 md:grid-cols-2">
                    <input type="hidden" name="titleId" value={title.id} />
                    <Field label={tj.nameAr}>
                      <Input name="name_ar" required dir="rtl" defaultValue={title.name_ar} />
                    </Field>
                    <Field label={tj.nameEn}>
                      <Input name="name_en" required dir="ltr" defaultValue={title.name_en} />
                    </Field>
                    <Field label={tj.code}>
                      <Input name="code" dir="ltr" defaultValue={title.code ?? ""} />
                    </Field>
                    <Field label={tj.department}>
                      <Select name="department_id" defaultValue={title.department_id ?? ""}>
                        <option value="">{tj.orgWide}</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {localName(d)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={tj.sortOrder}>
                      <Input name="sort_order" type="number" min={0} defaultValue={title.sort_order} />
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit" variant="secondary">
                        {tc.saveChanges}
                      </Button>
                    </div>
                  </ServerActionForm>
                  <ServerActionForm action={setJobTitleActiveAction} className="flex">
                    <input type="hidden" name="titleId" value={title.id} />
                    <input type="hidden" name="isActive" value={title.is_active ? "false" : "true"} />
                    <Button type="submit" variant="secondary" data-testid={`job-title-toggle-${title.id}`}>
                      {title.is_active ? tj.deactivate : tj.activate}
                    </Button>
                  </ServerActionForm>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
