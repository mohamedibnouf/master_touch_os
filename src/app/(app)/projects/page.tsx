import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { projectRiskLabel, projectRiskTone, projectStatusLabel, projectStatusTone } from "@/lib/ui/operational-labels";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; risk?: string; manager?: string; page?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  authorizeRead(ctx);

  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const { rows, total } = await repo.listProjects({
    organizationId: ctx.organization.id,
    search: params.q,
    status: params.status,
    risk: params.risk,
    managerId: params.manager,
    page,
    pageSize: 20,
  });
  const canCreate = hasPermission(ctx, "project.create");
  const pages = Math.max(1, Math.ceil(total / 20));

  return (
    <PageContainer data-testid="projects-page" className="space-y-5">
      <PageHeader
        title="المشاريع"
        description="سجل مشاريع الشركة مع التصفية والترقيم"
        actions={
          canCreate ? (
            <Link href="/projects/new">
              <Button>إنشاء مشروع</Button>
            </Link>
          ) : null
        }
      />

      <Card className="mb-5">
        <form className="grid gap-3 md:grid-cols-4">
          <Input name="q" defaultValue={params.q} placeholder="بحث بالاسم أو الرمز" />
          <Select name="status" defaultValue={params.status ?? ""}>
            <option value="">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="active">نشط</option>
            <option value="on_hold">متوقف</option>
            <option value="completed">مكتمل</option>
            <option value="cancelled">ملغى</option>
          </Select>
          <Select name="risk" defaultValue={params.risk ?? ""}>
            <option value="">كل مستويات المخاطر</option>
            <option value="low">منخفض</option>
            <option value="medium">متوسط</option>
            <option value="high">مرتفع</option>
            <option value="critical">حرج</option>
          </Select>
          <Button type="submit" variant="secondary">
            تصفية
          </Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="لا توجد مشاريع مطابقة." />
      ) : (
        <Card className="p-0">
          <TableScroll>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-paper text-right text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">الرمز</th>
                <th className="px-4 py-3 font-medium">المشروع</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">المخاطر</th>
                <th className="px-4 py-3 font-medium">التقدم</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((project) => (
                <tr key={project.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-navy">
                    <Link href={`/projects/${project.id}`}>{project.project_code}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/projects/${project.id}`} className="hover:underline">
                      {project.name_ar}
                    </Link>
                    <p className="text-xs text-muted">{project.name_en}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={projectRiskTone(project.risk_level)}>
                      {projectRiskLabel(project.risk_level)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-[7rem] items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-strong">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(100, Math.max(0, project.progress_percentage))}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-xs text-muted">{project.progress_percentage}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableScroll>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-muted">
        <p>
          {total} مشروع · صفحة {page} من {pages}
        </p>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={`/projects?page=${page - 1}`} className="underline">
              السابق
            </Link>
          ) : null}
          {page < pages ? (
            <Link href={`/projects?page=${page + 1}`} className="underline">
              التالي
            </Link>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}

function authorizeRead(ctx: NonNullable<Awaited<ReturnType<typeof getAuthContext>>>) {
  if (!hasPermission(ctx, "project.read")) {
    redirect("/");
  }
}
