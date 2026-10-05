import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
} from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  closeNcrAction,
  createInspectionRequestAction,
  createMaterialSubmittalAction,
  createMethodStatementAction,
  createNcrAction,
  createRfiAction,
  createShopDrawingAction,
  recordInspectionResultAction,
  respondRfiAction,
  submitRfiAction,
} from "@/server/use-cases/engineering";

export default async function EngineeringPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; module?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "engineering.read") && !hasPermission(ctx, "rfi.read")) {
    redirect("/");
  }

  const { project: projectFilter, module: moduleFilter = "rfi" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const now = new Date().toISOString();

  const [projects, disciplines] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, name_ar")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("engineering_disciplines")
      .select("code, name_ar")
      .eq("organization_id", ctx.organization.id)
      .eq("is_active", true)
      .order("code"),
  ]);

  let rfiQuery = supabase
    .from("rfis")
    .select("id, rfi_number, subject, status, priority, response_required_by, response, project_id")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (projectFilter) rfiQuery = rfiQuery.eq("project_id", projectFilter);

  let matQuery = supabase
    .from("material_submittals")
    .select("id, mat_number, material_category, status, official_decision, required_approval_date")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (projectFilter) matQuery = matQuery.eq("project_id", projectFilter);

  let shdQuery = supabase
    .from("shop_drawings")
    .select("id, shd_number, drawing_title, status, official_decision, approved_for_execution")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (projectFilter) shdQuery = shdQuery.eq("project_id", projectFilter);

  let msQuery = supabase
    .from("method_statements")
    .select("id, ms_number, activity, status, official_decision")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (projectFilter) msQuery = msQuery.eq("project_id", projectFilter);

  let irQuery = supabase
    .from("inspection_requests")
    .select("id, ir_number, related_activity, status, location")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (projectFilter) irQuery = irQuery.eq("project_id", projectFilter);

  let ncrQuery = supabase
    .from("ncrs")
    .select("id, ncr_number, severity, status, description")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (projectFilter) ncrQuery = ncrQuery.eq("project_id", projectFilter);

  const [rfis, mats, shds, mss, irs, ncrs, pendingDocs] = await Promise.all([
    rfiQuery,
    matQuery,
    shdQuery,
    msQuery,
    irQuery,
    ncrQuery,
    supabase
      .from("documents")
      .select("id, document_number, title, type_code, official_decision")
      .eq("organization_id", ctx.organization.id)
      .eq("is_register_controlled", true)
      .in("official_decision", ["C", "D"])
      .is("archived_at", null)
      .limit(20),
  ]);

  const overdueRfis = (rfis.data ?? []).filter(
    (r) =>
      r.response_required_by &&
      r.response_required_by < now &&
      ["submitted", "under_review"].includes(r.status),
  );

  const defaultProject = projectFilter || projects.data?.[0]?.id || "";
  const modules = [
    { id: "rfi", label: "RFI" },
    { id: "mat", label: "اعتماد مواد" },
    { id: "shd", label: "مخططات تنفيذية" },
    { id: "ms", label: "طرق تنفيذ" },
    { id: "ir", label: "فحوصات" },
    { id: "ncr", label: "NCR" },
  ];

  const projectQs = projectFilter ? `&project=${projectFilter}` : "";

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="الهندسة"
        description="طلبات الاستفسار، الاعتمادات، المخططات، الفحوصات، وعدم المطابقة"
        actions={
          <Link href="/document-control" className="text-sm text-navy underline">
            مراقبة الوثائق
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <p className="text-sm text-muted">RFI متأخرة</p>
          <p className="mt-2 text-3xl font-semibold text-danger">{overdueRfis.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">مواد معلّقة</p>
          <p className="mt-2 text-3xl font-semibold text-navy">
            {(mats.data ?? []).filter((m) => !["approved", "closed", "rejected"].includes(m.status)).length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">معتمد للتنفيذ</p>
          <p className="mt-2 text-3xl font-semibold text-success">
            {(shds.data ?? []).filter((s) => s.approved_for_execution).length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">فحوصات فاشلة</p>
          <p className="mt-2 text-3xl font-semibold text-danger">
            {(irs.data ?? []).filter((i) => i.status === "failed").length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">NCR / إعادة تقديم</p>
          <p className="mt-2 text-3xl font-semibold text-warning">
            {(ncrs.data ?? []).filter((n) => n.status !== "closed").length + (pendingDocs.data ?? []).length}
          </p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-line pb-2">
        {modules.map((m) => (
          <a
            key={m.id}
            href={`/engineering?module=${m.id}${projectQs}`}
            className={`rounded-md px-3 py-1.5 text-sm ${
              moduleFilter === m.id ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-muted"
            }`}
          >
            {m.label}
          </a>
        ))}
      </div>

      {defaultProject && moduleFilter === "rfi" && hasPermission(ctx, "rfi.create") ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">إنشاء طلب استفسار فني (RFI)</h2>
          <ServerActionForm action={createRfiAction} className="grid gap-3 md:grid-cols-2">
            <Field label="المشروع">
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التخصص">
              <Select name="disciplineCode" required defaultValue="GENERAL">
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الموضوع">
              <Input name="subject" required />
            </Field>
            <Field label="الأولوية">
              <Select name="priority" defaultValue="medium">
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="critical">حرجة</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="السؤال">
                <Input name="question" required />
              </Field>
            </div>
            <Button type="submit">إنشاء RFI</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {defaultProject && moduleFilter === "mat" && hasPermission(ctx, "submittal.create") ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">إنشاء طلب اعتماد مواد (MAT)</h2>
          <ServerActionForm action={createMaterialSubmittalAction} className="grid gap-3 md:grid-cols-2">
            <Field label="المشروع">
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التخصص">
              <Select name="disciplineCode" defaultValue="GENERAL">
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="فئة المادة">
              <Input name="materialCategory" required />
            </Field>
            <Field label="الشركة المصنّعة">
              <Input name="manufacturer" />
            </Field>
            <div className="md:col-span-2">
              <Field label="الوصف الفني">
                <Input name="technicalDescription" />
              </Field>
            </div>
            <Button type="submit">تسجيل اعتماد مواد</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {defaultProject && moduleFilter === "shd" && hasPermission(ctx, "shop_drawing.create") ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">إنشاء مخطط تنفيذي (SHD)</h2>
          <ServerActionForm action={createShopDrawingAction} className="grid gap-3 md:grid-cols-2">
            <Field label="المشروع">
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التخصص">
              <Select name="disciplineCode" defaultValue="ELEC">
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="عنوان المخطط">
              <Input name="drawingTitle" required />
            </Field>
            <Field label="رقم المخطط">
              <Input name="drawingNumber" />
            </Field>
            <Field label="الطابق / المنطقة">
              <Input name="floorZone" />
            </Field>
            <Button type="submit">تسجيل مخطط</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {defaultProject && moduleFilter === "ms" && hasPermission(ctx, "method_statement.create") ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">إنشاء طريقة تنفيذ (MS)</h2>
          <ServerActionForm action={createMethodStatementAction} className="grid gap-3 md:grid-cols-2">
            <Field label="المشروع">
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التخصص">
              <Select name="disciplineCode" defaultValue="GENERAL">
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="النشاط">
              <Input name="activity" required />
            </Field>
            <Field label="النطاق">
              <Input name="scope" />
            </Field>
            <div className="md:col-span-2">
              <Field label="الإجراء">
                <Input name="methodProcedure" />
              </Field>
            </div>
            <Button type="submit">تسجيل طريقة تنفيذ</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {defaultProject && moduleFilter === "ir" && hasPermission(ctx, "inspection.create") ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">إنشاء طلب فحص (IR)</h2>
          <ServerActionForm action={createInspectionRequestAction} className="grid gap-3 md:grid-cols-2">
            <Field label="المشروع">
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التخصص">
              <Select name="disciplineCode" defaultValue="GENERAL">
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="النشاط">
              <Input name="relatedActivity" required />
            </Field>
            <Field label="الموقع">
              <Input name="location" />
            </Field>
            <Field label="تاريخ الفحص المطلوب">
              <Input name="inspectionDate" type="date" />
            </Field>
            <Button type="submit">تسجيل طلب فحص</Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {defaultProject && moduleFilter === "ncr" && hasPermission(ctx, "ncr.create") ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">إنشاء تقرير عدم مطابقة (NCR)</h2>
          <ServerActionForm action={createNcrAction} className="grid gap-3 md:grid-cols-2">
            <Field label="المشروع">
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التخصص">
              <Select name="disciplineCode" defaultValue="GENERAL">
                {(disciplines.data ?? []).map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="الوصف">
                <Input name="description" required />
              </Field>
            </div>
            <Field label="الخطورة">
              <Select name="severity" defaultValue="medium">
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="critical">حرجة</option>
              </Select>
            </Field>
            <Button type="submit" variant="danger">
              تسجيل NCR
            </Button>
          </ServerActionForm>
        </Card>
      ) : null}

      {moduleFilter === "rfi" ? (
        <Card>
          <h2 className="mb-4 text-base font-semibold text-navy">سجل طلبات الاستفسار الفني</h2>
          {(rfis.data ?? []).length === 0 ? (
            <EmptyState title="لا توجد طلبات استفسار." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-paper text-right text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">الرقم</th>
                    <th className="px-3 py-2 font-medium">الموضوع</th>
                    <th className="px-3 py-2 font-medium">الحالة</th>
                    <th className="px-3 py-2 font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {(rfis.data ?? []).map((rfi) => {
                    const overdue =
                      rfi.response_required_by &&
                      rfi.response_required_by < now &&
                      ["submitted", "under_review"].includes(rfi.status);
                    return (
                      <tr key={rfi.id} className="border-t border-line align-top">
                        <td className="px-3 py-2 font-medium text-navy">{rfi.rfi_number}</td>
                        <td className="px-3 py-2">{rfi.subject}</td>
                        <td className="px-3 py-2">
                          <Badge tone={overdue ? "danger" : "navy"}>{rfi.status}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-2">
                            {["draft", "internal_review"].includes(rfi.status) &&
                            hasPermission(ctx, "rfi.submit") ? (
                              <ServerActionForm action={submitRfiAction}>
                                <input type="hidden" name="rfiId" value={rfi.id} />
                                <Button type="submit" variant="secondary">
                                  تقديم
                                </Button>
                              </ServerActionForm>
                            ) : null}
                            {["submitted", "under_review"].includes(rfi.status) &&
                            hasPermission(ctx, "rfi.respond") ? (
                              <ServerActionForm action={respondRfiAction} className="flex gap-2">
                                <input type="hidden" name="rfiId" value={rfi.id} />
                                <Input name="response" placeholder="الرد" required />
                                <Button type="submit">رد</Button>
                              </ServerActionForm>
                            ) : null}
                            {rfi.response ? (
                              <p className="text-xs text-muted">الرد محفوظ · السؤال الأصلي لا يُستبدل</p>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {moduleFilter === "mat" ? (
        <RegisterTable
          title="اعتمادات المواد"
          empty="لا توجد اعتمادات مواد."
          headers={["الرقم", "الفئة", "الحالة", "القرار"]}
          rows={(mats.data ?? []).map((m) => [
            m.mat_number,
            m.material_category,
            m.status,
            m.official_decision ?? "—",
          ])}
        />
      ) : null}

      {moduleFilter === "shd" ? (
        <RegisterTable
          title="المخططات التنفيذية"
          empty="لا توجد مخططات."
          headers={["الرقم", "العنوان", "الحالة", "معتمد للتنفيذ"]}
          rows={(shds.data ?? []).map((s) => [
            s.shd_number,
            s.drawing_title,
            s.status,
            s.approved_for_execution ? "نعم — معتمد للتنفيذ" : "لا",
          ])}
        />
      ) : null}

      {moduleFilter === "ms" ? (
        <RegisterTable
          title="طرق التنفيذ"
          empty="لا توجد طرق تنفيذ."
          headers={["الرقم", "النشاط", "الحالة", "القرار"]}
          rows={(mss.data ?? []).map((m) => [
            m.ms_number,
            m.activity,
            m.status,
            m.official_decision ?? "—",
          ])}
        />
      ) : null}

      {moduleFilter === "ir" ? (
        <Card>
          <h2 className="mb-4 text-base font-semibold text-navy">طلبات الفحص</h2>
          {(irs.data ?? []).length === 0 ? (
            <EmptyState title="لا توجد طلبات فحص." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-paper text-right text-muted">
                  <tr>
                    <th className="px-3 py-2">الرقم</th>
                    <th className="px-3 py-2">النشاط</th>
                    <th className="px-3 py-2">الحالة</th>
                    <th className="px-3 py-2">نتيجة</th>
                  </tr>
                </thead>
                <tbody>
                  {(irs.data ?? []).map((ir) => (
                    <tr key={ir.id} className="border-t border-line">
                      <td className="px-3 py-2 font-medium text-navy">{ir.ir_number}</td>
                      <td className="px-3 py-2">{ir.related_activity}</td>
                      <td className="px-3 py-2">
                        <Badge tone={ir.status === "failed" ? "danger" : "navy"}>{ir.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {hasPermission(ctx, "inspection.perform") &&
                        ["ready", "submitted", "scheduled", "inspected"].includes(ir.status) ? (
                          <ServerActionForm action={recordInspectionResultAction} className="flex gap-2">
                            <input type="hidden" name="inspectionId" value={ir.id} />
                            <Select name="result" defaultValue="passed">
                              <option value="passed">ناجح</option>
                              <option value="passed_with_comments">ناجح مع ملاحظات</option>
                              <option value="failed">فاشل</option>
                            </Select>
                            <Input name="comments" placeholder="ملاحظات" />
                            <Button type="submit" variant="secondary">
                              تسجيل
                            </Button>
                          </ServerActionForm>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {moduleFilter === "ncr" ? (
        <Card>
          <h2 className="mb-4 text-base font-semibold text-navy">تقارير عدم المطابقة</h2>
          {(ncrs.data ?? []).length === 0 ? (
            <EmptyState title="لا توجد تقارير." />
          ) : (
            <ul className="space-y-3">
              {(ncrs.data ?? []).map((ncr) => (
                <li key={ncr.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                  <div>
                    <p className="font-medium text-navy">{ncr.ncr_number}</p>
                    <p className="text-sm text-muted">{ncr.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={ncr.severity === "critical" ? "danger" : "warning"}>
                      {ncr.severity} · {ncr.status}
                    </Badge>
                    {ncr.status !== "closed" && hasPermission(ctx, "ncr.close") ? (
                      <ServerActionForm action={closeNcrAction} className="flex gap-2">
                        <input type="hidden" name="ncrId" value={ncr.id} />
                        <Input name="verification" placeholder="التحقق" required />
                        <Button type="submit" variant="secondary">
                          إغلاق
                        </Button>
                      </ServerActionForm>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </PageContainer>
  );
}

function RegisterTable({
  title,
  empty,
  headers,
  rows,
}: {
  title: string;
  empty: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold text-navy">{title}</h2>
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
