import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, FolderKanban, Plus, Search } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { projectRiskLabel, projectRiskTone, projectStatusLabel, projectStatusTone } from "@/lib/ui/operational-labels";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const STATUSES = ["draft", "active", "on_hold", "completed", "cancelled"] as const;
const RISKS = ["low", "medium", "high", "critical"] as const;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; risk?: string; manager?: string; page?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const { t, locale } = await getI18n();
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
  const tp = t.projects;

  // Paging keeps the active filters.
  const pageHref = (target: number) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.risk) qs.set("risk", params.risk);
    if (params.manager) qs.set("manager", params.manager);
    qs.set("page", String(target));
    return `/projects?${qs.toString()}`;
  };

  return (
    <PageContainer data-testid="projects-page" className="space-y-5">
      <PageHeader
        title={tp.title}
        description={tp.description}
        actions={
          canCreate ? (
            <Link href="/projects/new">
              <Button>
                <Plus className="size-4" aria-hidden />
                {tp.create}
              </Button>
            </Link>
          ) : null
        }
      />

      <Card className="p-3 md:p-3">
        <form className="grid gap-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={params.q} placeholder={tp.searchPlaceholder} className="ps-9" />
          </div>
          <Select name="status" defaultValue={params.status ?? ""}>
            <option value="">{tp.allStatuses}</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {projectStatusLabel(status, locale)}
              </option>
            ))}
          </Select>
          <Select name="risk" defaultValue={params.risk ?? ""}>
            <option value="">{tp.allRisks}</option>
            {RISKS.map((risk) => (
              <option key={risk} value={risk}>
                {projectRiskLabel(risk, locale)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {tp.filter}
          </Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title={tp.empty} />
      ) : (
        <Card className="overflow-hidden p-0 md:p-0">
          <TableScroll>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-start">
                <tr>
                  <th className="px-5 py-3 text-start font-semibold">{tp.colCode}</th>
                  <th className="px-5 py-3 text-start font-semibold">{tp.colProject}</th>
                  <th className="px-5 py-3 text-start font-semibold">{tp.colStatus}</th>
                  <th className="px-5 py-3 text-start font-semibold">{tp.colRisk}</th>
                  <th className="px-5 py-3 text-start font-semibold">{tp.colProgress}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((project) => {
                  const name = pickLocalized(locale, project.name_ar, project.name_en);
                  const altName = locale === "ar" ? project.name_en : project.name_ar;
                  const progress = Math.min(100, Math.max(0, project.progress_percentage));
                  return (
                    <tr key={project.id} className="border-t border-line duration-150 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/projects/${project.id}`}
                          className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-ink hover:text-primary"
                        >
                          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary-soft text-primary">
                            <FolderKanban className="size-3.5" aria-hidden />
                          </span>
                          <span dir="ltr">{project.project_code}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-3.5">
                        <Link href={`/projects/${project.id}`} className="font-medium text-ink hover:text-primary" dir="auto">
                          {name}
                        </Link>
                        {altName && altName !== name ? (
                          <p className="mt-0.5 text-xs text-muted" dir="auto">
                            {altName}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status, locale)}</Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge tone={projectRiskTone(project.risk_level)}>
                          {projectRiskLabel(project.risk_level, locale)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex min-w-[8rem] items-center gap-2.5">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-strong">
                            <div
                              className="mt-progress-fill h-full rounded-full bg-gradient-to-r from-primary to-brand rtl:bg-gradient-to-l"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="w-9 text-end text-xs font-medium tabular-nums text-muted">
                            {project.progress_percentage}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm text-muted">
        <p>{format(tp.summary, { total, page, pages })}</p>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={pageHref(page - 1)}>
              <Button variant="secondary" className="px-3">
                <ChevronRight className="size-4 ltr:-scale-x-100" aria-hidden />
                {tp.previous}
              </Button>
            </Link>
          ) : null}
          {page < pages ? (
            <Link href={pageHref(page + 1)}>
              <Button variant="secondary" className="px-3">
                {tp.next}
                <ChevronLeft className="size-4 ltr:-scale-x-100" aria-hidden />
              </Button>
            </Link>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}
