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
  Section,
  Select,
  StatCard,
  Textarea,
} from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { getI18n } from "@/lib/i18n/server";
import { format, intlLocale, pickLocalized } from "@/lib/i18n/config";
import {
  engineeringStatusTone,
  officialDecisionLabel,
  officialDecisionTone,
  officialDecisionWithCode,
  submissionStatusLabel,
  transmittalPurposeLabel,
  transmittalStatusLabel,
} from "@/lib/ui/engineering-labels";
import {
  applyDocumentDecisionAction,
  createTransmittalAction,
  issueTransmittalAction,
  reviseDocumentAction,
} from "@/server/use-cases/engineering";

const DOCUMENT_TYPES = ["RFI", "MAT", "SHD", "MS", "IR", "NCR"] as const;
const TRANSMITTAL_PURPOSES = ["for_approval", "for_review", "for_information", "for_construction", "for_record"] as const;
const DECISION_CODES = ["A", "B", "C", "D", "E"] as const;

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

  const { t, locale } = await getI18n();
  const dc = t.engineering.documentControl;
  const { type, overdue, q } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const now = new Date().toISOString();
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "Asia/Riyadh" });

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
      .select("id, project_code, name_ar, name_en")
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
  const draftTrn = (transmittals ?? []).filter((tr) => tr.status === "draft").length;

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
        title={dc.title}
        description={dc.description}
        actions={
          <div className="flex flex-wrap gap-3 text-sm font-medium">
            <Link href="/document-control" className="text-primary hover:underline">
              {dc.all}
            </Link>
            <Link href="/document-control?overdue=1" className="text-danger hover:underline">
              {dc.overdue}
            </Link>
            <Link href="/search" className="text-primary hover:underline">
              {dc.advancedSearch}
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={dc.stats.awaitingAction} value={awaiting} tone="info" />
        <StatCard label={dc.stats.approvedAB} value={approved} tone="success" />
        <StatCard label={dc.stats.resubmitC} value={returnedC} tone="warning" />
        <StatCard label={dc.stats.rejectedD} value={rejectedD} tone="danger" />
        <StatCard label={dc.stats.draftTransmittals} value={draftTrn} />
      </div>

      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label={dc.filters.search}>
              <Input name="q" defaultValue={q ?? ""} placeholder={dc.filters.searchPlaceholder} />
            </Field>
          </div>
          <Field label={dc.filters.type}>
            <Select name="type" defaultValue={type ?? ""}>
              <option value="">{dc.filters.allTypes}</option>
              {DOCUMENT_TYPES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            {dc.filters.apply}
          </Button>
        </form>
      </Card>

      {canCreateTrn && defaultProject ? (
        <Section title={dc.transmittal.createTitle}>
          <ServerActionForm action={createTransmittalAction} className="grid gap-3 md:grid-cols-2">
            <Field label={dc.transmittal.project} required>
              <Select name="projectId" required defaultValue={defaultProject}>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_code} — {pickLocalized(locale, p.name_ar, p.name_en)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={dc.transmittal.recipient} required>
              <Input name="recipient" required />
            </Field>
            <Field label={dc.transmittal.subject} required>
              <Input name="subject" required />
            </Field>
            <Field label={dc.transmittal.purpose}>
              <Select name="purpose" defaultValue="for_approval">
                {TRANSMITTAL_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {transmittalPurposeLabel(p, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={dc.transmittal.documentIds} required>
              <Input
                name="documentIds"
                required
                dir="ltr"
                placeholder={attachableDocs[0]?.id ?? "uuid,..."}
                defaultValue={attachableDocs[0]?.id ?? ""}
              />
            </Field>
            <Field label={dc.transmittal.description}>
              <Input name="description" />
            </Field>
            <div>
              <Button type="submit">{dc.transmittal.create}</Button>
            </div>
          </ServerActionForm>
          {attachableDocs.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              {dc.transmittal.recentDocuments}{" "}
              <span dir="ltr" className="font-mono">
                {attachableDocs.map((d) => `${d.document_number} (${d.id.slice(0, 8)}…)`).join(" · ")}
              </span>
            </p>
          ) : null}
        </Section>
      ) : null}

      {(transmittals ?? []).length > 0 ? (
        <Section title={dc.transmittal.recentTitle}>
          <ul className="divide-y divide-line">
            {(transmittals ?? []).map((tr) => (
              <li key={tr.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-ink">
                    <span dir="ltr">{tr.transmittal_number}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    <span dir="auto">{tr.subject}</span> · {format(dc.transmittal.to, { recipient: tr.recipient })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={tr.status === "issued" ? "success" : tr.status === "cancelled" ? "danger" : "info"}>
                    {transmittalStatusLabel(tr.status, locale)}
                  </Badge>
                  {tr.status === "draft" && canIssueTrn ? (
                    <ServerActionForm action={issueTransmittalAction}>
                      <input type="hidden" name="transmittalId" value={tr.id} />
                      <Button type="submit" variant="secondary">
                        {dc.transmittal.issue}
                      </Button>
                    </ServerActionForm>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title={dc.register.empty} />
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
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold tracking-wide text-muted">
                      <span dir="ltr">{doc.document_number}</span>
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-ink" dir="auto">
                      {doc.title}
                    </h2>
                    <p className="mt-1 text-xs text-muted">
                      <span dir="ltr">{doc.type_code}</span> · <span dir="ltr">{project?.project_code ?? "—"}</span> ·{" "}
                      {format(dc.register.revision, { revision: doc.current_revision ?? "—" })}
                      {doc.response_due_at ? (
                        <>
                          {" · "}
                          {format(dc.register.responseDue, { date: dateFmt.format(new Date(doc.response_due_at)) })}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={engineeringStatusTone(doc.submission_status)}>
                      {submissionStatusLabel(doc.submission_status, locale)}
                    </Badge>
                    {doc.official_decision ? (
                      <Badge tone={officialDecisionTone(doc.official_decision)} title={officialDecisionLabel(doc.official_decision, locale)}>
                        {format(dc.register.decision, { code: doc.official_decision })} ·{" "}
                        {officialDecisionLabel(doc.official_decision, locale)}
                      </Badge>
                    ) : null}
                    {isOverdue ? <Badge tone="danger">{dc.register.overdue}</Badge> : null}
                  </div>
                </div>

                {(canApprove || canRevise) && (
                  <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-2">
                    {canApprove ? (
                      <ServerActionForm action={applyDocumentDecisionAction} className="space-y-2">
                        <input type="hidden" name="documentId" value={doc.id} />
                        <Field label={dc.decisionForm.label}>
                          <Select name="officialCode" defaultValue="A">
                            {DECISION_CODES.map((code) => (
                              <option key={code} value={code}>
                                {officialDecisionWithCode(code, locale)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={dc.decisionForm.comments}>
                          <Textarea name="comments" placeholder={dc.decisionForm.commentsPlaceholder} />
                        </Field>
                        <Button type="submit">{dc.decisionForm.submit}</Button>
                      </ServerActionForm>
                    ) : null}
                    {canRevise && (doc.official_decision === "C" || doc.official_decision === "D") ? (
                      <ServerActionForm action={reviseDocumentAction} className="space-y-2">
                        <input type="hidden" name="documentId" value={doc.id} />
                        <Field label={dc.reviseForm.changeDescription}>
                          <Textarea name="changeDescription" />
                        </Field>
                        <Button type="submit" variant="secondary">
                          {dc.reviseForm.submit}
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
