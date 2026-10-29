import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createVariationAction } from "@/server/use-cases/commercial";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

const SOURCES = ["client_instruction", "rfi", "ncr", "design_change", "site_condition", "other"] as const;

export default async function NewVariationPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "variation.create")) redirect("/finance/variations");

  const { t, locale } = await getI18n();
  const tf = t.financePayables.variationForm;
  const sources = t.financePayables.variations.sources;
  const common = t.financePayables.common;

  const { projectId: preselectedProjectId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const [{ data: projects }, { data: contracts }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, name_ar, name_en")
      .eq("organization_id", ctx.organization.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("project_contracts")
      .select("id, contract_number, project_id")
      .eq("organization_id", ctx.organization.id)
      .in("status", ["active", "draft"]),
  ]);

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createVariationAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/finance/variations");
  }

  return (
    <PageContainer className="mx-auto max-w-2xl" data-testid="variation-create-page">
      <PageHeader
        title={tf.title}
        description={tf.description}
        actions={
          <Link
            href="/finance/variations"
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            {common.register}
          </Link>
        }
      />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="variation-create-form">
          <Field label={tf.project} required>
            <Select name="projectId" required defaultValue={preselectedProjectId ?? ""} data-testid="variation-project">
              <option value="" disabled>
                {tf.chooseProject}
              </option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {format(common.projectOption, {
                    code: p.project_code,
                    name: pickLocalized(locale, p.name_ar, p.name_en),
                  })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tf.contract}>
            <Select name="contractId" defaultValue="">
              <option value="">{tf.noContract}</option>
              {(contracts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contract_number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tf.source} required>
            <Select name="source" required defaultValue="client_instruction" data-testid="variation-source">
              {SOURCES.map((source) => (
                <option key={source} value={source}>
                  {sources[source]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tf.descriptionLabel} required>
            <Textarea name="description" required data-testid="variation-description" />
          </Field>
          <Field label={tf.reason}>
            <Textarea name="reason" placeholder={tf.reasonPlaceholder} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tf.requestedAmount} required>
              <Input name="requestedAmount" type="number" step="0.01" min="0" required defaultValue="0" className="tabular-nums" data-testid="variation-amount" />
            </Field>
            <Field label={tf.costImpact}>
              <Input name="costImpact" type="number" step="0.01" min="0" className="tabular-nums" />
            </Field>
            <Field label={tf.timeImpact}>
              <Input name="timeImpactDays" type="number" step="1" defaultValue="0" className="tabular-nums" />
            </Field>
          </div>
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Link
              href="/finance/variations"
              className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-muted md:min-h-9"
            >
              {common.cancel}
            </Link>
            <Button type="submit" data-testid="variation-submit">
              {tf.submit}
            </Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
