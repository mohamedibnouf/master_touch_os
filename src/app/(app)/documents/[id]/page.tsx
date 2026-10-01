import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
import { documentStatusLabel } from "@/lib/ui/operational-labels";
import { DocumentOpenControl, DocumentSourceBadge } from "@/components/documents/document-open-control";
import { DocumentArchiveControl, DocumentRestoreControl } from "@/components/documents/document-lifecycle-controls";
import { documentFileSourceLabelAr } from "@/modules/documents/file-source";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: doc } = await supabase
    .from("documents")
    .select(
      "id, title, category, document_number, current_revision, status, project_id, organization_id, confidentiality, uploaded_by, created_at, updated_at, is_register_controlled, type_code, archived_at, archived_by",
    )
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!doc) notFound();

  const [{ data: versions }, { data: project }] = await Promise.all([
    supabase
      .from("document_versions")
      .select("id, revision, file_source, external_url, file_path, file_name, is_current, uploaded_at")
      .eq("document_id", id)
      .eq("organization_id", ctx.organization.id)
      .order("uploaded_at", { ascending: false }),
    doc.project_id
      ? supabase
          .from("projects")
          .select("id, project_code, name_ar")
          .eq("id", doc.project_id)
          .eq("organization_id", ctx.organization.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const current = (versions ?? []).find((v) => v.is_current) ?? null;
  const canOpenStorage = hasPermission(ctx, "document.read");
  const canArchive = hasPermission(ctx, "document.archive");
  const isArchived = Boolean(doc.archived_at);

  return (
    <PageContainer className="space-y-5" data-testid="document-detail">
      <PageHeader title={doc.title} description="بيانات المستند وإصداراته ومصدر الملف." />
      {isArchived ? (
        <p className="rounded-[var(--radius-control)] border border-line bg-paper px-3 py-2 text-sm text-navy" data-testid="document-archived-banner">
          مؤرشف — مخفي من القوائم التشغيلية. الملف والإصدارات محفوظة.
        </p>
      ) : null}

      <p className="text-sm">
        <Link href="/documents" className="text-navy underline">
          المستندات
        </Link>
        {project ? (
          <>
            {" · "}
            <Link href={`/projects/${project.id}?tab=documents`} className="text-navy underline">
              {project.project_code} — {project.name_ar}
            </Link>
          </>
        ) : null}
      </p>

      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">الرقم</dt>
            <dd>{doc.document_number || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">التصنيف</dt>
            <dd>{doc.category}</dd>
          </div>
          <div>
            <dt className="text-muted">الإصدار الحالي</dt>
            <dd>{doc.current_revision}</dd>
          </div>
          <div>
            <dt className="text-muted">الحالة</dt>
            <dd>
              <Badge tone="neutral">{documentStatusLabel(doc.status)}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted">المصدر</dt>
            <dd>
              <DocumentSourceBadge source={current?.file_source} />
            </dd>
          </div>
          <div>
            <dt className="text-muted">السرية</dt>
            <dd>{doc.confidentiality}</dd>
          </div>
        </dl>
        {doc.is_register_controlled ? (
          <p className="mt-3 text-xs text-muted">مستند سجل رسمي. لا يُحوَّل تلقائياً من رابط Drive غير الرسمي.</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <DocumentOpenControl
            documentId={doc.id}
            file={
              current
                ? {
                    file_source: current.file_source,
                    external_url: current.external_url,
                    file_path: current.file_path,
                  }
                : null
            }
            canOpenStorage={canOpenStorage}
          />
          {doc.category === "business_case" ? (
            <Link href={`/documents/${doc.id}/intelligence`} className="text-sm text-navy underline">
              ذكاء المستند
            </Link>
          ) : null}
          {canArchive && !isArchived ? (
            <DocumentArchiveControl documentId={doc.id} fileSource={current?.file_source} />
          ) : null}
          {canArchive && isArchived ? <DocumentRestoreControl documentId={doc.id} /> : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-navy">الإصدارات</h2>
        <TableScroll>
          <table className="min-w-full text-sm">
            <thead className="text-right text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">الإصدار</th>
                <th className="px-2 py-2 font-medium">المصدر</th>
                <th className="px-2 py-2 font-medium">الملف</th>
                <th className="px-2 py-2 font-medium">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {(versions ?? []).map((v) => (
                <tr key={v.id} className="border-t border-line">
                  <td className="px-2 py-2">
                    {v.revision}
                    {v.is_current ? " · الحالي" : ""}
                  </td>
                  <td className="px-2 py-2">{documentFileSourceLabelAr(v.file_source)}</td>
                  <td className="px-2 py-2">{v.file_name}</td>
                  <td className="px-2 py-2 text-muted">
                    {new Date(v.uploaded_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </PageContainer>
  );
}
