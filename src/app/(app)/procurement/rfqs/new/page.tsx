import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Button, Card, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { createRfqFromPrAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";

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

  const prs = prsResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createRfqFromPrAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/rfqs");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="طلب عرض أسعار جديد" description="أنشئ RFQ من طلب شراء معتمد" />
      <Card>
        <ServerActionForm action={action} className="grid gap-4">
          <Field label="طلب الشراء (PR)">
            <Select name="prId" required defaultValue="">
              <option value="" disabled>اختر طلب شراء معتمداً</option>
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
            <p className="rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
              لا توجد طلبات شراء معتمدة. اعتمد طلب شراء أولاً.
            </p>
          ) : null}
          <Field label="عنوان RFQ">
            <Input name="title" placeholder="عنوان وصفي لطلب عروض الأسعار" />
          </Field>
          <Field label="موعد استلام العروض">
            <Input name="responseDueDate" type="date" required />
          </Field>
          <div>
            <label className="mb-2 block text-sm font-medium text-ink">الموردون المدعوون</label>
            {suppliers.length === 0 ? (
              <p className="text-sm text-muted">لا يوجد موردون نشطون. سجّل موردين أولاً.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-md border border-line p-3 grid gap-2">
                {suppliers.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" name="supplierIds" value={s.id} />
                    <span>{s.supplier_code} — {s.legal_name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Link href="/procurement/rfqs" className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
              إلغاء
            </Link>
            <Button type="submit" disabled={prs.length === 0}>إنشاء RFQ</Button>
          </div>
        </ServerActionForm>
      </Card>
    </div>
  );
}
