import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupplierAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewSupplierPage() {
  authorize(await getAuthContext(), "supplier.manage");
  const supabase = await createServerSupabaseClient();

  const { data: categories } = await supabase
    .from("supplier_categories")
    .select("id, code, name_ar")
    .order("name_ar");

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createSupplierAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/suppliers");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="تسجيل مورد جديد" description="سيتم توليد رمز المورد تلقائياً" />
      <Card>
        <ServerActionForm action={action} className="grid gap-4">
          <Field label="الاسم القانوني (مطلوب)">
            <Input name="legalName" required minLength={2} />
          </Field>
          <Field label="الاسم التجاري">
            <Input name="tradeName" />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="البريد الإلكتروني">
              <Input name="email" type="email" />
            </Field>
            <Field label="الهاتف">
              <Input name="phone" />
            </Field>
            <Field label="المدينة">
              <Input name="city" />
            </Field>
            <Field label="التصنيف">
              <Select name="categoryId" defaultValue="">
                <option value="">بدون تصنيف</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name_ar}</option>
                ))}
              </Select>
            </Field>
            <Field label="رقم السجل التجاري">
              <Input name="commercialRegistration" />
            </Field>
            <Field label="الرقم الضريبي">
              <Input name="vatNumber" />
            </Field>
            <Field label="شروط الدفع (أيام)">
              <Input name="paymentTermsDays" type="number" min="0" defaultValue="30" />
            </Field>
          </div>
          <Field label="ملاحظات">
            <Textarea name="notes" />
          </Field>
          <div className="flex justify-end gap-3">
            <Link href="/procurement/suppliers" className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
              إلغاء
            </Link>
            <Button type="submit">حفظ المورد</Button>
          </div>
        </ServerActionForm>
      </Card>
    </div>
  );
}
