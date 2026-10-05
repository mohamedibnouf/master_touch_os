import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  applyDocumentDecisionAction,
  createTransmittalAction,
  issueTransmittalAction,
  reviseDocumentAction,
} from "@/server/use-cases/engineering";

export default async function DocumentControlPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; overdue?: string; q?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "document_control.read") && !hasPermission(ctx, "document.read")) {
    redirect("/");
  }

  const { type, overdue, q } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const now = new Date().toISOString();

  let query = supabase
    .from("documents")
    .select(
      "id, document_number, title, type_code, current_revision, status, submission_status, official_decision, response_due_at, project_id, projects(project_code, name_ar)",
    )
    .eq("organization_id", ctx.organization.id)
    .eq("is_register_controlled", true)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (type) query = query.eq("type_code", type);
  if (q) query = query.or(`document_number.ilike.%${q}%,title.ilike.%${q}%`);

  const [{ data: rows }, { data: transmittals }, { data: projects }] = await Promise.all([
    query,
    supabase
      .from("transmittals")
      .select("id, transmittal_number, subject, recipient, status, project_id, issued_at")
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("projects")
      .select("id, project_code, name_ar")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .limit(40),
  ]);

  const filtered = overdue
    ? (rows ?? []).filter(
        (d) =>
          d.response_due_at &&
          d.response_due_at < now &&
          ["submitted", "under_review"].includes(d.submission_status),
      )
    : (rows ?? []);

  const awaiting = (rows ?? []).filter((d) =>
    ["submitted", "under_review", "ready"].includes(d.submission_status),
  ).length;
  const returnedC = (rows ?? []).filter((d) => d.official_decision === "C").length;
  const rejectedD = (rows ?? []).filter((d) => d.official_decision === "D").length;
  const approved = (rows ?? []).filter((d) => d.official_decision === "A" || d.official_decision === "B")
    .length;
  const draftTrn = (transmittals ?? []).filter((t) => t.status === "draft").length;

  const canApprove = hasPermission(ctx, "document.approve");
  const canRevise = hasPermission(ctx, "document_control.revise");
  const canCreateTrn = hasPermission(ctx, "transmittal.create");
  const canIssueTrn = hasPermission(ctx, "transmittal.issue");
  const defaultProject = projects?.[0]?.id ?? "";
  const attachableDocs = (rows ?? [])
    .filter((d) => ["MAT", "SHD", "MS", "RFI", "IR"].includes(d.type_code ?? ""))
    .slice(0, 15);

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="مراقبة الوثائق"
        description="سجل الوثائق الرسمي — التسجيل، الإصدار، الاعتماد، والمراجعات"
        actions={
          <div className="flex gap-3 text-sm">
            <Link href="/document-control" className="text-navy underline">
              الكل
            </Link>
            <Link href="/document-control?overdue=1" className="text-danger underline">
              المتأخرة
            </Link>
            <Link href="/search" className="text-navy underline">
              بحث متقدم
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <p className="text-sm text-muted">بانتظار إجراء</p>
          <p className="mt-2 text-3xl font-semibold text-navy">{awaiting}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">معتمد A/B</p>
          <p className="mt-2 text-3xl font-semibold text-success">{approved}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">إعادة تقديم C</p>
          <p className="mt-2 text-3xl font-semibold text-warning">{returnedC}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">مرفوض D</p>
          <p className="mt-2 text-3xl font-semibold text-danger">{rejectedD}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">إرساليات مسودة</p>
          <p className="mt-2 text-3xl font-semibold text-navy">{draftTrn}</p>
        </Card>
      </div>

      <Card className="mb-4">
        <form className="flex flex-wrap gap-3">
          <Field label="بحث">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="رقم الوثيقة أو العنوان"
              className="h-10 rounded-md border border-line bg-white px-3 text-sm"
            />
          </Field>
          <Field label="النوع">
            <Select name="type" defaultValue={type ?? ""}>
              <option value="">الكل</option>
              <option value="RFI">RFI</option>
              <option value="MAT">MAT</option>
              <option value="SHD">SHD</option>
              <option value="MS">MS</option>
              <option value="IR">IR</option>
              <option value="NCR">NCR</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              تصفية
            </Button>
          </div>
        </form>
      </Card>

      {canCreateTrn && defaultProject ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">إنشاء إرسالية مستندات (Transmittal)</h2>
          <ServerActionForm action={createTransmittalAction} className="grid gap-3 md:grid-cols-2">
            <Field label="المشروع">
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {p.name_ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المستلم">
              <Input name="recipient" required />
            </Field>
            <Field label="الموضوع">
              <Input name="subject" required />
            </Field>
            <Field label="الغرض">
              <Select name="purpose" defaultValue="for_approval">
                <option value="for_approval">للاعتماد</option>
                <option value="for_review">للمراجعة</option>
                <option value="for_information">للعلم</option>
                <option value="for_construction">للتنفيذ</option>
                <option value="for_record">للسجل</option>
              </Select>
            </Field>
            <Field label="معرّفات الوثائق (مفصولة بفاصلة)">
              <Input
                name="documentIds"
                required
                placeholder={attachableDocs[0]?.id ?? "uuid,..."}
                defaultValue={attachableDocs[0]?.id ?? ""}
              />
            </Field>
            <Field label="الوصف">
              <Input name="description" />
            </Field>
            <Button type="submit">إنشاء مسودة إرسالية</Button>
          </ServerActionForm>
          {attachableDocs.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              وثائق حديثة:{" "}
              {attachableDocs.map((d) => `${d.document_number} (${d.id.slice(0, 8)}…)`).join(" · ")}
            </p>
          ) : null}
        </Card>
      ) : null}

      {(transmittals ?? []).length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-navy">الإرساليات الأخيرة</h2>
          <ul className="space-y-3">
            {(transmittals ?? []).map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3"
              >
                <div>
                  <p className="font-medium text-navy">{t.transmittal_number}</p>
                  <p className="text-sm text-muted">
                    {t.subject} · إلى {t.recipient}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={t.status === "issued" ? "success" : "navy"}>{t.status}</Badge>
                  {t.status === "draft" && canIssueTrn ? (
                    <ServerActionForm action={issueTransmittalAction}>
                      <input type="hidden" name="transmittalId" value={t.id} />
                      <Button type="submit" variant="secondary">
                        إصدار (تجميد المحتوى)
                      </Button>
                    </ServerActionForm>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد وثائق مسجّلة في السجل الرسمي بعد." />
      ) : (
        <div className="space-y-4">
          {filtered.map((doc) => {
            const project = Array.isArray(doc.projects) ? doc.projects[0] : doc.projects;
            const isOverdue =
              doc.response_due_at &&
              doc.response_due_at < now &&
              ["submitted", "under_review"].includes(doc.submission_status);
            return (
              <Card key={doc.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-muted">
                      {doc.document_number}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-navy">{doc.title}</h2>
                    <p className="text-xs text-muted">
                      {doc.type_code} · {project?.project_code ?? "—"} · مراجعة {doc.current_revision}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="navy">{doc.submission_status}</Badge>
                    {doc.official_decision ? (
                      <Badge
                        tone={
                          doc.official_decision === "D"
                            ? "danger"
                            : doc.official_decision === "C"
                              ? "warning"
                              : "success"
                        }
                      >
                        قرار {doc.official_decision}
                      </Badge>
                    ) : null}
                    {isOverdue ? <Badge tone="danger">متأخر</Badge> : null}
                  </div>
                </div>

                {(canApprove || canRevise) && (
                  <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-2">
                    {canApprove ? (
                      <ServerActionForm action={applyDocumentDecisionAction} className="space-y-2">
                        <input type="hidden" name="documentId" value={doc.id} />
                        <Field label="قرار الاعتماد A–E">
                          <Select name="officialCode" defaultValue="A">
                            <option value="A">A — معتمد</option>
                            <option value="B">B — معتمد بملاحظات</option>
                            <option value="C">C — إعادة تقديم</option>
                            <option value="D">D — مرفوض</option>
                            <option value="E">E — للعلم</option>
                          </Select>
                        </Field>
                        <Field label="تعليق">
                          <Textarea name="comments" placeholder="مطلوب عند الرفض D" />
                        </Field>
                        <Button type="submit">تسجيل القرار</Button>
                      </ServerActionForm>
                    ) : null}
                    {canRevise && (doc.official_decision === "C" || doc.official_decision === "D") ? (
                      <ServerActionForm action={reviseDocumentAction} className="space-y-2">
                        <input type="hidden" name="documentId" value={doc.id} />
                        <Field label="وصف التغيير للمراجعة التالية">
                          <Textarea name="changeDescription" />
                        </Field>
                        <Button type="submit" variant="secondary">
                          إنشاء مراجعة جديدة
                        </Button>
                      </ServerActionForm>
                    ) : null}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
