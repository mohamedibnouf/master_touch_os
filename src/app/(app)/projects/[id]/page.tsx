import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  assignProjectMemberAction,
  createApprovalAction,
  startWorkflowAction,
  updateProjectStageAction,
} from "@/server/use-cases/platform";
import { DocumentSourceForm } from "@/components/documents/document-source-form";
import {
  DocumentDetailsLink,
  DocumentOpenControl,
  DocumentSourceBadge,
} from "@/components/documents/document-open-control";
import { documentStatusLabel } from "@/lib/ui/operational-labels";

const laterTabs = ["السلامة", "الجودة", "الاتصالات", "الذكاء الاصطناعي"];

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "project.read")) redirect("/login");

  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const project = await repo.getProject(ctx.organization.id, id);
  if (!project) notFound();

  const [stages, members, documents, users, definitions, health] = await Promise.all([
    repo.listProjectStages(project.id),
    repo.listProjectMembers(project.id),
    repo.listDocuments(ctx.organization.id, project.id),
    repo.listUsers(ctx.organization.id),
    supabase.from("workflow_definitions").select("id, name_ar").eq("status", "published"),
    supabase.rpc("compute_project_health", { p_project_id: project.id }),
  ]);

  const currentFiles = await repo.listCurrentDocumentFiles(
    ctx.organization.id,
    documents.map((d) => d.id),
  );
  const fileByDoc = new Map(currentFiles.map((row) => [row.document_id, row]));
  const canUploadDocs = hasPermission(ctx, "document.upload");
  const canOpenStorage = hasPermission(ctx, "document.read");

  const canSeeFinance =
    hasPermission(ctx, "finance.read") || hasPermission(ctx, "commercial_reports.read");
  const tabs = [
    { id: "overview", label: "نظرة عامة" },
    { id: "stages", label: "المراحل" },
    { id: "team", label: "الفريق" },
    { id: "engineering", label: "الهندسة" },
    { id: "documents", label: "المستندات" },
    { id: "rfis", label: "RFI" },
    { id: "submittals", label: "اعتمادات" },
    { id: "shop", label: "مخططات" },
    { id: "inspections", label: "فحوصات" },
    { id: "ncr", label: "NCR" },
    { id: "reports", label: "تقارير" },
    { id: "correspondence", label: "مراسلات" },
    { id: "commercial", label: "التجاري" },
    { id: "approvals", label: "الموافقات" },
    { id: "activity", label: "النشاط" },
  ];

  const [projectRfis, projectMats, projectShds, projectIrs, projectNcrs, projectReports, projectCors, projectPrs, projectPos, projectSupplierInv, commercialSummary, commercialHealth] =
    await Promise.all([
      supabase
        .from("rfis")
        .select("id, rfi_number, subject, status")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("material_submittals")
        .select("id, mat_number, material_category, status, official_decision")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("shop_drawings")
        .select("id, shd_number, drawing_title, status, approved_for_execution")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("inspection_requests")
        .select("id, ir_number, related_activity, status")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("ncrs")
        .select("id, ncr_number, severity, status, description")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("project_reports")
        .select("id, report_type, period_start, period_end, status")
        .eq("project_id", project.id)
        .order("period_start", { ascending: false })
        .limit(20),
      supabase
        .from("correspondence")
        .select("id, reference_number, subject, direction, status")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("purchase_requests")
        .select("id, pr_number, status, estimated_cost, currency")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("purchase_orders")
        .select("id, po_number, status, total, currency")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("supplier_invoices")
        .select("id, invoice_number, status, total, currency, due_date")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(20),
      canSeeFinance
        ? supabase.rpc("compute_project_commercial_summary", { p_project_id: project.id })
        : Promise.resolve({ data: null, error: null }),
      canSeeFinance
        ? supabase.rpc("compute_project_commercial_health", { p_project_id: project.id })
        : Promise.resolve({ data: null, error: null }),
    ]);

  const healthTone =
    health.data === "red" ? "danger" : health.data === "amber" ? "warning" : "success";
  const healthLabel =
    health.data === "red" ? "أحمر" : health.data === "amber" ? "كهرماني" : "أخضر";

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={project.name_ar}
        description={`${project.project_code} · ${project.name_en}`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="navy">{project.status}</Badge>
        <Badge tone={project.risk_level === "high" || project.risk_level === "critical" ? "danger" : "neutral"}>
          المخاطر: {project.risk_level}
        </Badge>
        <Badge>{project.progress_percentage}%</Badge>
        <Badge tone={healthTone as "danger" | "warning" | "success"}>صحة المشروع: {healthLabel}</Badge>
      </div>

      <div className="mb-6 min-w-0 max-w-full overflow-x-auto overscroll-x-contain border-b border-line pb-2 whitespace-nowrap">
        {tabs.map((item) => (
          <a
            key={item.id}
            href={`/projects/${project.id}?tab=${item.id}`}
            className={`shrink-0 rounded-md px-3 py-2 text-sm ${tab === item.id ? "bg-navy text-white" : "text-muted hover:bg-white"}`}
          >
            {item.label}
          </a>
        ))}
        {laterTabs.map((item) => (
          <span key={item} className="shrink-0 rounded-md px-3 py-2 text-sm text-muted/50">
            {item} · لاحقاً
          </span>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-semibold text-navy">البيانات الأساسية</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">الموقع</dt>
                <dd>{project.location ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">البداية</dt>
                <dd>{project.start_date ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">الانتهاء المخطط</dt>
                <dd>{project.planned_end_date ?? "—"}</dd>
              </div>
              {canSeeFinance ? (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">قيمة العقد</dt>
                    <dd>{project.contract_value ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">الميزانية</dt>
                    <dd>{project.budget ?? "—"}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold text-navy">الوصف</h2>
            <p className="text-sm leading-7 text-muted">{project.description ?? "لا يوجد وصف."}</p>
          </Card>
        </div>
      ) : null}

      {tab === "stages" ? (
        <Card className="p-0">
          {stages.length === 0 ? (
            <EmptyState title="لم تُنشأ مراحل لهذا المشروع." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-paper text-muted">
                  <tr>
                    <th className="px-4 py-3 text-right">#</th>
                    <th className="px-4 py-3 text-right">المرحلة</th>
                    <th className="px-4 py-3 text-right">الحالة</th>
                    <th className="px-4 py-3 text-right">تحديث</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((stage) => (
                    <tr key={stage.id} className="border-t border-line">
                      <td className="px-4 py-3">{stage.sequence}</td>
                      <td className="px-4 py-3">
                        {stage.name_ar}
                        <p className="text-xs text-muted">{stage.name_en}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge>{stage.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {hasPermission(ctx, "project.update") ? (
                          <ServerActionForm action={updateProjectStageAction} className="flex min-w-[220px] flex-col gap-2 sm:flex-row">
                            <input type="hidden" name="stageId" value={stage.id} />
                            <Select name="status" defaultValue={stage.status}>
                              <option value="not_started">لم تبدأ</option>
                              <option value="in_progress">جارية</option>
                              <option value="blocked">معلقة</option>
                              <option value="completed">مكتملة</option>
                              <option value="skipped">متجاوزة</option>
                            </Select>
                            <Button type="submit" variant="secondary">
                              حفظ
                            </Button>
                          </ServerActionForm>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "team" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-semibold text-navy">أعضاء الفريق</h2>
            {members.length === 0 ? (
              <p className="text-sm text-muted">لا يوجد أعضاء بعد.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {members.map((member) => {
                  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
                  return (
                    <li key={member.id} className="flex justify-between border-b border-line pb-2">
                      <span>{profile?.full_name_ar || profile?.full_name_en}</span>
                      <span className="text-muted">{member.role_label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {hasPermission(ctx, "project.manage_team") ? (
            <Card>
              <h2 className="mb-3 font-semibold text-navy">تعيين عضو</h2>
              <ServerActionForm action={assignProjectMemberAction} className="space-y-3">
                <input type="hidden" name="projectId" value={project.id} />
                <Field label="المستخدم">
                  <Select name="profileId" required>
                    {users.map((row) => {
                      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                      return (
                        <option key={row.profile_id} value={row.profile_id}>
                          {profile?.full_name_ar || row.profile_id}
                        </option>
                      );
                    })}
                  </Select>
                </Field>
                <Field label="الدور في المشروع">
                  <Input name="roleLabel" defaultValue="member" />
                </Field>
                <Button type="submit">تعيين</Button>
              </ServerActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "engineering" ? (
        <Card>
          <h2 className="mb-2 text-base font-semibold text-navy">عمليات الهندسة لهذا المشروع</h2>
          <p className="mb-4 text-sm text-muted">
            صحة المشروع: {healthLabel}. استخدم التبويبات أدناه أو لوحة الهندسة للإدخال الكامل.
          </p>
          <a
            href={`/engineering?project=${project.id}`}
            className="inline-flex rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white"
          >
            فتح لوحة الهندسة
          </a>
          <a
            href={`/document-control?q=${encodeURIComponent(project.project_code)}`}
            className="ms-3 inline-flex rounded-md border border-line px-3.5 py-2 text-sm font-medium"
          >
            سجل مراقبة الوثائق
          </a>
        </Card>
      ) : null}

      {tab === "rfis" ? (
        <ProjectMiniTable
          title="طلبات الاستفسار الفني"
          empty="لا توجد طلبات RFI."
          headers={["الرقم", "الموضوع", "الحالة"]}
          rows={(projectRfis.data ?? []).map((r) => [r.rfi_number, r.subject, r.status])}
          actionHref={`/engineering?module=rfi&project=${project.id}`}
          actionLabel="إدارة RFI"
        />
      ) : null}

      {tab === "submittals" ? (
        <ProjectMiniTable
          title="اعتمادات المواد"
          empty="لا توجد اعتمادات."
          headers={["الرقم", "الفئة", "الحالة", "القرار"]}
          rows={(projectMats.data ?? []).map((m) => [
            m.mat_number,
            m.material_category,
            m.status,
            m.official_decision ?? "—",
          ])}
          actionHref={`/engineering?module=mat&project=${project.id}`}
          actionLabel="إدارة الاعتمادات"
        />
      ) : null}

      {tab === "shop" ? (
        <ProjectMiniTable
          title="المخططات التنفيذية"
          empty="لا توجد مخططات."
          headers={["الرقم", "العنوان", "الحالة", "معتمد للتنفيذ"]}
          rows={(projectShds.data ?? []).map((s) => [
            s.shd_number,
            s.drawing_title,
            s.status,
            s.approved_for_execution ? "معتمد للتنفيذ" : "—",
          ])}
          actionHref={`/engineering?module=shd&project=${project.id}`}
          actionLabel="إدارة المخططات"
        />
      ) : null}

      {tab === "inspections" ? (
        <ProjectMiniTable
          title="طلبات الفحص"
          empty="لا توجد فحوصات."
          headers={["الرقم", "النشاط", "الحالة"]}
          rows={(projectIrs.data ?? []).map((i) => [i.ir_number, i.related_activity ?? "—", i.status])}
          actionHref={`/engineering?module=ir&project=${project.id}`}
          actionLabel="إدارة الفحوصات"
        />
      ) : null}

      {tab === "ncr" ? (
        <ProjectMiniTable
          title="تقارير عدم المطابقة"
          empty="لا توجد تقارير."
          headers={["الرقم", "الوصف", "الخطورة", "الحالة"]}
          rows={(projectNcrs.data ?? []).map((n) => [
            n.ncr_number,
            n.description.slice(0, 80),
            n.severity,
            n.status,
          ])}
          actionHref={`/engineering?module=ncr&project=${project.id}`}
          actionLabel="إدارة NCR"
        />
      ) : null}

      {tab === "reports" ? (
        <ProjectMiniTable
          title="تقارير المشروع"
          empty="لا توجد تقارير."
          headers={["النوع", "من", "إلى", "الحالة"]}
          rows={(projectReports.data ?? []).map((r) => [
            r.report_type,
            r.period_start,
            r.period_end,
            r.status,
          ])}
        />
      ) : null}

      {tab === "correspondence" ? (
        <ProjectMiniTable
          title="سجل المراسلات"
          empty="لا توجد مراسلات."
          headers={["المرجع", "الموضوع", "الاتجاه", "الحالة"]}
          rows={(projectCors.data ?? []).map((c) => [
            c.reference_number,
            c.subject,
            c.direction,
            c.status,
          ])}
        />
      ) : null}

      {tab === "commercial" ? (
        <div className="space-y-6">
          {canSeeFinance && commercialSummary.data ? (
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-navy">ملخص تجاري</h2>
                {commercialHealth.data ? (
                  <Badge
                    tone={
                      commercialHealth.data === "red"
                        ? "danger"
                        : commercialHealth.data === "amber"
                          ? "warning"
                          : "success"
                    }
                  >
                    صحة تجارية: {commercialHealth.data}
                  </Badge>
                ) : null}
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                {Object.entries(commercialSummary.data as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-line pb-2">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-medium text-navy">{Number(v).toLocaleString("ar-SA")}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-muted">
                الملخص التجاري يتطلب صلاحية المالية أو التقارير التجارية.
              </p>
            </Card>
          )}
          {canSeeFinance ? (
            <div className="flex flex-wrap gap-3">
              <Link href={`/projects/${id}/commercial/contract`} className="text-sm text-navy underline">
                العقد
              </Link>
              <Link href={`/projects/${id}/commercial/milestones`} className="text-sm text-navy underline">
                مراحل الدفع
              </Link>
              <Link href={`/projects/${id}/commercial/cashflow`} className="text-sm text-navy underline">
                التدفق النقدي
              </Link>
              <Link href="/finance/client-valuations" className="text-sm text-navy underline">
                مستخلصات العميل
              </Link>
              <Link href="/finance/variations" className="text-sm text-navy underline">
                أوامر التغيير
              </Link>
            </div>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <ProjectMiniTable
              title="طلبات الشراء"
              empty="لا توجد طلبات شراء."
              headers={["الرقم", "الحالة", "التكلفة"]}
              rows={(projectPrs.data ?? []).map((p) => [
                p.pr_number,
                p.status,
                p.estimated_cost != null ? `${p.estimated_cost} ${p.currency}` : "—",
              ])}
              actionHref="/procurement"
              actionLabel="المشتريات"
            />
            <ProjectMiniTable
              title="أوامر الشراء"
              empty="لا توجد أوامر شراء."
              headers={["الرقم", "الحالة", "الإجمالي"]}
              rows={(projectPos.data ?? []).map((p) => [
                p.po_number,
                p.status,
                `${p.total} ${p.currency}`,
              ])}
              actionHref="/procurement"
              actionLabel="المشتريات"
            />
          </div>
          {canSeeFinance ? (
            <ProjectMiniTable
              title="فواتير الموردين"
              empty="لا توجد فواتير."
              headers={["الرقم", "الحالة", "المبلغ", "الاستحقاق"]}
              rows={(projectSupplierInv.data ?? []).map((i) => [
                i.invoice_number,
                i.status,
                `${i.total} ${i.currency}`,
                i.due_date ?? "—",
              ])}
              actionHref="/finance"
              actionLabel="المالية"
            />
          ) : null}
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="space-y-4" data-testid="project-documents-panel">
          <Card>
            <h2 className="mb-3 font-semibold text-navy">مستندات المشروع</h2>
            {documents.length === 0 ? (
              <EmptyState title="لا توجد مستندات مرتبطة بهذا المشروع بعد." />
            ) : (
              <>
                <ul className="space-y-3 md:hidden">
                  {documents.map((doc) => {
                    const file = fileByDoc.get(doc.id) ?? null;
                    return (
                      <li key={doc.id} className="rounded-lg border border-line p-3">
                        <p className="font-medium text-navy">{doc.title}</p>
                        <p className="mt-1 text-xs text-muted">
                          {doc.document_number ? `${doc.document_number} · ` : ""}
                          {doc.category} · {doc.current_revision} · {documentStatusLabel(doc.status)}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {new Date(doc.updated_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <DocumentSourceBadge source={file?.file_source} />
                          <DocumentOpenControl documentId={doc.id} file={file} canOpenStorage={canOpenStorage} />
                          <DocumentDetailsLink documentId={doc.id} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <TableScroll className="hidden rounded-lg border border-line md:block">
                  <table className="min-w-full text-sm">
                    <thead className="bg-paper text-right text-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">المستند</th>
                        <th className="px-3 py-2 font-medium">التصنيف</th>
                        <th className="px-3 py-2 font-medium">الإصدار</th>
                        <th className="px-3 py-2 font-medium">الحالة</th>
                        <th className="px-3 py-2 font-medium">التحديث</th>
                        <th className="px-3 py-2 font-medium">المصدر</th>
                        <th className="px-3 py-2 font-medium">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => {
                        const file = fileByDoc.get(doc.id) ?? null;
                        return (
                          <tr key={doc.id} className="border-t border-line">
                            <td className="px-3 py-2">
                              <p className="font-medium text-navy">{doc.title}</p>
                              {doc.document_number ? (
                                <p className="text-xs text-muted">{doc.document_number}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">{doc.category}</td>
                            <td className="px-3 py-2">{doc.current_revision}</td>
                            <td className="px-3 py-2">{documentStatusLabel(doc.status)}</td>
                            <td className="px-3 py-2 text-muted">
                              {new Date(doc.updated_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                            </td>
                            <td className="px-3 py-2">
                              <DocumentSourceBadge source={file?.file_source} />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <DocumentOpenControl
                                  documentId={doc.id}
                                  file={file}
                                  canOpenStorage={canOpenStorage}
                                />
                                <DocumentDetailsLink documentId={doc.id} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>
                {documents.length >= 50 ? (
                  <p className="mt-2 text-xs text-muted">يُعرض أحدث 50 مستنداً لهذا المشروع.</p>
                ) : null}
              </>
            )}
          </Card>
          {canUploadDocs ? (
            <Card data-testid="project-add-document">
              <h2 className="mb-4 font-semibold text-navy">إضافة مستند</h2>
              <DocumentSourceForm projectId={project.id} />
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "approvals" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {hasPermission(ctx, "approval.create") ? (
            <Card>
              <h2 className="mb-3 font-semibold text-navy">طلب موافقة</h2>
              <ServerActionForm action={createApprovalAction} className="space-y-3">
                <input type="hidden" name="entityType" value="project" />
                <input type="hidden" name="entityId" value={project.id} />
                <Field label="العنوان">
                  <Input name="title" defaultValue={`موافقة مشروع ${project.project_code}`} required />
                </Field>
                <Field label="المعتمد">
                  <Select name="approverProfileId" required>
                    {users.map((row) => {
                      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                      return (
                        <option key={row.profile_id} value={row.profile_id}>
                          {profile?.full_name_ar || row.profile_id}
                        </option>
                      );
                    })}
                  </Select>
                </Field>
                <Button type="submit">إنشاء طلب</Button>
              </ServerActionForm>
            </Card>
          ) : null}
          {hasPermission(ctx, "workflow.start") ? (
            <Card>
              <h2 className="mb-3 font-semibold text-navy">بدء مسار عمل</h2>
              <ServerActionForm action={startWorkflowAction} className="space-y-3">
                <input type="hidden" name="entityType" value="project" />
                <input type="hidden" name="entityId" value={project.id} />
                <Field label="القالب">
                  <Select name="definitionId" required>
                    {(definitions.data ?? []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name_ar}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit">بدء</Button>
              </ServerActionForm>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "activity" ? (
        <Card>
          <p className="text-sm text-muted">
            النشاط التفصيلي يظهر في السجل العام عند توفر صلاحية التدقيق، مع الحفاظ على الطوابع الزمنية التاريخية.
          </p>
        </Card>
      ) : null}
    </PageContainer>
  );
}

function ProjectMiniTable({
  title,
  empty,
  headers,
  rows,
  actionHref,
  actionLabel,
}: {
  title: string;
  empty: string;
  headers: string[];
  rows: string[][];
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-navy">{title}</h2>
        {actionHref ? (
          <a href={actionHref} className="text-sm text-navy underline">
            {actionLabel ?? "إدارة"}
          </a>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-paper text-right text-muted">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 ${j === 0 ? "font-medium text-navy" : ""}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
