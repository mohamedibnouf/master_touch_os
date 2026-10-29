import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyState, Field, Input, Section, Select, TableScroll } from "@/components/ui/primitives";
import { EntityHeader } from "@/components/ui/entity-header";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { CoreRepository } from "@/server/repositories/core.repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import {
  assignProjectMemberAction,
  createApprovalAction,
  startWorkflowAction,
} from "@/server/use-cases/platform";
import { WorkflowGateApprovalCard, type FrozenGateDocument, type GateSupportingDocumentOption } from "@/components/projects/workflow-gate-approval-card";
import { loadProjectWorkflowProjection } from "@/server/use-cases/project-workflow";
import { workflowStageFocusId } from "@/lib/notifications/workflow-stage-focus";
import { DocumentSourceForm } from "@/components/documents/document-source-form";
import {
  DocumentDetailsLink,
  DocumentOpenControl,
  DocumentSourceBadge,
} from "@/components/documents/document-open-control";
import { DocumentArchiveControl } from "@/components/documents/document-lifecycle-controls";
import {
  correspondenceDirectionLabel,
  correspondenceStatusLabel,
  engineeringStatusLabel,
  ncrSeverityLabel,
  reportStatusLabel,
  reportTypeLabel,
} from "@/lib/ui/engineering-labels";
import { documentStatusLabel, projectRiskLabel, projectRiskTone, projectStatusLabel, projectStatusTone } from "@/lib/ui/operational-labels";
import { commercialStatusLabel } from "@/lib/commercial/status-labels";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { ProjectProgress } from "@/components/projects/project-progress";
import { ProjectAttentionCard } from "@/components/projects/project-attention-card";
import { CaseFlowStep, ProjectCaseFlow } from "@/components/projects/project-case-flow";
import { WorkflowStageDetails } from "@/components/projects/workflow-stage-details";
import { ProjectActivityTimeline } from "@/components/projects/project-activity-timeline";
import { activityNarrative } from "@/modules/projects/approval-workflow-gate";
import { AUDIT_FEED_COLUMNS } from "@/lib/query-projections";
import { ProjectAiCard } from "@/components/ai/project-ai-card";
import { ProjectAiAssistant } from "@/components/ai/project-ai-assistant";
import { canAnalyzeProjectAi } from "@/modules/ai/security/permissions";
import { getAiPlatformConfig } from "@/modules/ai/config-env";
import { logger } from "@/lib/logger";
import { hasCatalogProjectRead } from "@/lib/projects/assigned-access";
import { PROCUREMENT_STEP_KEY, parseProcurementReadiness } from "@/modules/procurement/stage05-readiness";
import { MOBILIZATION_STEP_KEY, parseMobilizationReadiness } from "@/modules/projects/stage06-mobilization";
import { EXECUTION_STEP_KEY, parseExecutionProgress } from "@/modules/projects/stage07-execution";
import { COMMISSIONING_STEP_KEY, parseCommissioningProgress } from "@/modules/projects/stage08-commissioning";
import { HANDOVER_STEP_KEY, parseHandoverReadiness } from "@/modules/projects/stage09-handover";
import {
  currentPackageStepKeys,
  projectNeedsActivity,
  projectNeedsCommercialBundle,
  projectNeedsDocumentCatalog,
  projectNeedsEngineeringBundle,
  projectNeedsOrgUserDirectory,
  projectNeedsStagePackages,
} from "@/modules/projects/project-detail-loaders";

