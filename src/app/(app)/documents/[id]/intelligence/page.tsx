import { PageContainer } from "@/components/layout/page-container";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { DocumentIntelligenceActions } from "@/components/documents/document-intelligence-actions";
import { getAuthContext } from "@/server/context";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { hasPermission } from "@/server/policies/authorize";
import { DocumentIntelligenceRepository } from "@/server/repositories/document-intelligence.repository";
import { getDocumentAIConfig } from "@/modules/document-intelligence/ai-extract";
import { compareBusinessCaseToProject } from "@/modules/document-intelligence/comparison";
import { riyadhTodayYmd } from "@/modules/management/riyadh-date";
import type { BusinessCaseExtraction, ExtractedFact } from "@/modules/document-intelligence/schema";
import { driveIntelligenceUnavailableMessage, isStorageIntelligenceEligible } from "@/modules/documents/file-source";
import { classifyDocumentSource } from "@/modules/ai/classify-source";
import { isGooglePickerReady, readGooglePickerPublicConfig } from "@/modules/documents/google-picker-config";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries/ar";

type IntelCopy = Dictionary["documents"]["intelligence"];

function TrustBadge({ status, copy }: { status: string | null; copy: IntelCopy }) {
  if (status === "VERIFIED") return <Badge tone="success" data-testid="trust-verified">{copy.trustVerified}</Badge>;
  if (status === "EXTRACTED") return <Badge tone="warning" data-testid="trust-extracted">{copy.trustExtracted}</Badge>;
  if (status === "FAILED") return <Badge tone="danger">{copy.trustFailed}</Badge>;
  if (status === "PROCESSING") return <Badge tone="neutral">{copy.trustProcessing}</Badge>;
  return <Badge tone="neutral">{copy.trustNone}</Badge>;
}

