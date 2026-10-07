import { Button, Select } from "@/components/ui/primitives";
import { ServerActionForm } from "@/components/forms/server-action-form";
import { inviteRfqSupplierAction, removeRfqSupplierAction } from "@/server/use-cases/procurement";

export function RfqSupplierInvitePanel({
  rfqId,
  candidates,
}: {
  rfqId: string;
  candidates: Array<{ id: string; supplier_code: string; legal_name: string }>;
}) {
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4" data-testid="rfq-supplier-manage">
      <h3 className="text-sm font-semibold text-navy">إدارة الموردين</h3>
      <p className="text-xs text-muted">اختر مورداً نشطاً من سجل الموردين. لا يُنشأ مورد جديد من هنا.</p>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted">لا يوجد موردون نشطون غير مدعوين. أضفهم من سجل الموردين أولاً.</p>
      ) : (
        <ServerActionForm action={inviteRfqSupplierAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="rfqId" value={rfqId} />
          <label className="grid min-w-56 flex-1 gap-1 text-sm">
            <span className="text-muted">المورد</span>
            <Select name="supplierId" required defaultValue="" data-testid="rfq-invite-supplier">
              <option value="" disabled>
                اختر مورداً
              </option>
              {candidates.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.supplier_code} — {supplier.legal_name}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit">دعوة المورد</Button>
        </ServerActionForm>
      )}
    </div>
  );
}

export function RfqSupplierRemoveButton({ rfqId, invitationId }: { rfqId: string; invitationId: string }) {
  return (
    <ServerActionForm action={removeRfqSupplierAction}>
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <Button type="submit" variant="ghost">
        إزالة
      </Button>
    </ServerActionForm>
  );
}