const LATER_TAB_KEYS = ["safety", "quality", "communications"] as const;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; stage?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { t, locale } = await getI18n();
  const td = t.projectDetail;

  const { id } = await params;
  const { tab = "overview", stage: stageParam } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const repo = new CoreRepository(supabase);
  const [project, instanceRes] = await Promise.all([
    repo.getProject(ctx.organization.id, id),
    supabase
      .from("workflow_instances")
      .select("id, status, definition_id, started_at, completed_at")
      .eq("organization_id", ctx.organization.id)
      .eq("entity_type", "project")
      .eq("entity_id", id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!project) {
    logger.warn("project route denied", {
      code: "PROJECT_ROUTE_PROJECT_NOT_VISIBLE",
      userId: ctx.userId,
      organizationId: ctx.organization.id,
      projectId: id,
      catalogRead: hasCatalogProjectRead(ctx.grants, ctx.organization.id, id),
    });
    notFound();
  }

  const needDocs = projectNeedsDocumentCatalog(tab);
  const needUsers = projectNeedsOrgUserDirectory(tab);
  const needActivity = projectNeedsActivity(tab);
  const needEng = projectNeedsEngineeringBundle(tab);
  const needCom = projectNeedsCommercialBundle(tab);
  const needPackages = projectNeedsStagePackages(tab);

  const [stages, members, documents, users, definitions, health, roleRows, departmentRows] = await Promise.all([
    repo.listProjectStages(project.id),
    repo.listProjectMembers(project.id),
    needDocs ? repo.listDocuments(ctx.organization.id, project.id) : Promise.resolve([]),
    needUsers ? repo.listUsers(ctx.organization.id) : Promise.resolve([]),
    supabase.from("workflow_definitions").select("id, name_ar, name_en").eq("status", "published").eq("entity_type", "project"),
    supabase.rpc("compute_project_health", { p_project_id: project.id }),
    supabase.from("roles").select("id, name_ar, name_en").or(`organization_id.eq.${ctx.organization.id},organization_id.is.null`),
    supabase.from("departments").select("id, name_ar, name_en").eq("organization_id", ctx.organization.id),
  ]);

  const currentFiles =
    documents.length > 0
      ? await repo.listCurrentDocumentFiles(
          ctx.organization.id,
          documents.map((d) => d.id),
        )
      : [];
  const fileByDoc = new Map(currentFiles.map((row) => [row.document_id, row]));
  const canUploadDocs = hasPermission(ctx, "document.upload");
  const canOpenStorage = hasPermission(ctx, "document.read");
  const canArchiveDocs = hasPermission(ctx, "document.archive");

  const profileNames = new Map<string, string>();
  const jobTitles = new Map<string, string>();
  for (const row of users) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const name = pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en);
    if (name) profileNames.set(row.profile_id, name);
    const employees = Array.isArray(row.employees) ? row.employees : [];
    const titledEmployee = employees.find((emp) => emp.job_title_ar || emp.job_title_en);
    const title = titledEmployee ? pickLocalized(locale, titledEmployee.job_title_ar, titledEmployee.job_title_en) : "";
    if (title) jobTitles.set(row.profile_id, title);
  }
  for (const member of members) {
    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
    const name = pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en);
    if (name && !profileNames.has(member.profile_id)) profileNames.set(member.profile_id, name);
  }
  const roleNames = new Map(
    (roleRows.data ?? []).map((r) => [r.id as string, pickLocalized(locale, r.name_ar as string, r.name_en as string)]),
  );
  const departmentNames = new Map(
    (departmentRows.data ?? []).map((d) => [d.id as string, pickLocalized(locale, d.name_ar as string, d.name_en as string)]),
  );

  const workflow = await loadProjectWorkflowProjection({
    supabase,
    ctx,
    projectId: project.id,
    stages,
    profileNames,
    roleNames,
    departmentNames,
    jobTitles,
    instance: instanceRes.data ?? null,
    locale,
  });
  const focusedStageId = workflowStageFocusId(
    workflow.nodes.map((node) => node.id),
    workflow.currentNodeId,
    stageParam,
  );
  const canOpenProcurement =
    hasPermission(ctx, "purchase_request.read") ||
    hasPermission(ctx, "rfq.read") ||
    hasPermission(ctx, "purchase_order.read") ||
    hasPermission(ctx, "procurement.read");
  const canCreatePr = hasPermission(ctx, "purchase_request.create");
  const packageKeys = needPackages ? currentPackageStepKeys(workflow.nodes) : [];
  const wantPackage = (key: string) => packageKeys.includes(key);
  const skipRpc = { data: null, error: null };
  const [procRes, mobRes, execRes, commRes, handRes] = await Promise.all([
    wantPackage(PROCUREMENT_STEP_KEY)
      ? supabase.rpc("get_project_procurement_readiness", { p_project_id: project.id })
      : Promise.resolve(skipRpc),
    wantPackage(MOBILIZATION_STEP_KEY)
      ? supabase.rpc("get_project_mobilization_readiness", { p_project_id: project.id })
      : Promise.resolve(skipRpc),
    wantPackage(EXECUTION_STEP_KEY)
      ? supabase.rpc("get_project_execution_progress", { p_project_id: project.id })
      : Promise.resolve(skipRpc),
    wantPackage(COMMISSIONING_STEP_KEY)
      ? supabase.rpc("get_project_commissioning_progress", { p_project_id: project.id })
      : Promise.resolve(skipRpc),
    wantPackage(HANDOVER_STEP_KEY)
      ? supabase.rpc("get_project_handover_readiness", { p_project_id: project.id })
      : Promise.resolve(skipRpc),
  ]);
  if (procRes.error) {
    logger.warn("project procurement readiness failed", {
      code: "PROJECT_PROCUREMENT_READINESS_FAILED",
      projectId: project.id,
    });
  }
  if (mobRes.error) {
    logger.warn("project mobilization readiness failed", {
      code: "PROJECT_MOBILIZATION_READINESS_FAILED",
      projectId: project.id,
    });
  }
  if (execRes.error) {
    logger.warn("project execution progress failed", {
      code: "PROJECT_EXECUTION_PROGRESS_FAILED",
      projectId: project.id,
    });
  }
  if (commRes.error) {
    logger.warn("project commissioning progress failed", {
      code: "PROJECT_COMMISSIONING_PROGRESS_FAILED",
      projectId: project.id,
    });
  }
  if (handRes.error) {
    logger.warn("project handover readiness failed", {
      code: "PROJECT_HANDOVER_READINESS_FAILED",
      projectId: project.id,
    });
  }
  const procurementReadiness = procRes.error ? null : parseProcurementReadiness(procRes.data);
  const mobilizationReadiness = mobRes.error ? null : parseMobilizationReadiness(mobRes.data);
  const executionProgress = execRes.error ? null : parseExecutionProgress(execRes.data);
  const commissioningProgress = commRes.error ? null : parseCommissioningProgress(commRes.data);
  const handoverReadiness = handRes.error ? null : parseHandoverReadiness(handRes.data);
  const userActive = new Map<string, boolean>();
  for (const row of users) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const employees = Array.isArray(row.employees) ? row.employees : [];
    const memberActive = row.status === "active";
    const profileActive = profile?.is_active !== false;
    const employeeOk = employees.length === 0 || employees.some((emp) => emp.is_active === true);
    userActive.set(row.profile_id, Boolean(memberActive && profileActive && employeeOk));
  }
  const responsibleCandidates: Array<{ id: string; name: string; projectRole: string | null; jobTitle: string | null }> = [];
  const seenResponsible = new Set<string>();
  for (const member of members) {
    if (!member.is_active || !userActive.get(member.profile_id)) continue;
    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
    if (profile && profile.is_active === false) continue;
    seenResponsible.add(member.profile_id);
    responsibleCandidates.push({
      id: member.profile_id,
      name:
        pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en) ||
        profileNames.get(member.profile_id) ||
        member.profile_id,
      projectRole: member.role_label ?? null,
      jobTitle: jobTitles.get(member.profile_id) ?? null,
    });
  }
  if (project.project_manager_id && userActive.get(project.project_manager_id) && !seenResponsible.has(project.project_manager_id)) {
    responsibleCandidates.unshift({
      id: project.project_manager_id,
      name: profileNames.get(project.project_manager_id) || project.project_manager_id,
      projectRole: td.team.projectManager,
      jobTitle: jobTitles.get(project.project_manager_id) ?? null,
    });
  }
  const approverOptions = users.flatMap((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const employees = Array.isArray(row.employees) ? row.employees : [];
    const memberActive = row.status === "active";
    const profileActive = profile?.is_active !== false;
    const employeeOk = employees.length === 0 || employees.some((emp) => emp.is_active === true);
    if (!memberActive || !profileActive || !employeeOk) return [];
    return [{ id: row.profile_id, name: pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en) || row.profile_id }];
  });
  const managerName = project.project_manager_id ? (profileNames.get(project.project_manager_id) ?? null) : null;

  const versionIds = documents.map((d) => d.id);
  const { data: currentVersionRows } =
    versionIds.length === 0
      ? { data: [] as Array<{
          id: string;
          document_id: string;
          revision: string;
          file_source: string | null;
          file_path: string | null;
          external_url: string | null;
          is_current: boolean;
        }> }
      : await supabase
          .from("document_versions")
          .select("id, document_id, revision, file_source, file_path, external_url, is_current")
          .eq("organization_id", ctx.organization.id)
          .eq("is_current", true)
          .in("document_id", versionIds);
  const versionByDoc = new Map((currentVersionRows ?? []).map((row) => [row.document_id as string, row]));
  const gateDocumentOptions: GateSupportingDocumentOption[] = documents.flatMap((doc) => {
    const ver = versionByDoc.get(doc.id);
    if (!ver) return [];
    return [
      {
        documentId: doc.id,
        documentVersionId: ver.id as string,
        title: doc.title,
        revision: (ver.revision as string) || doc.current_revision,
        fileSource: (ver.file_source as string | null) ?? null,
        isCurrent: ver.is_current === true,
        filePath: (ver.file_path as string | null) ?? null,
        externalUrl: (ver.external_url as string | null) ?? null,
      },
    ];
  });

  const currentWorkflowNode = workflow.nodes.find((n) => n.id === workflow.currentNodeId) ?? null;
  const showWorkflowGateCard = Boolean(
    workflow.mode === "workflow" &&
      currentWorkflowNode &&
      currentWorkflowNode.requiresApproval &&
      (currentWorkflowNode.engineStatus === "ready" || currentWorkflowNode.engineStatus === "in_progress"),
  );
  let frozenGateDocuments: FrozenGateDocument[] = [];
  let gateSubmittedAt: string | null = null;
  if (currentWorkflowNode?.openApproval?.requestId) {
    const [{ data: requestMeta }, { data: linkedDocs }] = await Promise.all([
      supabase
        .from("approval_requests")
        .select("created_at")
        .eq("id", currentWorkflowNode.openApproval.requestId)
        .eq("organization_id", ctx.organization.id)
        .maybeSingle<{ created_at: string }>(),
      supabase
        .from("approval_request_documents")
        .select("document_id, document_version_id, revision, documents(title), document_versions(file_source, file_path, external_url)")
        .eq("approval_request_id", currentWorkflowNode.openApproval.requestId)
        .eq("organization_id", ctx.organization.id),
    ]);
    gateSubmittedAt = requestMeta?.created_at ?? null;
    frozenGateDocuments = (linkedDocs ?? []).map((row) => {
      const docs = row.documents as { title?: string } | { title?: string }[] | null;
      const vers = row.document_versions as
        | { file_source?: string | null; file_path?: string | null; external_url?: string | null }
        | Array<{ file_source?: string | null; file_path?: string | null; external_url?: string | null }>
        | null;
      const title = Array.isArray(docs) ? docs[0]?.title : docs?.title;
      const file = Array.isArray(vers) ? vers[0] : vers;
      return {
        documentId: row.document_id as string,
        documentVersionId: row.document_version_id as string,
        title: title ?? td.documents.untitled,
        revision: row.revision as string,
        fileSource: file?.file_source ?? null,
        filePath: file?.file_path ?? null,
        externalUrl: file?.external_url ?? null,
      };
    });
  }

  const activityIds = [project.id, workflow.instanceId, ...workflow.nodes.map((n) => n.id)].filter(
    (value): value is string => Boolean(value),
  );
  const { data: activityRows } = needActivity
    ? await supabase
        .from("audit_logs")
        .select(AUDIT_FEED_COLUMNS)
        .eq("organization_id", ctx.organization.id)
        .in("entity_id", activityIds)
        .order("created_at", { ascending: false })
        .limit(30)
    : { data: [] as Array<{
        id: string;
        action: string;
        entity_type: string;
        created_at: string;
        actor_id: string | null;
        new_values: unknown;
      }> };
  const activityItems = (activityRows ?? []).map((row) => ({
    id: row.id as string,
    action: row.action as string,
    entityType: row.entity_type as string,
    createdAt: row.created_at as string,
    actorLabel: row.actor_id ? (profileNames.get(row.actor_id as string) ?? null) : null,
    automaticDetail: activityNarrative(row.action as string, row.new_values, locale),
  }));

  const canSeeFinance =
    hasPermission(ctx, "finance.read") || hasPermission(ctx, "commercial_reports.read");
  const emptyList = { data: [] as never[], error: null };
  const tabIds = [
    "overview",
    "stages",
    "team",
    "engineering",
    "documents",
    "rfis",
    "submittals",
    "shop",
    "inspections",
    "ncr",
    "reports",
    "correspondence",
    "commercial",
    "approvals",
    "activity",
    ...(canAnalyzeProjectAi(ctx) ? (["ai"] as const) : []),
  ] as const;
  const tabs = tabIds.map((tabId) => ({ id: tabId, label: td.tabs[tabId] }));

  const [projectRfis, projectMats, projectShds, projectIrs, projectNcrs, projectReports, projectCors, projectPrs, projectPos, projectSupplierInv, commercialSummary, commercialHealth] =
    await Promise.all([
      needEng
        ? supabase
            .from("rfis")
            .select("id, rfi_number, subject, status")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve(emptyList),
      needEng
        ? supabase
            .from("material_submittals")
            .select("id, mat_number, material_category, status, official_decision")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve(emptyList),
      needEng
        ? supabase
            .from("shop_drawings")
            .select("id, shd_number, drawing_title, status, approved_for_execution")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve(emptyList),
      needEng
        ? supabase
            .from("inspection_requests")
            .select("id, ir_number, related_activity, status")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve(emptyList),
      needEng
        ? supabase
            .from("ncrs")
            .select("id, ncr_number, severity, status, description")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve(emptyList),
      needEng
        ? supabase
            .from("project_reports")
            .select("id, report_type, period_start, period_end, status")
            .eq("project_id", project.id)
            .order("period_start", { ascending: false })
            .limit(20)
        : Promise.resolve(emptyList),
      needEng
        ? supabase
            .from("correspondence")
            .select("id, reference_number, subject, direction, status")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve(emptyList),
      needCom
        ? supabase
            .from("purchase_requests")
            .select("id, pr_number, status, estimated_cost, currency")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve(emptyList),
      needCom
        ? supabase
            .from("purchase_orders")
            .select("id, po_number, status, total, currency")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve(emptyList),
      needCom
        ? supabase
            .from("supplier_invoices")
            .select("id, invoice_number, status, total, currency, due_date")
            .eq("project_id", project.id)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve(emptyList),
      needCom && canSeeFinance
        ? supabase.rpc("compute_project_commercial_summary", { p_project_id: project.id })
        : Promise.resolve({ data: null, error: null }),
      needCom && canSeeFinance
        ? supabase.rpc("compute_project_commercial_health", { p_project_id: project.id })
        : Promise.resolve({ data: null, error: null }),
    ]);

  const currentStage = workflow.nodes.find((n) => n.id === workflow.currentNodeId);
  const progressTone =
    workflow.progress.total > 0 && workflow.progress.completed === workflow.progress.total
      ? "success"
      : currentStage?.visual === "overdue" || currentStage?.deadlineState === "OVERDUE"
        ? "danger"
        : currentStage?.deadlineState === "DUE_SOON"
          ? "warning"
          : "info";
  const healthTone =
    health.data === "red" ? "danger" : health.data === "amber" ? "warning" : "success";
  const healthLabel =
    health.data === "red" ? td.health.red : health.data === "amber" ? td.health.amber : td.health.green;
  const commercialHealthLabel =
    commercialHealth.data === "red"
      ? td.health.red
      : commercialHealth.data === "amber"
        ? td.health.amber
        : commercialHealth.data === "green"
          ? td.health.green
          : String(commercialHealth.data ?? "");
  const summaryKeyLabels: Record<string, string> = td.commercial.summaryKeys;
  const numberFormat = new Intl.NumberFormat(intlLocale(locale));
  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString(intlLocale(locale), { timeZone: "Asia/Riyadh" });
  const statusText = (status: string) => commercialStatusLabel(status, locale);
  const definitionLabel = (item: { name_ar: string | null; name_en: string | null }) =>
    pickLocalized(locale, item.name_ar, item.name_en);
  const userLabel = (row: (typeof users)[number]) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en) || row.profile_id;
  };
  const projectTitle = pickLocalized(locale, project.name_ar, project.name_en);
  const projectAltName = locale === "ar" ? project.name_en : project.name_ar;
  const currentStageName = currentStage ? pickLocalized(locale, currentStage.nameAr, currentStage.nameEn) : "—";
  const commercialLinkClass = "text-sm font-medium text-primary underline-offset-4 hover:underline";

  return (
    <PageContainer className="space-y-5">
      <EntityHeader
        initials={project.project_code.slice(0, 2)}
        title={projectTitle}
        subtitle={projectAltName ? `${project.project_code} · ${projectAltName}` : project.project_code}
        meta={
          <span>
            <bdi>{format(td.header.currentStage, { stage: currentStageName })}</bdi>
            {managerName ? (
              <>
                {" · "}
                <bdi>{format(td.header.owner, { name: managerName })}</bdi>
              </>
            ) : null}
          </span>
        }
        badges={
          <>
            <Badge tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status, locale)}</Badge>
            <Badge tone={projectRiskTone(project.risk_level)}>
              {format(td.header.risk, { risk: projectRiskLabel(project.risk_level, locale) })}
            </Badge>
            <Badge tone={healthTone as "danger" | "warning" | "success"}>
              {format(td.header.health, { health: healthLabel })}
            </Badge>
            {project.planned_end_date ? (
              <Badge>{format(td.header.due, { date: project.planned_end_date })}</Badge>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <Card>
          <ProjectProgress
            percent={workflow.progress.percent}
            completed={workflow.progress.completed}
            total={workflow.progress.total}
            tone={progressTone}
          />
          <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
            {format(td.header.requiredAction, { action: workflow.nextRequiredAction })}
          </p>
        </Card>
        <ProjectAttentionCard attention={workflow.attention} />
      </div>
      {canAnalyzeProjectAi(ctx) ? (
        <ProjectAiCard projectId={project.id} enabled={getAiPlatformConfig().enabled} />
      ) : null}

      <nav
        aria-label={td.tabsAria}
        className="mb-6 flex min-w-0 max-w-full gap-1 overflow-x-auto overscroll-x-contain border-b border-line pb-2 whitespace-nowrap"
      >
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={`/projects/${project.id}?tab=${item.id}`}
            prefetch={false}
            aria-current={tab === item.id ? "page" : undefined}
            className={`inline-block shrink-0 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors ${tab === item.id ? "bg-primary/10 font-medium text-primary" : "text-muted hover:bg-surface-muted hover:text-ink"}`}
          >
            {item.label}
          </Link>
        ))}
        {LATER_TAB_KEYS.map((key) => (
          <span
            key={key}
            aria-disabled="true"
            className="inline-block shrink-0 rounded-[var(--radius-control)] px-3 py-2 text-sm text-muted/50"
          >
            {format(td.laterTab, { label: td.laterTabs[key] })}
          </span>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Section title={td.overview.basicInfo}>
            <dl className="divide-y divide-line text-sm">
              <div className="flex justify-between gap-4 py-2 first:pt-0">
                <dt className="text-muted">{td.overview.location}</dt>
                <dd className="text-ink" dir="auto">{project.location ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-muted">{td.overview.start}</dt>
                <dd className="tabular-nums text-ink">{project.start_date ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-muted">{td.overview.plannedEnd}</dt>
                <dd className="tabular-nums text-ink">{project.planned_end_date ?? "—"}</dd>
              </div>
              {canSeeFinance ? (
                <>
                  <div className="flex justify-between gap-4 py-2">
                    <dt className="text-muted">{td.overview.contractValue}</dt>
                    <dd className="tabular-nums text-ink">{project.contract_value ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2">
                    <dt className="text-muted">{td.overview.budget}</dt>
                    <dd className="tabular-nums text-ink">{project.budget ?? "—"}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </Section>
          <Section title={td.overview.description}>
            <p className="text-sm leading-7 text-muted" dir="auto">
              {project.description ?? td.overview.noDescription}
            </p>
          </Section>
        </div>
      ) : null}

      {tab === "stages" ? (
        <div className="space-y-4">
          {workflow.mode === "empty" ? (
            <EmptyState title={td.stages.empty} />
          ) : (
            <>
              <Card className="p-4 md:p-5">
                <p className="mb-4 text-sm text-muted">
                  {workflow.definitionName ? (
                    <bdi>
                      {format(td.stages.definitionLine, { name: workflow.definitionName })}
                      {workflow.mode === "preview" ? ` — ${td.stages.previewHint}` : ""}
                    </bdi>
                  ) : (
                    td.stages.defaultHint
                  )}
                </p>
                <ProjectCaseFlow>
                  {workflow.nodes.map((node, index) => (
                    <CaseFlowStep
                      key={node.id}
                      node={node}
                      current={node.id === focusedStageId}
                      isLast={index === workflow.nodes.length - 1}
                      projectId={project.id}
                      candidates={responsibleCandidates}
                    >
                      <WorkflowStageDetails
                        node={node}
                        projectId={project.id}
                        projectCode={project.project_code}
                        approvers={approverOptions}
                        documents={gateDocumentOptions}
                        procurementReadiness={procurementReadiness}
                        canOpenProcurement={canOpenProcurement}
                        canCreatePr={canCreatePr}
                        mobilizationReadiness={mobilizationReadiness}
                        executionProgress={executionProgress}
                        commissioningProgress={commissioningProgress}
                        handoverReadiness={handoverReadiness}
                      />
                    </CaseFlowStep>
                  ))}
                </ProjectCaseFlow>
              </Card>
            </>
          )}
          {hasPermission(ctx, "workflow.start") && workflow.mode !== "workflow" ? (
            <Section title={td.stages.startWorkflow}>
              {(definitions.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">{td.stages.noTemplates}</p>
              ) : (
                <ServerActionForm action={startWorkflowAction} className="space-y-3">
                  <input type="hidden" name="entityType" value="project" />
                  <input type="hidden" name="entityId" value={project.id} />
                  <Field label={td.stages.template}>
                    <Select name="definitionId" required>
                      {(definitions.data ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {definitionLabel(item)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button type="submit">{td.stages.startButton}</Button>
                </ServerActionForm>
              )}
            </Section>
          ) : null}
        </div>
      ) : null}

      {tab === "team" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={td.team.members}>
            {members.length === 0 ? (
              <p className="text-sm text-muted">{td.team.noMembers}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {members.map((member) => {
                  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
                  return (
                    <li key={member.id} className="flex justify-between gap-4 py-2 first:pt-0">
                      <span className="font-medium text-ink" dir="auto">
                        {pickLocalized(locale, profile?.full_name_ar, profile?.full_name_en)}
                      </span>
                      <span className="text-muted" dir="auto">{member.role_label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          {hasPermission(ctx, "project.manage_team") ? (
            <Section title={td.team.assign}>
              <ServerActionForm action={assignProjectMemberAction} className="space-y-3">
                <input type="hidden" name="projectId" value={project.id} />
                <Field label={td.team.user}>
                  <Select name="profileId" required>
                    {users.map((row) => (
                      <option key={row.profile_id} value={row.profile_id}>
                        {userLabel(row)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={td.team.projectRole}>
                  <Input name="roleLabel" defaultValue="member" />
                </Field>
                <Button type="submit">{td.team.assignButton}</Button>
              </ServerActionForm>
            </Section>
          ) : null}
        </div>
      ) : null}

      {tab === "engineering" ? (
        <Section
          title={td.engineering.title}
          description={format(td.engineering.description, { health: healthLabel })}
        >
          <div className="flex flex-wrap gap-3">
            <a
              href={`/engineering?project=${project.id}`}
              className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover md:min-h-9"
            >
              {td.engineering.openBoard}
            </a>
            <a
              href={`/document-control?q=${encodeURIComponent(project.project_code)}`}
              className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted md:min-h-9"
            >
              {td.engineering.documentControl}
            </a>
          </div>
        </Section>
      ) : null}

      {tab === "rfis" ? (
        <ProjectMiniTable
          title={td.rfis.title}
          empty={td.rfis.empty}
          headers={[td.columns.number, td.columns.subject, td.columns.status]}
          rows={(projectRfis.data ?? []).map((r) => [r.rfi_number, r.subject, engineeringStatusLabel(r.status, locale)])}
          actionHref={`/engineering?module=rfi&project=${project.id}`}
          actionLabel={td.rfis.action}
        />
      ) : null}

      {tab === "submittals" ? (
        <ProjectMiniTable
          title={td.submittals.title}
          empty={td.submittals.empty}
          headers={[td.columns.number, td.columns.category, td.columns.status, td.columns.decision]}
          rows={(projectMats.data ?? []).map((m) => [
            m.mat_number,
            m.material_category,
            engineeringStatusLabel(m.status, locale),
            m.official_decision ?? "—",
          ])}
          actionHref={`/engineering?module=mat&project=${project.id}`}
          actionLabel={td.submittals.action}
        />
      ) : null}

      {tab === "shop" ? (
        <ProjectMiniTable
          title={td.shop.title}
          empty={td.shop.empty}
          headers={[td.columns.number, td.columns.title, td.columns.status, td.columns.approvedForExecution]}
          rows={(projectShds.data ?? []).map((s) => [
            s.shd_number,
            s.drawing_title,
            engineeringStatusLabel(s.status, locale),
            s.approved_for_execution ? td.columns.approvedForExecution : "—",
          ])}
          actionHref={`/engineering?module=shd&project=${project.id}`}
          actionLabel={td.shop.action}
        />
      ) : null}

      {tab === "inspections" ? (
        <ProjectMiniTable
          title={td.inspections.title}
          empty={td.inspections.empty}
          headers={[td.columns.number, td.columns.activity, td.columns.status]}
          rows={(projectIrs.data ?? []).map((i) => [i.ir_number, i.related_activity ?? "—", engineeringStatusLabel(i.status, locale)])}
          actionHref={`/engineering?module=ir&project=${project.id}`}
          actionLabel={td.inspections.action}
        />
      ) : null}

      {tab === "ncr" ? (
        <ProjectMiniTable
          title={td.ncr.title}
          empty={td.ncr.empty}
          headers={[td.columns.number, td.columns.description, td.columns.severity, td.columns.status]}
          rows={(projectNcrs.data ?? []).map((n) => [
            n.ncr_number,
            n.description.slice(0, 80),
            ncrSeverityLabel(n.severity, locale),
            engineeringStatusLabel(n.status, locale),
          ])}
          actionHref={`/engineering?module=ncr&project=${project.id}`}
          actionLabel={td.ncr.action}
        />
      ) : null}

      {tab === "reports" ? (
        <ProjectMiniTable
          title={td.reports.title}
          empty={td.reports.empty}
          headers={[td.columns.type, td.columns.from, td.columns.to, td.columns.status]}
          rows={(projectReports.data ?? []).map((r) => [
            reportTypeLabel(r.report_type, locale),
            r.period_start,
            r.period_end,
            reportStatusLabel(r.status, locale),
          ])}
        />
      ) : null}

      {tab === "correspondence" ? (
        <ProjectMiniTable
          title={td.correspondence.title}
          empty={td.correspondence.empty}
          headers={[td.columns.reference, td.columns.subject, td.columns.direction, td.columns.status]}
          rows={(projectCors.data ?? []).map((c) => [
            c.reference_number,
            c.subject,
            correspondenceDirectionLabel(c.direction, locale),
            correspondenceStatusLabel(c.status, locale),
          ])}
        />
      ) : null}

      {tab === "commercial" ? (
        <div className="space-y-6">
          {canSeeFinance && commercialSummary.data ? (
            <Section
              title={td.commercial.summary}
              actions={
                commercialHealth.data ? (
                  <Badge
                    tone={
                      commercialHealth.data === "red"
                        ? "danger"
                        : commercialHealth.data === "amber"
                          ? "warning"
                          : "success"
                    }
                  >
                    {format(td.commercial.health, { health: commercialHealthLabel })}
                  </Badge>
                ) : null
              }
            >
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(commercialSummary.data as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-line pb-2">
                    <dt className="text-muted">{summaryKeyLabels[k] ?? k}</dt>
                    <dd className="font-medium tabular-nums text-ink">{numberFormat.format(Number(v))}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : (
            <Card>
              <p className="text-sm text-muted">{td.commercial.noPermission}</p>
            </Card>
          )}
          {canSeeFinance ? (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Link href={`/projects/${id}/commercial/contract`} className={commercialLinkClass}>
                {td.commercial.links.contract}
              </Link>
              <Link href={`/projects/${id}/commercial/milestones`} className={commercialLinkClass}>
                {td.commercial.links.milestones}
              </Link>
              <Link href={`/projects/${id}/commercial/cashflow`} className={commercialLinkClass}>
                {td.commercial.links.cashflow}
              </Link>
              <Link href="/finance/client-valuations" className={commercialLinkClass}>
                {td.commercial.links.clientValuations}
              </Link>
              <Link href="/finance/variations" className={commercialLinkClass}>
                {td.commercial.links.variations}
              </Link>
            </div>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <ProjectMiniTable
              title={td.commercial.purchaseRequests.title}
              empty={td.commercial.purchaseRequests.empty}
              headers={[td.columns.number, td.columns.status, td.columns.cost]}
              rows={(projectPrs.data ?? []).map((p) => [
                p.pr_number,
                statusText(p.status),
                p.estimated_cost != null ? `${p.estimated_cost} ${p.currency}` : "—",
              ])}
              actionHref={`/procurement?project=${project.id}`}
              actionLabel={td.commercial.procurementAction}
            />
            <ProjectMiniTable
              title={td.commercial.purchaseOrders.title}
              empty={td.commercial.purchaseOrders.empty}
              headers={[td.columns.number, td.columns.status, td.columns.total]}
              rows={(projectPos.data ?? []).map((p) => [
                p.po_number,
                statusText(p.status),
                `${p.total} ${p.currency}`,
              ])}
              actionHref={`/procurement?project=${project.id}`}
              actionLabel={td.commercial.procurementAction}
            />
          </div>
          {canSeeFinance ? (
            <ProjectMiniTable
              title={td.commercial.supplierInvoices.title}
              empty={td.commercial.supplierInvoices.empty}
              headers={[td.columns.number, td.columns.status, td.columns.amount, td.columns.dueDate]}
              rows={(projectSupplierInv.data ?? []).map((i) => [
                i.invoice_number,
                statusText(i.status),
                `${i.total} ${i.currency}`,
                i.due_date ?? "—",
              ])}
              actionHref="/finance"
              actionLabel={td.commercial.financeAction}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "documents" ? (
        <div className="space-y-4" data-testid="project-documents-panel">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-ink">{td.documents.title}</h2>
            {documents.length === 0 ? (
              <EmptyState title={td.documents.empty} />
            ) : (
              <>
                <ul className="space-y-3 md:hidden">
                  {documents.map((doc) => {
                    const file = fileByDoc.get(doc.id) ?? null;
                    return (
                      <li key={doc.id} className="rounded-[var(--radius-control)] border border-line p-3">
                        <p className="font-medium text-ink" dir="auto">{doc.title}</p>
                        <p className="mt-1 text-xs text-muted">
                          {doc.document_number ? `${doc.document_number} · ` : ""}
                          {doc.category} · {doc.current_revision} · {documentStatusLabel(doc.status, locale)}
                        </p>
                        <p className="mt-1 text-xs text-muted">{formatDateTime(doc.updated_at)}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <DocumentSourceBadge source={file?.file_source} />
                          <DocumentOpenControl documentId={doc.id} file={file} canOpenStorage={canOpenStorage} />
                          <DocumentDetailsLink documentId={doc.id} />
                          {canArchiveDocs ? (
                            <DocumentArchiveControl documentId={doc.id} fileSource={file?.file_source} />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <TableScroll className="hidden rounded-[var(--radius-control)] border border-line md:block">
                  <table className="min-w-full text-sm">
                    <thead className="bg-surface-muted text-xs text-muted">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium">{td.documents.document}</th>
                        <th className="px-3 py-2 text-start font-medium">{td.documents.category}</th>
                        <th className="px-3 py-2 text-start font-medium">{td.documents.revision}</th>
                        <th className="px-3 py-2 text-start font-medium">{td.documents.status}</th>
                        <th className="px-3 py-2 text-start font-medium">{td.documents.updated}</th>
                        <th className="px-3 py-2 text-start font-medium">{td.documents.source}</th>
                        <th className="px-3 py-2 text-start font-medium">{td.documents.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => {
                        const file = fileByDoc.get(doc.id) ?? null;
                        return (
                          <tr key={doc.id} className="border-t border-line hover:bg-surface-muted/60">
                            <td className="px-3 py-2">
                              <p className="font-medium text-ink" dir="auto">{doc.title}</p>
                              {doc.document_number ? (
                                <p className="text-xs text-muted">{doc.document_number}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">{doc.category}</td>
                            <td className="px-3 py-2 tabular-nums">{doc.current_revision}</td>
                            <td className="px-3 py-2">{documentStatusLabel(doc.status, locale)}</td>
                            <td className="px-3 py-2 text-muted">{formatDateTime(doc.updated_at)}</td>
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
                                {canArchiveDocs ? (
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
                {documents.length >= 50 ? (
                  <p className="mt-2 text-xs text-muted">{td.documents.latestLimit}</p>
                ) : null}
              </>
            )}
          </Card>
          {canUploadDocs ? (
            <Card data-testid="project-add-document">
              <h2 className="mb-4 text-sm font-semibold text-ink">{td.documents.add}</h2>
              <DocumentSourceForm projectId={project.id} />
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "approvals" ? (
        <div className="space-y-4">
          {showWorkflowGateCard && currentWorkflowNode ? (
            <WorkflowGateApprovalCard
              node={currentWorkflowNode}
              projectId={project.id}
              projectCode={project.project_code}
              approvers={approverOptions}
              documents={gateDocumentOptions}
              frozenDocuments={frozenGateDocuments}
              submittedAt={gateSubmittedAt}
              canCreate={hasPermission(ctx, "approval.create")}
              canOpenStorage={canOpenStorage}
            />
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {hasPermission(ctx, "approval.create") ? (
              <Card data-testid="generic-project-approval-card">
                <h2 className="mb-1 text-sm font-semibold text-ink">{td.approvals.genericTitle}</h2>
                <p className="mb-4 text-sm text-muted">{td.approvals.genericDescription}</p>
                <ServerActionForm action={createApprovalAction} className="space-y-3">
                  <input type="hidden" name="entityType" value="project" />
                  <input type="hidden" name="entityId" value={project.id} />
                  <input type="hidden" name="projectId" value={project.id} />
                  <Field label={td.approvals.titleLabel}>
                    <Input
                      name="title"
                      defaultValue={format(td.approvals.defaultTitle, { code: project.project_code })}
                      required
                    />
                  </Field>
                  <Field label={td.approvals.approver}>
                    <Select name="approverProfileId" required>
                      {users.map((row) => (
                        <option key={row.profile_id} value={row.profile_id}>
                          {userLabel(row)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button type="submit">{td.approvals.createGeneric}</Button>
                </ServerActionForm>
              </Card>
            ) : null}
            {hasPermission(ctx, "workflow.start") && workflow.mode !== "workflow" ? (
              <Section title={td.stages.startWorkflow}>
                {(definitions.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted">{td.stages.noTemplates}</p>
                ) : (
                  <ServerActionForm action={startWorkflowAction} className="space-y-3">
                    <input type="hidden" name="entityType" value="project" />
                    <input type="hidden" name="entityId" value={project.id} />
                    <Field label={td.stages.template}>
                      <Select name="definitionId" required>
                        {(definitions.data ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {definitionLabel(item)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button type="submit">{td.stages.startShort}</Button>
                  </ServerActionForm>
                )}
              </Section>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "activity" ? <ProjectActivityTimeline items={activityItems} /> : null}

      {tab === "ai" && canAnalyzeProjectAi(ctx) ? (
        <ProjectAiAssistant projectId={project.id} enabled={getAiPlatformConfig().enabled} />
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
    <Section
      title={title}
      actions={
        actionHref && actionLabel ? (
          <a href={actionHref} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {actionLabel}
          </a>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <TableScroll className="rounded-[var(--radius-control)] border border-line">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-xs text-muted">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-line hover:bg-surface-muted/60">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 ${j === 0 ? "font-medium text-ink" : ""}`} dir="auto">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Section>
  );
}
