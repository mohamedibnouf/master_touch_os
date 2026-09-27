import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { createPurchaseRequestAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewPurchaseRequestPage() {
  const ctx = authorize(await getAuthContext(), "purchase_request.create");
  const supabase = await createServerSupabaseClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_code, name_ar")
    .eq("organization_id", ctx.organization.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (!projects?.length) {
    redirect("/procurement/purchase-requests");
  }

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createPurchaseRequestAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/purchase-requests");
  }

  return (
    <div className="mx-auto max-w-2xl" data-testid="pr-create-page">
      <PageHeader
        title="طلب شراء جديد"
        description="أنشئ طلب شراء داخلي — سيتم توليد الرقم تلقائياً"
      />
      <Card>
        <ServerActionForm action={action} className="grid gap-4" data-testid="pr-create-form">
          <Field label="المشروع">
            <Select name="projectId" required defaultValue="" data-testid="pr-project-id">
              <option value="" disabled>اختر مشروعاً</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_code} — {p.name_ar}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="المبرر / الوصف">
            <Textarea name="justification" required minLength={3} data-testid="pr-justification" />
          </Field>
          <Field label="وصف البند الأول">
            <Input name="itemDescription" required data-testid="pr-item-description" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الكمية">
              <Input name="quantity" type="number" step="0.01" min="0.01" required defaultValue="1" data-testid="pr-quantity" />
            </Field>
            <Field label="سعر الوحدة التقديري (SAR)">
              <Input name="estimatedUnitCost" type="number" step="0.01" min="0" data-testid="pr-unit-cost" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الأولوية">
              <Select name="priority" defaultValue="medium" data-testid="pr-priority">
                <option value="low">منخفضة</option>
                <option value="medium">متوسطة</option>
                <option value="high">عالية</option>
                <option value="critical">حرجة</option>
              </Select>
            </Field>
            <Field label="تاريخ الحاجة">
              <Input name="requiredDate" type="date" data-testid="pr-required-date" />
            </Field>
          </div>
          <div className="flex justify-end gap-3">
            <Link href="/procurement/purchase-requests" className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
              إلغاء
            </Link>
            <Button type="submit" data-testid="pr-create-submit">إنشاء مسودة</Button>
          </div>
        </ServerActionForm>
      </Card>
    </div>
  );
}