function FactList({ title, facts, copy }: { title: string; facts: ExtractedFact[]; copy: IntelCopy }) {
  if (!facts.length) return null;
  return (
    <Card className="break-inside-avoid">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs tabular-nums text-muted">{facts.length}</span>
      </div>
      <ul className="divide-y divide-line text-sm">
        {facts.map((f, i) => (
          <li key={`${f.value}-${i}`} className="py-2 first:pt-0 last:pb-0" data-testid="extracted-fact">
            <p className="text-ink">{f.value}</p>
            <p className="mt-1 text-xs text-muted" dir="auto">
              {format(copy.evidenceLabel, { refs: f.evidenceRefs.join(", ") })}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default async function DocumentIntelligencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "document.read") && !hasPermission(ctx, "document_control.read")) {
    redirect("/");
  }

  const { t, locale } = await getI18n();
  const td = t.documents;
  const ti = td.intelligence;
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, category, project_id, current_revision, organization_id, archived_at")
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!doc) notFound();

  const { data: version } = await supabase
    .from("document_versions")
    .select("id, revision, mime_type, file_name, checksum, is_current, file_source, file_path, external_file_id")
    .eq("document_id", id)
    .eq("organization_id", ctx.organization.id)
    .eq("is_current", true)
    .maybeSingle();

  const repo = new DocumentIntelligenceRepository(supabase);
  const intel = version
    ? await repo.getCurrentForVersion(ctx.organization.id, version.id)
    : null;

  const payload = (intel?.extraction_payload ?? null) as BusinessCaseExtraction | null;
  const ai = getDocumentAIConfig();
  const sourceClass = classifyDocumentSource({
    fileSource: version?.file_source,
    mimeType: version?.mime_type,
    filePath: version?.file_path,
  });
  const driveEligible = sourceClass === "DRIVE_FETCH_REQUIRED";
  const canAnalyze =
    (hasPermission(ctx, "document.upload") || hasPermission(ctx, "document.update")) &&
    (isStorageIntelligenceEligible(version ?? {}) || driveEligible) &&
    !doc.archived_at;
  const canVerify = hasPermission(ctx, "document.approve");
  const driveBlocked = Boolean(version?.file_source === "google_drive" && !driveEligible);
  const pickerConfig = readGooglePickerPublicConfig({
    NEXT_PUBLIC_GOOGLE_PICKER_ENABLED: process.env.NEXT_PUBLIC_GOOGLE_PICKER_ENABLED,
    NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY,
  });
  const googlePickerClientId = isGooglePickerReady(pickerConfig) ? pickerConfig.clientId : "";

  let project: {
    id: string;
    project_code: string;
    name_ar: string;
    status: string;
    planned_end_date: string | null;
    start_date: string | null;
    budget: number | null;
    contract_value: number | null;
  } | null = null;
  if (doc.project_id) {
    const { data } = await supabase
      .from("projects")
      .select("id, project_code, name_ar, status, planned_end_date, start_date, budget, contract_value")
      .eq("id", doc.project_id)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    project = data;
  }

  const comparisons =
    intel?.status === "VERIFIED" && payload
      ? compareBusinessCaseToProject({
          extraction: payload,
          project: project
            ? {
                id: project.id,
                projectCode: project.project_code,
                nameAr: project.name_ar,
                status: project.status,
                plannedEndDate: project.planned_end_date,
                startDate: project.start_date,
                budget: project.budget != null ? Number(project.budget) : null,
                contractValue: project.contract_value != null ? Number(project.contract_value) : null,
              }
            : null,
          asOfDate: riyadhTodayYmd(),
        })
      : [];

  const categoryLabel = (td.categories as Record<string, string>)[doc.category] ?? doc.category;
  const severityLabel = (severity: string) =>
    severity === "HIGH" ? ti.severityHigh : severity === "MEDIUM" ? ti.severityMedium : severity === "LOW" ? ti.severityLow : severity;
  const Crumb = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <PageContainer data-testid="document-intelligence" className="space-y-5 management-report">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted print:hidden">
        <Link href="/documents" className="hover:text-ink hover:underline">
          {td.common.documents}
        </Link>
        <Crumb className="size-3.5" aria-hidden />
        <Link href={`/documents/${doc.id}`} className="hover:text-ink hover:underline">
          {doc.title}
        </Link>
        {doc.project_id ? (
          <>
            <span aria-hidden>·</span>
            <Link href={`/projects/${doc.project_id}`} className="hover:text-ink hover:underline">
              {ti.project}
            </Link>
          </>
        ) : null}
      </nav>

      <PageHeader title={ti.title} description={ti.description} />

      <Card data-testid="doc-intel-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink">{doc.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {format(ti.meta, { category: categoryLabel, revision: version?.revision ?? doc.current_revision })}
              {version ? ` · ${version.file_name}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <TrustBadge status={intel?.status ?? null} copy={ti} />
              <Badge tone="neutral">{ti.textOnlyBadge}</Badge>
            </div>
          </div>
          <DocumentIntelligenceActions
            documentId={doc.id}
            intelligenceId={intel?.id ?? null}
            status={intel?.status ?? null}
            canAnalyze={canAnalyze}
            canVerify={canVerify}
            aiEnabled={ai.enabled}
            needsDriveToken={driveEligible}
            googlePickerClientId={googlePickerClientId}
          />
        </div>
        {!ai.enabled ? (
          <p className="mt-3 text-sm text-muted" data-testid="doc-intel-unavailable">
            {ti.aiNotConfigured}
          </p>
        ) : null}
        {driveBlocked ? (
          <p className="mt-3 text-sm text-muted" data-testid="doc-intel-drive-unavailable">
            {driveIntelligenceUnavailableMessage(locale)}
          </p>
        ) : null}
        {intel?.error_message ? (
          <p className="mt-3 text-sm text-danger" data-testid="doc-intel-error">
            {intel.error_message}
          </p>
        ) : null}
      </Card>

      {payload && (intel?.status === "EXTRACTED" || intel?.status === "VERIFIED") ? (
        <>
          <Card className="break-inside-avoid">
            <h2 className="mb-2 text-sm font-semibold text-ink">{ti.summary}</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink" data-testid="doc-intel-summary">
              {payload.summary || td.common.none}
            </p>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <FactList title={ti.objectives} facts={payload.objectives} copy={ti} />
            <FactList title={ti.deliverables} facts={payload.deliverables} copy={ti} />
            <FactList title={ti.milestones} facts={payload.milestones} copy={ti} />
            <FactList
              title={ti.deadlines}
              facts={payload.deadlines.map((d) => ({
                value: d.dateYmd ? `${d.value} (${d.dateYmd})` : d.value,
                evidenceRefs: d.evidenceRefs,
              }))}
              copy={ti}
            />
            <FactList title={ti.budgetFacts} facts={payload.budgetFacts} copy={ti} />
            <FactList title={ti.stakeholders} facts={payload.stakeholders} copy={ti} />
            <FactList title={ti.assumptions} facts={payload.assumptions} copy={ti} />
            <FactList title={ti.dependencies} facts={payload.dependencies} copy={ti} />
            <FactList title={ti.explicitRisks} facts={payload.explicitRisks} copy={ti} />
            <FactList title={ti.requiredApprovals} facts={payload.requiredApprovals} copy={ti} />
            <FactList title={ti.actionItems} facts={payload.actionItems} copy={ti} />
          </div>
          {payload.ambiguities.length > 0 ? (
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-ink">{ti.ambiguities}</h2>
              <ul className="list-disc space-y-1 ps-5 text-sm text-ink">
                {payload.ambiguities.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card className="bg-surface-muted" data-testid="doc-intel-evidence">
            <h2 className="mb-2 text-sm font-semibold text-ink">{ti.evidenceHeading}</h2>
            <p className="text-sm text-muted">{ti.evidenceBody}</p>
            <p className="mt-2 text-xs tabular-nums text-muted">
              {format(ti.evidenceStats, { chunks: intel?.chunk_count ?? 0, characters: intel?.character_count ?? 0 })}
              {intel?.provider ? format(ti.evidenceProvider, { provider: intel.provider }) : ""}
            </p>
          </Card>
        </>
      ) : (
        <Card data-testid="doc-intel-empty">
          <p className="text-sm text-muted">{ti.empty}</p>
        </Card>
      )}

      {intel?.status === "VERIFIED" ? (
        <Card data-testid="doc-intel-comparison">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">{ti.comparisonHeading}</h2>
            <Badge tone="navy">{ti.comparisonBadge}</Badge>
          </div>
          {comparisons.length === 0 ? (
            <p className="text-sm text-muted">{ti.comparisonEmpty}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {comparisons.map((c) => (
                <li key={c.id} className="py-3 first:pt-0 last:pb-0" data-testid="comparison-finding">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.severity === "HIGH" ? "danger" : c.severity === "LOW" ? "neutral" : "warning"}>
                      {severityLabel(c.severity)}
                    </Badge>
                    <span className="font-medium text-ink">{pickLocalized(locale, c.titleAr, c.titleEn)}</span>
                  </div>
                  <p className="mt-1 text-muted">{pickLocalized(locale, c.explanationAr, c.explanationEn)}</p>
                  {c.href ? (
                    <Link href={c.href} className="mt-1 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline">
                      {ti.openSource}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <p className="text-sm text-muted">
        {ti.footerBefore}{" "}
        <Link href={`/documents/${doc.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {ti.footerLink}
        </Link>
        {ti.footerAfter}
      </p>
    </PageContainer>
  );
}
