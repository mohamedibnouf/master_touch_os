import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createVariationAction } from "@/server/use-cases/commercial";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewVariationPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "variation.create")) redirect("/finance/variations");

  const { projectId: preselectedProjectId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const [{ data: projects }, { data: contracts }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_code, name_ar")
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
    <div className="mx-auto max-w-2xl" data-testid="variation-create-page">
      <PageHeader
        title="أمر تغيير جديد"
        description="VO — تسجيل طلب تغيير تجاري"
        actions={
          <Link href="/finance/variations" className="text-sm underline">
            السجل
          </Link>
        }
      />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="variation-create-form">
          <Field label="المشروع">
            <Select name="projectId" required defaultValue={preselectedProjectId ?? ""} data-testid="variation-project">
              <option value="" disabled>
                اختر مشروعاً
              </option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_code} — {p.name_ar}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="العقد (اختياري)">
            <Select name="contractId" defaultValue="">
              <option value="">بدون ربط</option>
              {(contracts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contract_number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="المصدر">
            <Select name="source" required defaultValue="client_instruction" data-testid="variation-source">
              <option value="client_instruction">تعليمات العميل</option>
              <option value="rfi">RFI</option>
              <option value="ncr">NCR</option>
              <option value="design_change">تغيير تصميم</option>
              <option value="site_condition">ظروف موقع</option>
              <option value="other">أخرى</option>
            </Select>
          </Field>
          <Field label="الوصف">
            <Textarea name="description" required data-testid="variation-description" />
          </Field>
          <Field label="السبب">
            <Textarea name="reason" placeholder="سبب التغيير..." />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="المبلغ المطلوب (SAR)">
              <Input name="requestedAmount" type="number" step="0.01" min="0" required defaultValue="0" data-testid="variation-amount" />
            </Field>
            <Field label="تأثير التكلفة (SAR)">
              <Input name="costImpact" type="number" step="0.01" min="0" />
            </Field>
            <Field label="تأثير المدة (أيام)">
              <Input name="timeImpactDays" type="number" step="1" defaultValue="0" />
            </Field>
          </div>
          <div className="flex justify-end gap-3">
            <Link
              href="/finance/variations"
              className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium"
            >
              إلغاء
            </Link>
            <Button type="submit" data-testid="variation-submit">
              حفظ أمر التغيير
            </Button>
          </div>
        </ServerActionForm>
      </Card>
    </div>
  );
}
