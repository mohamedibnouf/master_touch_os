import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { hasPermission } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createClientValuationAction } from "@/server/use-cases/commercial";
import { ServerActionForm } from "@/components/forms/server-action-form";

export default async function NewClientValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx, "client_valuation.create")) redirect("/finance/client-valuations");

  const { projectId: preselectedProjectId } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: contracts } = await supabase
    .from("project_contracts")
    .select("id, contract_number, client_name, project_id, status, projects(id, project_code, name_ar)")
    .eq("organization_id", ctx.organization.id)
    .in("status", ["active", "draft"])
    .order("created_at", { ascending: false });

  const contractRows = contracts ?? [];
  const selectedContract = preselectedProjectId
    ? contractRows.find((c) => c.project_id === preselectedProjectId) ?? contractRows[0]
    : contractRows[0];

  const { data: milestones } = selectedContract
    ? await supabase
        .from("contract_milestones")
        .select("id, milestone_number, description, amount, status")
        .eq("contract_id", selectedContract.id)
        .in("status", ["eligible", "planned"])
        .order("milestone_number")
    : { data: [] };

  async function action(
    _prev: import("@/server/forms/form-state").FormActionState,
    formData: FormData,
  ): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const contractId = String(formData.get("contractId") ?? "");
    const supabaseInner = await createServerSupabaseClient();
    const { data: contract } = await supabaseInner
      .from("project_contracts")
      .select("project_id")
      .eq("id", contractId)
      .maybeSingle();
    if (contract) formData.set("projectId", contract.project_id);
    const state = await createClientValuationAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/finance/client-valuations");
  }

  return (
    <PageContainer className="mx-auto max-w-2xl" data-testid="valuation-create-page">
      <PageHeader
        title="مستخلص عميل جديد"
        description="يُعاد حساب المبالغ تلقائياً بعد الحفظ"
        actions={
          <Link href="/finance/client-valuations" className="text-sm underline">
            السجل
          </Link>
        }
      />
      <Card>
        {contractRows.length === 0 ? (
          <p className="text-sm text-muted">لا توجد عقود مشاريع نشطة — أنشئ عقداً من صفحة المشروع أولاً.</p>
        ) : (
          <ServerActionForm action={action} className="grid gap-4" data-testid="valuation-create-form">
            <Field label="العقد / المشروع">
              <Select name="contractId" required defaultValue={selectedContract?.id ?? ""} data-testid="valuation-contract">
                {contractRows.map((c) => {
                  const project = Array.isArray(c.projects) ? c.projects[0] : c.projects;
                  return (
                    <option key={c.id} value={c.id} data-project-id={c.project_id}>
                      {(project as Record<string, string> | null)?.project_code ?? "—"} — {c.contract_number} ({c.client_name})
                    </option>
                  );
                })}
              </Select>
            </Field>
            <input type="hidden" name="projectId" value={selectedContract?.project_id ?? ""} />
            <Field label="مرحلة الدفع (اختياري)">
              <Select name="milestoneId" defaultValue="">
                <option value="">بدون ربط بمرحلة</option>
                {(milestones ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.milestone_number} — {m.description} ({m.amount})
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="بداية الفترة">
                <Input name="periodStart" type="date" />
              </Field>
              <Field label="نهاية الفترة">
                <Input name="periodEnd" type="date" />
              </Field>
              <Field label="نسبة الإنجاز (%)">
                <Input name="progressPercentage" type="number" step="0.001" min="0" max="100" />
              </Field>
              <Field label="تاريخ الاستحقاق">
                <Input name="dueDate" type="date" />
              </Field>
              <Field label="قيمة الأعمال (SAR)">
                <Input name="grossWorkValue" type="number" step="0.01" min="0" required defaultValue="0" data-testid="valuation-gross" />
              </Field>
              <Field label="أوامر التغيير (SAR)">
                <Input name="variationsAmount" type="number" step="0.01" min="0" defaultValue="0" />
              </Field>
              <Field label="استرداد الدفعة المقدمة">
                <Input name="advanceRecovery" type="number" step="0.01" min="0" defaultValue="0" />
              </Field>
              <Field label="المعتمد سابقاً">
                <Input name="previousCertifiedAmount" type="number" step="0.01" min="0" defaultValue="0" />
              </Field>
            </div>
            <Field label="ملاحظات">
              <Textarea name="notes" placeholder="ملاحظات إضافية..." />
            </Field>
            <div className="flex justify-end gap-3">
              <Link
                href="/finance/client-valuations"
                className="inline-flex items-center rounded-md border border-line bg-white px-4 py-2 text-sm font-medium"
              >
                إلغاء
              </Link>
              <Button type="submit" data-testid="valuation-submit">
                حفظ المستخلص
              </Button>
            </div>
          </ServerActionForm>
        )}
      </Card>
    </PageContainer>
  );
}
