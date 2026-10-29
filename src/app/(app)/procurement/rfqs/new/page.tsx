import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { createRfqFromPrAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { format } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function NewRfqPage() {
  const ctx = authorize(await getAuthContext(), "rfq.create");
  const supabase = await createServerSupabaseClient();

  const [prsResult, suppliersResult] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select("id, pr_number, project_id, projects(project_code, name_ar)")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
    supabase
      .from("suppliers")
      .select("id, supplier_code, legal_name")
      .eq("organization_id", ctx.organization.id)
      .eq("status", "active")
      .order("legal_name"),
  ]);

  const { t } = await getI18n();
  const tc = t.procurementSourcing.rfqs.create;
  const common = t.procurementSourcing.common;

  const prs = prsResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createRfqFromPrAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/rfqs");
  }

  return (
    <PageContainer className="mx-auto max-w-2xl">
      <PageHeader title={tc.title} description={tc.description} />
      <Card>
        <ServerActionForm action={action} className="grid gap-4">
          <Field label={tc.purchaseRequest} required>
            <Select name="prId" required defaultValue="">
              <option value="" disabled>{tc.selectPr}</option>
              {prs.map((p) => {
                const project = Array.isArray(p.projects) ? p.projects[0] : p.projects;
                return (
                  <option key={p.id} value={p.id}>
                    {p.pr_number}
                    {project ? ` — ${(project as Record<string, string>).project_code}` : ""}
                  </option>
                );
              })}
            </Select>
          </Field>
          {prs.length === 0 ? (
            <p className="rounded-md border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning">
              {tc.noApprovedPrs}
            </p>
          ) : null}
          <Field label={tc.rfqTitle}>
            <Input name="title" placeholder={tc.rfqTitlePlaceholder} />
          </Field>
          <Field label={tc.responseDueDate} required>
            <Input name="responseDueDate" type="date" required />
          </Field>
          <div>
            <p className="mb-2 block text-sm font-medium text-ink">{tc.invitedSuppliers}</p>
            {suppliers.length === 0 ? (
              <p className="text-sm text-muted">{tc.noActiveSuppliers}</p>
            ) : (
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-line bg-surface-muted p-2">
                {suppliers.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-surface"
                  >
                    <input type="checkbox" name="supplierIds" value={s.id} className="accent-primary" />
                    <span>{format(common.codeName, { code: s.supplier_code, name: s.legal_name })}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <Link
              href="/procurement/rfqs"
              className="inline-flex items-center rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
            >
              {common.cancel}
            </Link>
            <Button type="submit" disabled={prs.length === 0}>{tc.submit}</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
