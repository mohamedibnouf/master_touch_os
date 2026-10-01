import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { documentStatusLabel } from "@/lib/ui/operational-labels";
import { DocumentSourceForm } from "@/components/documents/document-source-form";
import {
  DocumentDetailsLink,
  DocumentOpenControl,
  DocumentSourceBadge,
} from "@/components/documents/document-open-control";
import {
  DocumentArchiveControl,
  DocumentRestoreControl,
} from "@/components/documents/document-lifecycle-controls";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "document.read")) redirect("/login");

  const { view } = await searchParams;
  const canArchive = hasPermission(ctx, "document.archive");
  const archivedView = view === "archived";
  if (archivedView && !canArchive) redirect("/documents");

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const [documents, projects] = await Promise.all([
    repo.listDocuments(ctx.organization.id, undefined, { archived: archivedView }),
    repo.listProjectPicker(ctx.organization.id),
  ]);
  const currentFiles = await repo.listCurrentDocumentFiles(
    ctx.organization.id,
    documents.map((d) => d.id),
  );
  const fileByDoc = new Map(currentFiles.map((row) => [row.document_id, row]));
  const canUpload = hasPermission(ctx, "document.upload") && !archivedView;
  const canOpenStorage = hasPermission(ctx, "document.read");

  const archiverIds = [...new Set(documents.map((d) => d.archived_by).filter(Boolean))] as string[];
  const { data: archivers } = archiverIds.length
    ? await supabase.from("profiles").select("id, full_name_ar").in("id", archiverIds)
    : { data: [] as Array<{ id: string; full_name_ar: string }> };
  const archiverName = new Map((archivers ?? []).map((p) => [p.id, p.full_name_ar]));
  const projectName = new Map(projects.map((p) => [p.id, `${p.project_code} — ${p.name_ar}`]));

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={archivedView ? "المستندات المحذوفة" : "المستندات"}
        description={
          archivedView
            ? "أرشيف غير متلف. الملفات والإصدارات محفوظة ويمكن الاستعادة."
            : "مركز المستندات عبر المشاريع. مصدر الملف: تخزين النظام أو Google Drive."
        }
      />

      <p className="text-sm">
        {archivedView ? (
          <Link href="/documents" className="text-navy underline">
            المستندات النشطة
          </Link>
        ) : canArchive ? (
          <Link href="/documents?view=archived" className="text-navy underline" data-testid="documents-archive-link">
            المستندات المحذوفة
          </Link>
        ) : null}
      </p>

      {canUpload ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-navy">إضافة مستند</h2>
          <DocumentSourceForm showProjectPicker projects={projects} />
        </Card>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState title={archivedView ? "لا توجد مستندات محذوفة." : "لا توجد مستندات بعد."} />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {documents.map((doc) => {
              const file = fileByDoc.get(doc.id) ?? null;
              return (
                <li key={doc.id} className="rounded-lg border border-line bg-white p-3">
                  <p className="font-medium text-navy">{doc.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {doc.category} · {doc.current_revision} · {documentStatusLabel(doc.status)}
                    {doc.project_id && projectName.get(doc.project_id) ? ` · ${projectName.get(doc.project_id)}` : ""}
                  </p>
                  {archivedView && doc.archived_at ? (
                    <p className="mt-1 text-xs text-muted">
                      أُرشف {new Date(doc.archived_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                      {doc.archived_by ? ` · ${archiverName.get(doc.archived_by) ?? ""}` : ""}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <DocumentSourceBadge source={file?.file_source} />
                    <DocumentOpenControl documentId={doc.id} file={file} canOpenStorage={canOpenStorage} />
                    <DocumentDetailsLink documentId={doc.id} />
                    {archivedView && canArchive ? <DocumentRestoreControl documentId={doc.id} /> : null}
                    {!archivedView && canArchive ? (
                      <DocumentArchiveControl documentId={doc.id} fileSource={file?.file_source} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <TableScroll className="hidden rounded-lg border border-line bg-white md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-paper text-right text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">العنوان</th>
                  <th className="px-4 py-3 font-medium">التصنيف</th>
                  <th className="px-4 py-3 font-medium">الإصدار</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  {archivedView ? <th className="px-4 py-3 font-medium">الأرشفة</th> : null}
                  <th className="px-4 py-3 font-medium">المصدر</th>
                  <th className="px-4 py-3 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const file = fileByDoc.get(doc.id) ?? null;
                  return (
                    <tr key={doc.id} className="border-t border-line">
                      <td className="px-4 py-3 font-medium text-navy">{doc.title}</td>
                      <td className="px-4 py-3">{doc.category}</td>
                      <td className="px-4 py-3">
                        <Badge tone="navy">{doc.current_revision}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral">{documentStatusLabel(doc.status)}</Badge>
                      </td>
                      {archivedView ? (
                        <td className="px-4 py-3 text-muted">
                          {doc.archived_at
                            ? new Date(doc.archived_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })
                            : "—"}
                          {doc.archived_by ? (
                            <p className="text-xs">{archiverName.get(doc.archived_by) ?? ""}</p>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <DocumentSourceBadge source={file?.file_source} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <DocumentOpenControl
                            documentId={doc.id}
                            file={file}
                            canOpenStorage={canOpenStorage}
                          />
                          <DocumentDetailsLink documentId={doc.id} />
                          {archivedView && canArchive ? <DocumentRestoreControl documentId={doc.id} /> : null}
                          {!archivedView && canArchive ? (
                            <DocumentArchiveControl documentId={doc.id} fileSource={file?.file_source} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </PageContainer>
  );
}
