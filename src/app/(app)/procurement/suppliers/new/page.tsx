import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createSupplierAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { pickLocalized } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";

export default async function NewSupplierPage() {
  authorize(await getAuthContext(), "supplier.manage");
  const supabase = await createServerSupabaseClient();
  const { t, locale } = await getI18n();
  const tc = t.procurementOrders.common;
  const tf = t.procurementOrders.supplierForm;

  const { data: categories } = await supabase
    .from("supplier_categories")
    .select("id, code, name_ar, name_en")
    .order(locale === "ar" ? "name_ar" : "name_en");

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createSupplierAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/suppliers");
  }

  return (
    <PageContainer className="mx-auto max-w-2xl">
      <PageHeader title={tf.title} description={tf.description} />
      <Card>
        <ServerActionForm action={action} className="grid gap-4">
          <Field label={tf.legalName}>
            <Input name="legalName" required minLength={2} dir="auto" />
          </Field>
          <Field label={tf.tradeName}>
            <Input name="tradeName" dir="auto" />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tf.email}>
              <Input name="email" type="email" dir="ltr" />
            </Field>
            <Field label={tf.phone}>
              <Input name="phone" dir="ltr" />
            </Field>
            <Field label={tf.city}>
              <Input name="city" />
            </Field>
            <Field label={tf.category}>
              <Select name="categoryId" defaultValue="">
                <option value="">{tf.noCategory}</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{pickLocalized(locale, c.name_ar, c.name_en)}</option>
                ))}
              </Select>
            </Field>
            <Field label={tf.crNumber}>
              <Input name="commercialRegistration" dir="ltr" />
            </Field>
            <Field label={tf.vatNumber}>
              <Input name="vatNumber" dir="ltr" />
            </Field>
            <Field label={tf.paymentTermsDays}>
              <Input name="paymentTermsDays" type="number" min="0" defaultValue="30" />
            </Field>
          </div>
          <Field label={tc.notes}>
            <Textarea name="notes" />
          </Field>
          <div className="flex justify-end gap-3">
            <Link href="/procurement/suppliers">
              <Button type="button" variant="secondary">
                {tc.cancel}
              </Button>
            </Link>
            <Button type="submit">{tf.submit}</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
