import Link from "next/link";
import { Briefcase } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { FormSection } from "@/components/ui/form-section";
import { PageContainer } from "@/components/layout/page-container";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { JobTitleRepository } from "@/server/repositories/job-title.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { setJobTitleActiveAction, upsertJobTitleAction } from "@/server/use-cases/hr";

export default async function JobTitlesPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string; status?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const canRead = hasPermission(ctx, "job_title.read") || hasPermission(ctx, "job_title.manage");
  if (!canRead) redirect("/");

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
  const deptName = new Map(departments.map((d) => [d.id, d.name_ar]));

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
        title="المسميات الوظيفية"
        description="كتالوج مسميات المنشأة — مستقل عن صلاحيات النظام"
        actions={
          <Link
            href="/departments"
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line bg-white px-4 text-sm font-medium text-navy md:min-h-10"
          >
            الإدارات
          </Link>
        }
      />

      <form method="get" className="grid gap-2 md:grid-cols-3" data-testid="job-title-filters">
        <Field label="الإدارة">
          <Select name="department" defaultValue={departmentFilter}>
            <option value="all">كل الإدارات</option>
            <option value="org">مسميات عامة</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name_ar}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الحالة">
          <Select name="status" defaultValue={statusFilter}>
            <option value="all">الكل</option>
            <option value="active">نشطة</option>
            <option value="inactive">غير نشطة</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" className="w-full md:w-auto">
            تصفية
          </Button>
        </div>
      </form>

      {canManage ? (
        <div className="mx-auto w-full max-w-3xl" data-testid="job-title-create-card">
          <div className="mt-surface p-4 md:p-6">
            <FormSection
              icon={Briefcase}
              title="إنشاء مسمى وظيفي"
              description="اترك الإدارة فارغة ليكون المسمى عاماً لجميع الإدارات."
            >
              <ServerActionForm action={upsertJobTitleAction} className="grid gap-3 md:grid-cols-2">
                <Field label="الاسم بالعربية" required>
                  <Input name="name_ar" required data-testid="job-title-name-ar" />
                </Field>
                <Field label="الاسم بالإنجليزية" required>
                  <Input name="name_en" required data-testid="job-title-name-en" />
                </Field>
                <Field label="الكود" hint="اختياري وفريد داخل المنشأة">
                  <Input name="code" data-testid="job-title-code" />
                </Field>
                <Field label="الإدارة" hint="فارغ = مسمى عام لجميع الإدارات">
                  <Select name="department_id" defaultValue="" data-testid="job-title-department">
                    <option value="">مسمى عام لجميع الإدارات</option>
                    {departments
                      .filter((d) => d.is_active)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name_ar}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="الترتيب">
                  <Input name="sort_order" type="number" min={0} defaultValue={0} />
                </Field>
                <div className="flex items-end">
                  <Button type="submit" data-testid="job-title-create-submit">
                    إنشاء المسمى
                  </Button>
                </div>
              </ServerActionForm>
            </FormSection>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title="لا توجد مسميات مطابقة."
          description="أنشئ مسمى للصيانة أو أي إدارة، أو أضف مسمى عاماً للمنشأة."
        />
      ) : (
        <div className="space-y-3" data-testid="job-title-list">
          {filtered.map((title) => (
            <div key={title.id} className="mt-surface p-4 md:p-5" data-testid={`job-title-card-${title.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-navy" dir="auto">
                    {title.name_ar}
                  </h2>
                  <p className="truncate text-sm text-muted" dir="auto">
                    {title.name_en}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {title.department_id ? deptName.get(title.department_id) ?? "إدارة" : "مسمى عام لجميع الإدارات"}
                    {title.code ? ` · ${title.code}` : ""}
                    {` · مستخدم في ${usage.get(title.id) ?? 0} موظف`}
                  </p>
                </div>
                <Badge tone={title.is_active ? "success" : "neutral"}>
                  {title.is_active ? "نشط" : "غير نشط"}
                </Badge>
              </div>
              {canManage ? (
                <div className="mt-4 space-y-3 border-t border-line pt-3">
                  <ServerActionForm action={upsertJobTitleAction} className="grid gap-2 md:grid-cols-2">
                    <input type="hidden" name="titleId" value={title.id} />
                    <Field label="الاسم بالعربية">
                      <Input name="name_ar" required defaultValue={title.name_ar} />
                    </Field>
                    <Field label="الاسم بالإنجليزية">
                      <Input name="name_en" required defaultValue={title.name_en} />
                    </Field>
                    <Field label="الكود">
                      <Input name="code" defaultValue={title.code ?? ""} />
                    </Field>
                    <Field label="الإدارة">
                      <Select name="department_id" defaultValue={title.department_id ?? ""}>
                        <option value="">مسمى عام لجميع الإدارات</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name_ar}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="الترتيب">
                      <Input name="sort_order" type="number" min={0} defaultValue={title.sort_order} />
                    </Field>
                    <div className="flex items-end">
                      <Button type="submit" variant="secondary">
                        حفظ التعديلات
                      </Button>
                    </div>
                  </ServerActionForm>
                  <ServerActionForm action={setJobTitleActiveAction} className="flex">
                    <input type="hidden" name="titleId" value={title.id} />
                    <input type="hidden" name="isActive" value={title.is_active ? "false" : "true"} />
                    <Button type="submit" variant="secondary" data-testid={`job-title-toggle-${title.id}`}>
                      {title.is_active ? "تعطيل المسمى" : "تفعيل المسمى"}
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
