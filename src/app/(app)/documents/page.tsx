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

export default async function DocumentsPage() {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "document.read")) redirect("/login");

  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const [documents, projects] = await Promise.all([
    repo.listDocuments(ctx.organization.id),
    repo.listProjectPicker(ctx.organization.id),
  ]);
  const currentFiles = await repo.listCurrentDocumentFiles(
    ctx.organization.id,
    documents.map((d) => d.id),
  );
  const fileByDoc = new Map(currentFiles.map((row) => [row.document_id, row]));
  const canUpload = hasPermission(ctx, "document.upload");
  const canOpenStorage = hasPermission(ctx, "document.read");

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title="المستندات"
        description="مركز المستندات عبر المشاريع. مصدر الملف: تخزين النظام أو Google Drive."
      />

      {canUpload ? (
        <Card className="mb-6">
          <h2 className="mb-4 text-base font-semibold text-navy">إضافة مستند</h2>
          <DocumentSourceForm showProjectPicker projects={projects} />
        </Card>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState title="لا توجد مستندات بعد." />
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
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <DocumentSourceBadge source={file?.file_source} />
                    <DocumentOpenControl documentId={doc.id} file={file} canOpenStorage={canOpenStorage} />
                    <DocumentDetailsLink documentId={doc.id} />
                    {doc.category === "business_case" ? (
                      <Link href={`/documents/${doc.id}/intelligence`} className="text-sm text-navy underline">
                        تحليل
                      </Link>
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
                  <th className="px-4 py-3 font-medium">المصدر</th>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
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
                      <td className="px-4 py-3">
                        <DocumentSourceBadge source={file?.file_source} />
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {new Date(doc.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <DocumentOpenControl
                            documentId={doc.id}
                            file={file}
                            canOpenStorage={canOpenStorage}
                          />
                          <DocumentDetailsLink documentId={doc.id} />
                          {doc.category === "business_case" ? (
                            <Link
                              href={`/documents/${doc.id}/intelligence`}
                              className="text-navy underline"
                              data-testid={`doc-intel-link-${doc.id}`}
                            >
                              تحليل
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          {documents.length >= 50 ? (
            <p className="text-xs text-muted">يُعرض أحدث 50 مستنداً في المؤسسة.</p>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
