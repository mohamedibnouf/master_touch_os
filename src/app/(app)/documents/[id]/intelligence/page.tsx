import { redirect, notFound } from "next/navigation";
import Link from "next/link";
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

function TrustBadge({ status }: { status: string | null }) {
  if (status === "VERIFIED") return <Badge tone="navy" data-testid="trust-verified">Verified</Badge>;
  if (status === "EXTRACTED") return <Badge tone="warning" data-testid="trust-extracted">AI Extracted — Not Verified</Badge>;
  if (status === "FAILED") return <Badge tone="danger">Failed</Badge>;
  if (status === "PROCESSING") return <Badge tone="neutral">Processing</Badge>;
  return <Badge tone="neutral">No extraction</Badge>;
}

function FactList({ title, facts }: { title: string; facts: ExtractedFact[] }) {
  if (!facts.length) return null;
  return (
    <Card className="mb-4 break-inside-avoid">
      <h2 className="mb-2 font-semibold text-navy">{title}</h2>
      <ul className="space-y-2 text-sm">
        {facts.map((f, i) => (
          <li key={`${f.value}-${i}`} className="border-b border-line pb-2" data-testid="extracted-fact">
            <p>{f.value}</p>
            <p className="mt-1 text-xs text-muted">Evidence: {f.evidenceRefs.join(", ")}</p>
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

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, title, category, project_id, current_revision, organization_id")
    .eq("id", id)
    .eq("organization_id", ctx.organization.id)
    .maybeSingle();
  if (!doc) notFound();

  const { data: version } = await supabase
    .from("document_versions")
    .select("id, revision, mime_type, file_name, checksum, is_current")
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
  const canAnalyze = hasPermission(ctx, "document.upload") || hasPermission(ctx, "document.update");
  const canVerify = hasPermission(ctx, "document.approve");

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

  return (
    <div data-testid="document-intelligence" className="management-report">
      <PageHeader
        title="ذكاء المستند — دراسة الحالة"
        description="استخراج منظم مع تحقق بشري. الذكاء الاصطناعي لا يعدّل سجلات المشروع تلقائياً."
      />

      <p className="mb-3 text-sm">
        <Link href="/documents" className="text-navy underline">
          المستندات
        </Link>
        {doc.project_id ? (
          <>
            {" · "}
            <Link href={`/projects/${doc.project_id}`} className="text-navy underline">
              المشروع
            </Link>
          </>
        ) : null}
      </p>

      <Card className="mb-4" data-testid="doc-intel-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-navy">{doc.title}</h1>
            <p className="mt-1 text-sm text-muted">
              التصنيف: {doc.category} · الإصدار الحالي: {version?.revision ?? doc.current_revision}
              {version ? ` · ${version.file_name}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <TrustBadge status={intel?.status ?? null} />
              <Badge tone="neutral">AI analysis based on document text only</Badge>
            </div>
          </div>
          <DocumentIntelligenceActions
            documentId={doc.id}
            intelligenceId={intel?.id ?? null}
            status={intel?.status ?? null}
            canAnalyze={canAnalyze}
            canVerify={canVerify}
            aiEnabled={ai.enabled}
          />
        </div>
        {!ai.enabled ? (
          <p className="mt-3 text-sm text-muted" data-testid="doc-intel-unavailable">
            عيّن DOCUMENT_AI_PROVIDER=mock أو openai على الخادم.
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
          <Card className="mb-4 break-inside-avoid">
            <h2 className="mb-2 font-semibold text-navy">الملخص</h2>
            <p className="text-sm whitespace-pre-wrap" data-testid="doc-intel-summary">
              {payload.summary || "—"}
            </p>
          </Card>
          <FactList title="الأهداف" facts={payload.objectives} />
          <FactList title="المخرجات" facts={payload.deliverables} />
          <FactList title="المعالم" facts={payload.milestones} />
          <FactList
            title="المواعيد"
            facts={payload.deadlines.map((d) => ({
              value: d.dateYmd ? `${d.value} (${d.dateYmd})` : d.value,
              evidenceRefs: d.evidenceRefs,
            }))}
          />
          <FactList title="وقائع الميزانية" facts={payload.budgetFacts} />
          <FactList title="أصحاب المصلحة" facts={payload.stakeholders} />
          <FactList title="الافتراضات" facts={payload.assumptions} />
          <FactList title="الاعتماديات" facts={payload.dependencies} />
          <FactList title="مخاطر مذكورة صراحة" facts={payload.explicitRisks} />
          <FactList title="موافقات مطلوبة" facts={payload.requiredApprovals} />
          <FactList title="إجراءات" facts={payload.actionItems} />
          {payload.ambiguities.length > 0 ? (
            <Card className="mb-4">
              <h2 className="mb-2 font-semibold text-navy">غموض</h2>
              <ul className="list-disc space-y-1 pe-5 text-sm">
                {payload.ambiguities.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card className="mb-4" data-testid="doc-intel-evidence">
            <h2 className="mb-2 font-semibold text-navy">الأدلة (Evidence)</h2>
            <p className="text-sm text-muted">
              كل واقعة مرتبطة بمعرّفات أجزاء المستند (DOC_CHUNK_###). لا تُقبل مراجع غير معروفة من النموذج.
            </p>
            <p className="mt-2 text-xs text-muted">
              chunks: {intel?.chunk_count ?? 0} · characters: {intel?.character_count ?? 0}
              {intel?.provider ? ` · provider: ${intel.provider}` : ""}
            </p>
          </Card>
        </>
      ) : (
        <Card className="mb-4" data-testid="doc-intel-empty">
          <p className="text-sm text-muted">لا توجد نتيجة استخراج بعد. اضغط «تحليل دراسة الحالة».</p>
        </Card>
      )}

      {intel?.status === "VERIFIED" ? (
        <Card className="mb-4" data-testid="doc-intel-comparison">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-navy">مقارنة تشغيلية حتمية</h2>
            <Badge tone="navy">Deterministic Comparison</Badge>
          </div>
          {comparisons.length === 0 ? (
            <p className="text-sm text-muted">لا توجد فروقات حتمية وفق القواعد المتاحة.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {comparisons.map((c) => (
                <li key={c.id} className="border-b border-line pb-2" data-testid="comparison-finding">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={c.severity === "HIGH" ? "danger" : "warning"}>{c.severity}</Badge>
                    <span className="font-medium text-navy">{c.titleAr}</span>
                  </div>
                  <p className="mt-1 text-muted">{c.explanationAr}</p>
                  {c.href ? (
                    <Link href={c.href} className="text-xs text-navy underline">
                      فتح المصدر
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
