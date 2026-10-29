import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, Field, Input, PageHeader, Select, TableScroll, Textarea } from "@/components/ui/primitives";
import { getAuthContext } from "@/server/context";
import { authorize } from "@/server/policies/authorize";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAndPostGoodsReceiptAction } from "@/server/use-cases/procurement";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { getI18n } from "@/lib/i18n/server";

export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  const ctx = authorize(await getAuthContext(), "goods_receipt.create");
  const { poId: preselectedPoId } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { t } = await getI18n();
  const tc = t.procurementOrders.common;
  const tf = t.procurementOrders.receiptForm;

  // Issued / partially delivered POs
  const { data: eligiblePos } = await supabase
    .from("purchase_orders")
    .select("id, po_number, supplier_id, suppliers(legal_name), purchase_order_items(*)")
    .eq("organization_id", ctx.organization.id)
    .in("status", ["issued", "partially_delivered"])
    .order("created_at", { ascending: false });

  const selectedPo = preselectedPoId
    ? (eligiblePos ?? []).find((p) => p.id === preselectedPoId)
    : null;

  const poForForm = selectedPo ?? (eligiblePos ?? [])[0];

  if (!poForForm) {
    return (
      <PageContainer className="mx-auto max-w-2xl">
        <PageHeader title={tf.titleEmpty} description={tf.descriptionEmpty} />
        <Card>
          <p className="text-sm text-warning">{tf.noEligible}</p>
        </Card>
      </PageContainer>
    );
  }

  const items = (poForForm.purchase_order_items as Array<Record<string, unknown>>) ?? [];
  const supplier = Array.isArray(poForForm.suppliers) ? poForForm.suppliers[0] : poForForm.suppliers;

  async function action(_prev: import("@/server/forms/form-state").FormActionState, formData: FormData): Promise<import("@/server/forms/form-state").FormActionState> {
    "use server";
    const state = await createAndPostGoodsReceiptAction(_prev, formData);
    if (!state?.ok) return state;
    redirect("/procurement/goods-receipts");
  }

  return (
    <PageContainer className="mx-auto max-w-4xl" data-testid="grn-create-page">
      <PageHeader title={tf.title} description={tf.description} />
      <Card>
        <ServerActionForm action={action} className="grid gap-5" data-testid="grn-create-form">
          {/* PO selector */}
          {(eligiblePos ?? []).length > 1 ? (
            <Field label={tc.purchaseOrder}>
              <Select name="poId" required defaultValue={poForForm.id}>
                {(eligiblePos ?? []).map((p) => {
                  const s = Array.isArray(p.suppliers) ? p.suppliers[0] : p.suppliers;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.po_number} — {(s as Record<string, string> | null)?.legal_name ?? "—"}
                    </option>
                  );
                })}
              </Select>
            </Field>
          ) : (
            <div className="rounded-xl border border-line bg-surface-muted p-3 text-sm">
              <span className="text-muted">{tc.purchaseOrder}: </span>
              <span className="font-mono text-xs font-semibold text-ink" dir="ltr">{poForForm.po_number}</span>
              {supplier ? ` — ${(supplier as Record<string, string>).legal_name}` : ""}
              <input type="hidden" name="poId" value={poForForm.id} />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Field label={tc.deliveryDate}>
              <Input name="deliveryDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} data-testid="grn-delivery-date" />
            </Field>
            <Field label={tf.deliveryNoteNumber}>
              <Input name="deliveryNoteNumber" placeholder={tc.optional} dir="ltr" />
            </Field>
            <Field label={tf.location}>
              <Input name="location" placeholder={tc.optional} />
            </Field>
          </div>

          {/* Line items */}
          <div>
            <h3 className="mb-3 font-semibold text-ink">{tf.lines}</h3>
            <TableScroll className="rounded-xl border border-line">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    <th className="px-3 py-2 text-start font-semibold">#</th>
                    <th className="px-3 py-2 text-start font-semibold">{tc.description}</th>
                    <th className="px-3 py-2 text-end font-semibold">{tf.ordered}</th>
                    <th className="px-3 py-2 text-end font-semibold">{tf.previouslyReceived}</th>
                    <th className="px-3 py-2 text-end font-semibold">{tf.remaining}</th>
                    <th className="px-3 py-2 text-start font-semibold">{tf.receivedNow}</th>
                    <th className="px-3 py-2 text-start font-semibold">{tc.accepted}</th>
                    <th className="px-3 py-2 text-start font-semibold">{tc.rejected}</th>
                    <th className="px-3 py-2 text-start font-semibold">{tc.rejectionReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const ordered = Number(item.quantity);
                    const prevReceived = Number(item.received_quantity ?? 0);
                    const remaining = Math.max(0, ordered - prevReceived);
                    return (
                      <tr key={String(item.id)} className="border-t border-line">
                        <td className="px-3 py-2 text-muted">{String(item.line_no)}</td>
                        <td className="px-3 py-2 text-ink">{String(item.description)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{ordered}</td>
                        <td className="px-3 py-2 text-end tabular-nums text-muted">{prevReceived}</td>
                        <td className={`px-3 py-2 text-end tabular-nums ${remaining > 0 ? "text-warning font-medium" : "text-muted"}`}>
                          {remaining}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`received_${item.id}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            max={String(remaining)}
                            defaultValue="0"
                            className="w-24"
                            disabled={remaining <= 0}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`accepted_${item.id}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            defaultValue="0"
                            className="w-24"
                            disabled={remaining <= 0}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`rejected_${item.id}`}
                            type="number"
                            step="0.0001"
                            min="0"
                            defaultValue="0"
                            className="w-24"
                            disabled={remaining <= 0}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            name={`reason_${item.id}`}
                            placeholder={tc.rejectionReason}
                            className="w-32"
                            disabled={remaining <= 0}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </div>

          <Field label={tc.notes}>
            <Textarea name="notes" placeholder={tf.notesPlaceholder} />
          </Field>

          <div className="flex justify-end gap-3">
            <Link href="/procurement/goods-receipts">
              <Button type="button" variant="secondary">
                {tc.cancel}
              </Button>
            </Link>
            <Button type="submit" data-testid="grn-submit">{tf.submit}</Button>
          </div>
        </ServerActionForm>
      </Card>
    </PageContainer>
  );
}
