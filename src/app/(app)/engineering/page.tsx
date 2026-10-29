import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  StatCard,
  TableScroll,
} from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { getI18n } from "@/lib/i18n/server";
import { intlLocale, pickLocalized, type Locale } from "@/lib/i18n/config";
import {
  engineeringStatusLabel,
  engineeringStatusTone,
  ncrSeverityLabel,
  officialDecisionTone,
  officialDecisionWithCode,
  rfiPriorityLabel,
  severityTone,
} from "@/lib/ui/engineering-labels";
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

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const INSPECTION_RESULTS = ["passed", "passed_with_comments", "failed"] as const;

const thClass = "px-3 py-2.5 text-start text-xs font-medium text-muted";
const tdClass = "px-3 py-2.5 align-top";

type ProjectOption = { id: string; project_code: string; name_ar: string | null; name_en: string | null };
type DisciplineOption = { code: string; name_ar: string | null; name_en: string | null };

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

  const { t, locale } = await getI18n();
  const e = t.engineering;
  const { project: projectFilter, module: moduleFilter = "rfi" } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const now = new Date().toISOString();
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "Asia/Riyadh" });

  const [projects, disciplines] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, name_ar, name_en")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("engineering_disciplines")
      .select("code, name_ar, name_en")
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

  const projectOptions: ProjectOption[] = projects.data ?? [];
  const disciplineOptions: DisciplineOption[] = disciplines.data ?? [];
  const defaultProject = projectFilter || projectOptions[0]?.id || "";
  const modules = [
    { id: "rfi", label: e.modules.rfi },
    { id: "mat", label: e.modules.mat },
    { id: "shd", label: e.modules.shd },
    { id: "ms", label: e.modules.ms },
    { id: "ir", label: e.modules.ir },
    { id: "ncr", label: e.modules.ncr },
  ];

  const projectQs = projectFilter ? `&project=${projectFilter}` : "";

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        title={e.title}
        description={e.description}
        actions={
          <Link href="/document-control" className="text-sm font-medium text-primary hover:underline">
            {e.documentControlLink}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={e.stats.overdueRfis} value={overdueRfis.length} tone="danger" />
        <StatCard
          label={e.stats.pendingMaterials}
          value={(mats.data ?? []).filter((m) => !["approved", "closed", "rejected"].includes(m.status)).length}
          tone="info"
        />
        <StatCard
          label={e.stats.approvedForExecution}
          value={(shds.data ?? []).filter((s) => s.approved_for_execution).length}
          tone="success"
        />
        <StatCard
          label={e.stats.failedInspections}
          value={(irs.data ?? []).filter((i) => i.status === "failed").length}
          tone="danger"
        />
        <StatCard
          label={e.stats.openNcrsResubmissions}
          value={(ncrs.data ?? []).filter((n) => n.status !== "closed").length + (pendingDocs.data ?? []).length}
          tone="warning"
        />
      </div>

      <nav aria-label={e.common.modulesLabel} className="flex flex-wrap gap-2 border-b border-line pb-2">
        {modules.map((m) => (
          <a
            key={m.id}
            href={`/engineering?module=${m.id}${projectQs}`}
            aria-current={moduleFilter === m.id ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              moduleFilter === m.id ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-ink"
            }`}
          >
            {m.label}
          </a>
        ))}
      </nav>

      {defaultProject && moduleFilter === "rfi" && hasPermission(ctx, "rfi.create") ? (
        <Section title={e.rfis.createTitle}>
          <ServerActionForm action={createRfiAction} className="grid gap-3 md:grid-cols-2">
            <ProjectField label={e.common.project} projects={projectOptions} defaultValue={defaultProject} locale={locale} />
            <DisciplineField
              label={e.common.discipline}
              disciplines={disciplineOptions}
              defaultValue="GENERAL"
              required
              withName
              locale={locale}
            />
            <Field label={e.rfis.subject} required>
              <Input name="subject" required />
            </Field>
            <Field label={e.rfis.priority}>
              <Select name="priority" defaultValue="medium">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {rfiPriorityLabel(p, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label={e.rfis.question} required>
                <Input name="question" required />
              </Field>
            </div>
            <div>
              <Button type="submit">{e.rfis.create}</Button>
            </div>
          </ServerActionForm>
        </Section>
      ) : null}

      {defaultProject && moduleFilter === "mat" && hasPermission(ctx, "submittal.create") ? (
        <Section title={e.submittals.createTitle}>
          <ServerActionForm action={createMaterialSubmittalAction} className="grid gap-3 md:grid-cols-2">
            <ProjectField label={e.common.project} projects={projectOptions} defaultValue={defaultProject} locale={locale} />
            <DisciplineField label={e.common.discipline} disciplines={disciplineOptions} defaultValue="GENERAL" locale={locale} />
            <Field label={e.submittals.materialCategory} required>
              <Input name="materialCategory" required />
            </Field>
            <Field label={e.submittals.manufacturer}>
              <Input name="manufacturer" />
            </Field>
            <div className="md:col-span-2">
              <Field label={e.submittals.technicalDescription}>
                <Input name="technicalDescription" />
              </Field>
            </div>
            <div>
              <Button type="submit">{e.submittals.create}</Button>
            </div>
          </ServerActionForm>
        </Section>
      ) : null}

      {defaultProject && moduleFilter === "shd" && hasPermission(ctx, "shop_drawing.create") ? (
        <Section title={e.shopDrawings.createTitle}>
          <ServerActionForm action={createShopDrawingAction} className="grid gap-3 md:grid-cols-2">
            <ProjectField label={e.common.project} projects={projectOptions} defaultValue={defaultProject} locale={locale} />
            <DisciplineField label={e.common.discipline} disciplines={disciplineOptions} defaultValue="ELEC" locale={locale} />
            <Field label={e.shopDrawings.drawingTitle} required>
              <Input name="drawingTitle" required />
            </Field>
            <Field label={e.shopDrawings.drawingNumber}>
              <Input name="drawingNumber" dir="ltr" />
            </Field>
            <Field label={e.shopDrawings.floorZone}>
              <Input name="floorZone" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{e.shopDrawings.create}</Button>
            </div>
          </ServerActionForm>
        </Section>
      ) : null}

      {defaultProject && moduleFilter === "ms" && hasPermission(ctx, "method_statement.create") ? (
        <Section title={e.methodStatements.createTitle}>
          <ServerActionForm action={createMethodStatementAction} className="grid gap-3 md:grid-cols-2">
            <ProjectField label={e.common.project} projects={projectOptions} defaultValue={defaultProject} locale={locale} />
            <DisciplineField label={e.common.discipline} disciplines={disciplineOptions} defaultValue="GENERAL" locale={locale} />
            <Field label={e.methodStatements.activity} required>
              <Input name="activity" required />
            </Field>
            <Field label={e.methodStatements.scope}>
              <Input name="scope" />
            </Field>
            <div className="md:col-span-2">
              <Field label={e.methodStatements.procedure}>
                <Input name="methodProcedure" />
              </Field>
            </div>
            <div>
              <Button type="submit">{e.methodStatements.create}</Button>
            </div>
          </ServerActionForm>
        </Section>
      ) : null}

      {defaultProject && moduleFilter === "ir" && hasPermission(ctx, "inspection.create") ? (
        <Section title={e.inspections.createTitle}>
          <ServerActionForm action={createInspectionRequestAction} className="grid gap-3 md:grid-cols-2">
            <ProjectField label={e.common.project} projects={projectOptions} defaultValue={defaultProject} locale={locale} />
            <DisciplineField label={e.common.discipline} disciplines={disciplineOptions} defaultValue="GENERAL" locale={locale} />
            <Field label={e.inspections.activity} required>
              <Input name="relatedActivity" required />
            </Field>
            <Field label={e.inspections.location}>
              <Input name="location" />
            </Field>
            <Field label={e.inspections.inspectionDate}>
              <Input name="inspectionDate" type="date" />
            </Field>
            <div className="flex items-end">
              <Button type="submit">{e.inspections.create}</Button>
            </div>
          </ServerActionForm>
        </Section>
      ) : null}

      {defaultProject && moduleFilter === "ncr" && hasPermission(ctx, "ncr.create") ? (
        <Section title={e.ncrs.createTitle}>
          <ServerActionForm action={createNcrAction} className="grid gap-3 md:grid-cols-2">
            <ProjectField label={e.common.project} projects={projectOptions} defaultValue={defaultProject} locale={locale} />
            <DisciplineField label={e.common.discipline} disciplines={disciplineOptions} defaultValue="GENERAL" locale={locale} />
            <div className="md:col-span-2">
              <Field label={e.ncrs.description} required>
                <Input name="description" required />
              </Field>
            </div>
            <Field label={e.ncrs.severity}>
              <Select name="severity" defaultValue="medium">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {ncrSeverityLabel(p, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="danger">
                {e.ncrs.create}
              </Button>
            </div>
          </ServerActionForm>
        </Section>
      ) : null}

      {moduleFilter === "rfi" ? (
        <Section title={e.rfis.registerTitle}>
          {(rfis.data ?? []).length === 0 ? (
            <EmptyState title={e.rfis.empty} />
          ) : (
            <TableScroll>
              <table className="min-w-full text-sm">
                <thead className="bg-surface-muted">
                  <tr>
                    <th className={thClass}>{e.common.number}</th>
                    <th className={thClass}>{e.rfis.subject}</th>
                    <th className={thClass}>{e.rfis.responseDue}</th>
                    <th className={thClass}>{e.common.status}</th>
                    <th className={thClass}>{e.common.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {(rfis.data ?? []).map((rfi) => {
                    const overdue =
                      rfi.response_required_by &&
                      rfi.response_required_by < now &&
                      ["submitted", "under_review"].includes(rfi.status);
                    return (
                      <tr key={rfi.id} className="border-t border-line">
                        <td className={`${tdClass} whitespace-nowrap font-mono text-xs font-semibold text-ink`}>
                          <span dir="ltr">{rfi.rfi_number}</span>
                        </td>
                        <td className={`${tdClass} text-ink`} dir="auto">
                          {rfi.subject}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-muted`}>
                          {rfi.response_required_by ? dateFmt.format(new Date(rfi.response_required_by)) : "—"}
                        </td>
                        <td className={tdClass}>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone={overdue ? "danger" : engineeringStatusTone(rfi.status)}>
                              {engineeringStatusLabel(rfi.status, locale)}
                            </Badge>
                            {overdue ? <Badge tone="danger">{e.rfis.overdue}</Badge> : null}
                          </div>
                        </td>
                        <td className={tdClass}>
                          <div className="flex flex-col gap-2">
                            {["draft", "internal_review"].includes(rfi.status) &&
                            hasPermission(ctx, "rfi.submit") ? (
                              <ServerActionForm action={submitRfiAction}>
                                <input type="hidden" name="rfiId" value={rfi.id} />
                                <Button type="submit" variant="secondary">
                                  {e.rfis.submit}
                                </Button>
                              </ServerActionForm>
                            ) : null}
                            {["submitted", "under_review"].includes(rfi.status) &&
                            hasPermission(ctx, "rfi.respond") ? (
                              <ServerActionForm action={respondRfiAction} className="flex gap-2">
                                <input type="hidden" name="rfiId" value={rfi.id} />
                                <Input name="response" placeholder={e.rfis.responsePlaceholder} required />
                                <Button type="submit">{e.rfis.respond}</Button>
                              </ServerActionForm>
                            ) : null}
                            {rfi.response ? <p className="text-xs text-muted">{e.rfis.responseSaved}</p> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Section>
      ) : null}

      {moduleFilter === "mat" ? (
        <RegisterTable
          title={e.submittals.registerTitle}
          empty={e.submittals.empty}
          headers={[e.common.number, e.submittals.category, e.common.status, e.common.decision]}
          rows={(mats.data ?? []).map((m) => ({
            id: m.id,
            number: m.mat_number,
            title: m.material_category,
            status: <StatusBadge status={m.status} locale={locale} />,
            extra: <DecisionBadge code={m.official_decision} locale={locale} />,
          }))}
        />
      ) : null}

      {moduleFilter === "shd" ? (
        <RegisterTable
          title={e.shopDrawings.registerTitle}
          empty={e.shopDrawings.empty}
          headers={[e.common.number, e.shopDrawings.titleColumn, e.common.status, e.shopDrawings.approvedForExecution]}
          rows={(shds.data ?? []).map((s) => ({
            id: s.id,
            number: s.shd_number,
            title: s.drawing_title,
            status: <StatusBadge status={s.status} locale={locale} />,
            extra: s.approved_for_execution ? (
              <Badge tone="success">{e.shopDrawings.approvedYes}</Badge>
            ) : (
              <span className="text-muted">{e.shopDrawings.approvedNo}</span>
            ),
          }))}
        />
      ) : null}

      {moduleFilter === "ms" ? (
        <RegisterTable
          title={e.methodStatements.registerTitle}
          empty={e.methodStatements.empty}
          headers={[e.common.number, e.methodStatements.activity, e.common.status, e.common.decision]}
          rows={(mss.data ?? []).map((m) => ({
            id: m.id,
            number: m.ms_number,
            title: m.activity,
            status: <StatusBadge status={m.status} locale={locale} />,
            extra: <DecisionBadge code={m.official_decision} locale={locale} />,
          }))}
        />
      ) : null}

      {moduleFilter === "ir" ? (
        <Section title={e.inspections.registerTitle}>
          {(irs.data ?? []).length === 0 ? (
            <EmptyState title={e.inspections.empty} />
          ) : (
            <TableScroll>
              <table className="min-w-full text-sm">
                <thead className="bg-surface-muted">
                  <tr>
                    <th className={thClass}>{e.common.number}</th>
                    <th className={thClass}>{e.inspections.activity}</th>
                    <th className={thClass}>{e.common.status}</th>
                    <th className={thClass}>{e.inspections.result}</th>
                  </tr>
                </thead>
                <tbody>
                  {(irs.data ?? []).map((ir) => (
                    <tr key={ir.id} className="border-t border-line">
                      <td className={`${tdClass} whitespace-nowrap font-mono text-xs font-semibold text-ink`}>
                        <span dir="ltr">{ir.ir_number}</span>
                      </td>
                      <td className={`${tdClass} text-ink`} dir="auto">
                        {ir.related_activity}
                        {ir.location ? <span className="block text-xs text-muted">{ir.location}</span> : null}
                      </td>
                      <td className={tdClass}>
                        <StatusBadge status={ir.status} locale={locale} />
                      </td>
                      <td className={tdClass}>
                        {hasPermission(ctx, "inspection.perform") &&
                        ["ready", "submitted", "scheduled", "inspected"].includes(ir.status) ? (
                          <ServerActionForm action={recordInspectionResultAction} className="flex flex-wrap gap-2">
                            <input type="hidden" name="inspectionId" value={ir.id} />
                            <Select name="result" defaultValue="passed">
                              {INSPECTION_RESULTS.map((r) => (
                                <option key={r} value={r}>
                                  {engineeringStatusLabel(r, locale)}
                                </option>
                              ))}
                            </Select>
                            <Input name="comments" placeholder={e.inspections.commentsPlaceholder} />
                            <Button type="submit" variant="secondary">
                              {e.inspections.record}
                            </Button>
                          </ServerActionForm>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Section>
      ) : null}

      {moduleFilter === "ncr" ? (
        <Section title={e.ncrs.registerTitle}>
          {(ncrs.data ?? []).length === 0 ? (
            <EmptyState title={e.ncrs.empty} />
          ) : (
            <ul className="divide-y divide-line">
              {(ncrs.data ?? []).map((ncr) => (
                <li key={ncr.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-ink">
                      <span dir="ltr">{ncr.ncr_number}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted" dir="auto">
                      {ncr.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone(ncr.severity)}>{ncrSeverityLabel(ncr.severity, locale)}</Badge>
                    <StatusBadge status={ncr.status} locale={locale} />
                    {ncr.status !== "closed" && hasPermission(ctx, "ncr.close") ? (
                      <ServerActionForm action={closeNcrAction} className="flex gap-2">
                        <input type="hidden" name="ncrId" value={ncr.id} />
                        <Input name="verification" placeholder={e.ncrs.verificationPlaceholder} required />
                        <Button type="submit" variant="secondary">
                          {e.ncrs.close}
                        </Button>
                      </ServerActionForm>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </PageContainer>
  );
}

function ProjectField({
  label,
  projects,
  defaultValue,
  locale,
}: {
  label: string;
  projects: ProjectOption[];
  defaultValue: string;
  locale: Locale;
}) {
  return (
    <Field label={label} required>
      <Select name="projectId" required defaultValue={defaultValue}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.project_code} — {pickLocalized(locale, p.name_ar, p.name_en)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function DisciplineField({
  label,
  disciplines,
  defaultValue,
  required,
  withName,
  locale,
}: {
  label: string;
  disciplines: DisciplineOption[];
  defaultValue: string;
  required?: boolean;
  withName?: boolean;
  locale: Locale;
}) {
  return (
    <Field label={label} required={required}>
      <Select name="disciplineCode" required={required} defaultValue={defaultValue}>
        {disciplines.map((d) => (
          <option key={d.code} value={d.code}>
            {withName ? `${d.code} — ${pickLocalized(locale, d.name_ar, d.name_en)}` : d.code}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function StatusBadge({ status, locale }: { status: string | null; locale: Locale }) {
  return <Badge tone={engineeringStatusTone(status)}>{engineeringStatusLabel(status, locale)}</Badge>;
}

function DecisionBadge({ code, locale }: { code: string | null; locale: Locale }) {
  if (!code) return <span className="text-muted">—</span>;
  return (
    <Badge tone={officialDecisionTone(code)}>
      <span dir="auto">{officialDecisionWithCode(code, locale)}</span>
    </Badge>
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
  rows: { id: string; number: string; title: string | null; status: ReactNode; extra: ReactNode }[];
}) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <TableScroll>
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted">
              <tr>
                {headers.map((h) => (
                  <th key={h} className={thClass}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className={`${tdClass} whitespace-nowrap font-mono text-xs font-semibold text-ink`}>
                    <span dir="ltr">{row.number}</span>
                  </td>
                  <td className={`${tdClass} text-ink`} dir="auto">
                    {row.title}
                  </td>
                  <td className={tdClass}>{row.status}</td>
                  <td className={tdClass}>{row.extra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Section>
  );
}
