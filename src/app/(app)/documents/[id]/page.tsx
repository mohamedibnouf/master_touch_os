import { PageContainer } from "@/components/layout/page-container";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Archive, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Badge, Card, PageHeader, TableScroll } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
import { documentStatusLabel, documentStatusTone } from "@/lib/ui/operational-labels";
import { intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { DocumentOpenControl, DocumentSourceBadge } from "@/components/documents/document-open-control";
import { DocumentArchiveControl, DocumentRestoreControl } from "@/components/documents/document-lifecycle-controls";
import { OperationalDocumentRevisionForm } from "@/components/documents/operational-revision-form";
import { documentFileSourceLabel } from "@/modules/documents/file-source";
import { canOfferOperationalRevision, nextOperationalRevision } from "@/modules/documents/operational-revision";
import { DocumentAiAnalysisPanel } from "@/components/ai/document-ai-analysis";
import { classifyDocumentSource, isInteractiveDocumentAiSource } from "@/modules/ai/classify-source";
import { getAiPlatformConfig } from "@/modules/ai/config-env";
import { canUseAiCapability } from "@/modules/ai/security/permissions";
import { isGooglePickerReady, readGooglePickerPublicConfig } from "@/modules/documents/google-picker-config";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const { t, locale } = await getI18n();
  const td = t.documents;
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
      .select("id, revision, file_source, external_url, external_file_id, file_path, file_name, mime_type, is_current, is_superseded, uploaded_at")
      .eq("document_id", id)
      .eq("organization_id", ctx.organization.id)
      .order("uploaded_at", { ascending: false }),
    doc.project_id
      ? supabase
          .from("projects")
          .select("id, project_code, name_ar, name_en")
          .eq("id", doc.project_id)
          .eq("organization_id", ctx.organization.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const current = (versions ?? []).find((v) => v.is_current) ?? null;
  const canOpenStorage = hasPermission(ctx, "document.read");
  const canArchive = hasPermission(ctx, "document.archive");
  const isArchived = Boolean(doc.archived_at);
  const nextRevision = nextOperationalRevision(doc.current_revision);
  const canAddVersion =
    Boolean(nextRevision) &&
    canOfferOperationalRevision({
      hasDocumentUpload: hasPermission(ctx, "document.upload"),
      isArchived,
      isRegisterControlled: Boolean(doc.is_register_controlled),
    });

  const sourceClass = classifyDocumentSource({
    fileSource: current?.file_source,
    mimeType: current?.mime_type,
    filePath: current?.file_path,
  });
  const canSeeDocumentAi = canUseAiCapability(ctx, "ai.document.analyze");
  const pickerConfig = readGooglePickerPublicConfig({
    NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_PICKER_ENABLED,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
  });
  const googlePickerClientId = isGooglePickerReady(pickerConfig) ? pickerConfig.clientId : "";
  const unsupportedAiMessage =
    isArchived
      ? td.detail.aiArchived
      : !current
        ? td.detail.aiNoCurrent
        : sourceClass === "UNSUPPORTED"
          ? td.detail.aiUnsupported
          : td.detail.aiUnavailableSource;

  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  });
  const categoryLabel = (td.categories as Record<string, string>)[doc.category] ?? doc.category;
  const Crumb = locale === "ar" ? ChevronLeft : ChevronRight;

  const facts: Array<{ label: string; value: ReactNode }> = [
    { label: td.detail.number, value: doc.document_number || td.common.none },
    { label: td.common.category, value: categoryLabel },
    { label: td.detail.currentRevision, value: <Badge tone="navy">{doc.current_revision}</Badge> },
    {
      label: td.common.status,
      value: <Badge tone={documentStatusTone(doc.status)}>{documentStatusLabel(doc.status, locale)}</Badge>,
    },
    { label: td.common.source, value: <DocumentSourceBadge source={current?.file_source} /> },
    { label: td.detail.confidentiality, value: doc.confidentiality },
  ];

  return (
    <PageContainer className="space-y-5" data-testid="document-detail">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/documents" className="hover:text-ink hover:underline">
          {td.common.documents}
        </Link>
        {project ? (
          <>
            <Crumb className="size-3.5" aria-hidden />
            <Link href={`/projects/${project.id}?tab=documents`} className="hover:text-ink hover:underline">
              {project.project_code} — {pickLocalized(locale, project.name_ar, project.name_en)}
            </Link>
          </>
        ) : null}
      </nav>

      <PageHeader title={doc.title} description={td.detail.description} />
      {isArchived ? (
        <p
          className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface-muted px-3 py-2 text-sm text-ink"
          data-testid="document-archived-banner"
        >
          <Archive className="size-4 shrink-0 text-muted" aria-hidden />
          {td.detail.archivedBanner}
        </p>
      ) : null}

      <Card>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs font-medium text-muted">{fact.label}</dt>
              <dd className="mt-1 text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {doc.is_register_controlled ? (
          <p className="mt-4 text-xs text-muted">{td.detail.registerNote}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
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
            <Link
              href={`/documents/${doc.id}/intelligence`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              <Sparkles className="size-4" aria-hidden />
              {td.detail.intelligenceLink}
            </Link>
          ) : null}
          {canArchive && !isArchived ? (
            <div className="ms-auto">
              <DocumentArchiveControl documentId={doc.id} fileSource={current?.file_source} />
            </div>
          ) : null}
          {canArchive && isArchived ? (
            <div className="ms-auto">
              <DocumentRestoreControl documentId={doc.id} />
            </div>
          ) : null}
        </div>
      </Card>

      {canSeeDocumentAi ? (
        <Card data-testid="document-ai-entry">
          <h2 className="mb-3 text-sm font-semibold text-ink">{td.detail.aiHeading}</h2>
          {!isArchived && isInteractiveDocumentAiSource(sourceClass) ? (
            <DocumentAiAnalysisPanel
              documentId={doc.id}
              enabled={getAiPlatformConfig().enabled}
              sourceClass={sourceClass}
              defaultBusinessCase={doc.category === "business_case" || doc.category === "BUSINESS_CASE"}
              googlePickerClientId={googlePickerClientId}
              googlePickerApiKey={googlePickerClientId ? pickerConfig.apiKey : ""}
              authorizedDriveFileId={
                current?.file_source === "google_drive" && current.external_file_id ? current.external_file_id : undefined
              }
            />
          ) : (
            <p className="text-sm text-muted" data-testid="document-ai-unavailable">
              {unsupportedAiMessage}
            </p>
          )}
        </Card>
      ) : null}

      {canAddVersion && nextRevision ? (
        <Card>
          <OperationalDocumentRevisionForm
            documentId={doc.id}
            projectId={doc.project_id}
            title={doc.title}
            category={doc.category}
            confidentiality={doc.confidentiality}
            currentRevision={doc.current_revision}
            nextRevision={nextRevision}
          />
        </Card>
      ) : null}

      <Card className="p-0 md:p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold text-ink md:px-5 md:pt-5">{td.detail.versionsHeading}</h2>
        <TableScroll className="mt-3">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{td.common.revision}</th>
                <th className="px-4 py-2.5 text-start font-medium">{td.common.source}</th>
                <th className="px-4 py-2.5 text-start font-medium">{td.common.file}</th>
                <th className="px-4 py-2.5 text-start font-medium">{td.common.status}</th>
                <th className="px-4 py-2.5 text-start font-medium">{td.common.date}</th>
                <th className="px-4 py-2.5 text-start font-medium">{td.common.open}</th>
              </tr>
            </thead>
            <tbody>
              {(versions ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    {td.detail.noVersions}
                  </td>
                </tr>
              ) : null}
              {(versions ?? []).map((v) => (
                <tr key={v.id} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <Badge tone={v.is_current ? "navy" : "neutral"}>{v.revision}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{documentFileSourceLabel(v.file_source, locale)}</td>
                  <td className="max-w-[16rem] truncate px-4 py-2.5 text-ink">{v.file_name}</td>
                  <td className="px-4 py-2.5">
                    {v.is_current ? (
                      <Badge tone="success">{td.detail.versionCurrent}</Badge>
                    ) : v.is_superseded ? (
                      <Badge tone="neutral">{td.detail.versionSuperseded}</Badge>
                    ) : (
                      <span className="text-muted">{td.detail.versionHistory}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                    {dateFmt.format(new Date(v.uploaded_at))}
                  </td>
                  <td className="px-4 py-2.5">
                    <DocumentOpenControl
                      documentId={doc.id}
                      versionId={v.id}
                      file={{
                        file_source: v.file_source,
                        external_url: v.external_url,
                        file_path: v.file_path,
                      }}
                      canOpenStorage={canOpenStorage}
                    />
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
