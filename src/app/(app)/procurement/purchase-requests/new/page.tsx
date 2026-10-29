import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { createPurchaseRequestAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { parseScopedProjectId } from "@/modules/procurement/stage05-readiness";
import { format, pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function NewPurchaseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "purchase_request.create");
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_code, name_ar, name_en")
    .eq("organization_id", ctx.organization.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (!projects?.length) {
    redirect("/procurement/purchase-requests");
  }

  const { t, locale } = await getI18n();
  const tc = t.procurementSourcing.requests.create;
  const common = t.procurementSourcing.common;

  const requestedProject = parseScopedProjectId(params.project) ?? "";
  const defaultProjectId = projects.some((p) => p.id === requestedProject) ? requestedProject : "";

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createPurchaseRequestAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/purchase-requests");
  }

  return (
    <PageContainer className="mx-auto max-w-2xl" data-testid="pr-create-page">
      <PageHeader title={tc.title} description={tc.description} />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="pr-create-form">
          <Field label={tc.project} required>
            <Select name="projectId" required defaultValue={defaultProjectId} data-testid="pr-project-id">
              <option value="" disabled>{tc.selectProject}</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {format(common.codeName, {
                    code: p.project_code,
                    name: pickLocalized(locale, p.name_ar, p.name_en),
                  })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tc.justification} required>
            <Textarea name="justification" required minLength={3} data-testid="pr-justification" />
          </Field>
          <Field label={tc.itemDescription} required>
            <Input name="itemDescription" required data-testid="pr-item-description" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tc.quantity} required>
              <Input name="quantity" type="number" step="0.01" min="0.01" required defaultValue="1" data-testid="pr-quantity" />
            </Field>
            <Field label={tc.estimatedUnitCost}>
              <Input name="estimatedUnitCost" type="number" step="0.01" min="0" data-testid="pr-unit-cost" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tc.priority}>
              <Select name="priority" defaultValue="medium" data-testid="pr-priority">
                <option value="low">{tc.priorities.low}</option>
                <option value="medium">{tc.priorities.medium}</option>
                <option value="high">{tc.priorities.high}</option>
                <option value="critical">{tc.priorities.critical}</option>
              </Select>
            </Field>
            <Field label={tc.requiredDate}>
              <Input name="requiredDate" type="date" data-testid="pr-required-date" />
            </Field>
          </div>
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Link
              href="/procurement/purchase-requests"
              className="inline-flex items-center rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
            >
              {common.cancel}
            </Link>
            <Button type="submit" data-testid="pr-create-submit">{tc.submit}</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
