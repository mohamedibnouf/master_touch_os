import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, FileText } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { documentStatusLabel, documentStatusTone } from "@/lib/ui/operational-labels";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
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

  const { t, locale } = await getI18n();
  const td = t.documents;
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
    ? await supabase.from("profiles").select("id, full_name_ar, full_name_en").in("id", archiverIds)
    : { data: [] as Array<{ id: string; full_name_ar: string; full_name_en: string | null }> };
  const archiverName = new Map(
    (archivers ?? []).map((p) => [p.id, pickLocalized(locale, p.full_name_ar, p.full_name_en)]),
  );
  const projectName = new Map(projects.map((p) => [p.id, `${p.project_code} — ${p.name_ar}`]));
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  });
  const categoryLabel = (value: string) =>
    (td.categories as Record<string, string>)[value] ?? value.replaceAll("_", " ");

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={archivedView ? td.list.archivedTitle : td.list.title}
        description={archivedView ? td.list.archivedDescription : td.list.description}
        actions={
          archivedView ? (
            <Link
              href="/documents"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <FileText className="size-4" aria-hidden />
              {td.list.activeLink}
            </Link>
          ) : canArchive ? (
            <Link
              href="/documents?view=archived"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
              data-testid="documents-archive-link"
            >
              <Archive className="size-4" aria-hidden />
              {td.list.archivedLink}
            </Link>
          ) : null
        }
      />

      {canUpload ? (
        <Card>
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ink">{td.list.addHeading}</h2>
            <p className="mt-1 text-sm text-muted">{td.list.addDescription}</p>
          </div>
          <DocumentSourceForm showProjectPicker projects={projects} />
        </Card>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          title={archivedView ? td.list.emptyArchived : td.list.empty}
          description={canUpload ? td.list.emptyHint : undefined}
        />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {documents.map((doc) => {
              const file = fileByDoc.get(doc.id) ?? null;
              return (
                <li key={doc.id} className="mt-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-medium text-ink">{doc.title}</p>
                    <Badge tone="navy">{doc.current_revision}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {categoryLabel(doc.category)} · {documentStatusLabel(doc.status, locale)}
                    {doc.project_id && projectName.get(doc.project_id) ? ` · ${projectName.get(doc.project_id)}` : ""}
                  </p>
                  {archivedView && doc.archived_at ? (
                    <p className="mt-1 text-xs text-muted">
                      {format(td.list.archivedOn, { date: dateFmt.format(new Date(doc.archived_at)) })}
                      {doc.archived_by ? ` · ${archiverName.get(doc.archived_by) ?? ""}` : ""}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
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
          <TableScroll className="mt-surface hidden md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-start text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{td.common.title}</th>
                  <th className="px-4 py-3 text-start font-medium">{td.common.category}</th>
                  <th className="px-4 py-3 text-start font-medium">{td.common.revision}</th>
                  <th className="px-4 py-3 text-start font-medium">{td.common.status}</th>
                  {archivedView ? <th className="px-4 py-3 text-start font-medium">{td.common.archive}</th> : null}
                  <th className="px-4 py-3 text-start font-medium">{td.common.source}</th>
                  <th className="px-4 py-3 text-start font-medium">{td.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const file = fileByDoc.get(doc.id) ?? null;
                  return (
                    <tr key={doc.id} className="border-t border-line transition-colors hover:bg-surface-muted/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{doc.title}</p>
                        {doc.project_id && projectName.get(doc.project_id) ? (
                          <p className="mt-0.5 text-xs text-muted">{projectName.get(doc.project_id)}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted">{categoryLabel(doc.category)}</td>
                      <td className="px-4 py-3">
                        <Badge tone="navy">{doc.current_revision}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={documentStatusTone(doc.status)}>{documentStatusLabel(doc.status, locale)}</Badge>
                      </td>
                      {archivedView ? (
                        <td className="px-4 py-3 text-muted">
                          {doc.archived_at ? dateFmt.format(new Date(doc.archived_at)) : td.common.none}
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
